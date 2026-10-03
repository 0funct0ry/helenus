package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/schema"
	"github.com/0funct0ry/helenus/internal/shell"
)

// rootCmd is the interactive shell; -e and -f run one-shot CQL.
var rootCmd = &cobra.Command{
	Use:   "helenus [host [port]]",
	Short: "A local-first Cassandra client: cqlsh-compatible shell and web UI",
	Long: `Helenus is a local-first Cassandra client shipped as one binary.

Run it with no subcommand to start the interactive CQL shell, with -e or -f to
run CQL non-interactively, or use "helenus ui" for the web UI.`,
	Args:          cli.Args(cobra.MaximumNArgs(2)),
	SilenceUsage:  true,
	SilenceErrors: true,
	RunE:          runShell,
}

func runShell(cmd *cobra.Command, args []string) error {
	s, err := config.Resolve(cmd)
	if err != nil {
		return cli.Usage(err)
	}
	p, err := config.ResolveProfile(cmd, s, args)
	if err != nil {
		return cli.Usage(err)
	}
	opts, err := shellOptions(s)
	if err != nil {
		return cli.Usage(err)
	}
	if opts.execute != "" && opts.file != "" {
		return cli.Usagef("--execute and --file cannot be used together")
	}
	if stdin, _ := cmd.Flags().GetBool("password-stdin"); stdin {
		if p.Password, err = cli.ReadPasswordStdin(cmd.InOrStdin()); err != nil {
			return cli.Usage(err)
		}
	} else if p.Username != "" && p.Password == "" && p.PasswordCommand == "" {
		if p.Password, err = cli.PromptPassword("Password: ", os.Stdin, cmd.ErrOrStderr()); err != nil {
			return cli.Usage(err)
		}
	}

	ctx, cancel := context.WithCancel(cmd.Context())
	defer cancel()
	mgr := conn.NewManager()
	defer mgr.CloseAll()
	cache := schema.NewCache()
	name := p.Name
	if name == "" {
		name = p.Hosts[0]
	}
	backend, warnings, err := shell.Dial(ctx, mgr, cache, name, p)
	if err != nil {
		return cli.ConnectionFailed(describeFailure(ctx, p, err))
	}
	for _, w := range warnings {
		fmt.Fprintf(cmd.ErrOrStderr(), "warning: %s\n", w)
	}

	in, out := cmd.InOrStdin(), cmd.OutOrStdout()
	interactive := opts.execute == "" && opts.file == "" && shell.IsTerminal(in) && shell.IsTerminal(out)
	sh := &shell.Shell{
		In: in, Out: out, Err: cmd.ErrOrStderr(),
		Backend: *backend, Version: Version, Profile: s.Profile,
		Format: opts.format, Paging: opts.paging, Timing: opts.timing,
		Styled:      shell.IsTerminal(out) && os.Getenv("NO_COLOR") == "",
		Width:       shell.TerminalWidth(out),
		HistoryFile: opts.history, HistorySize: opts.historySize, ViMode: opts.vi,
		Connect: func(ctx context.Context, profile string) (*shell.Backend, error) {
			np, err := config.LoadProfile(s.Path, profile)
			if err != nil {
				return nil, err
			}
			b, ws, err := shell.Dial(ctx, mgr, cache, profile, np)
			for _, w := range ws {
				fmt.Fprintf(cmd.ErrOrStderr(), "warning: %s\n", w)
			}
			return b, err
		},
	}

	sh.Abbreviations = s.Config.Shell.Abbreviations
	sh.ConfigPath = s.Path
	if sh.ConfigPath == "" {
		sh.ConfigPath, _ = config.ConfigPath("")
	}
	for name, body := range s.Config.Shell.Aliases {
		sh.DefineAlias(name, body)
	}

	switch {
	case opts.execute != "":
		return sh.RunScript(ctx, "", opts.execute, shell.ScriptOptions{ContinueOnError: opts.continueOnError, AbortCode: cli.ExitCQL})
	case opts.file != "":
		var data []byte
		if opts.file == "-" {
			data, err = io.ReadAll(in)
		} else {
			data, err = os.ReadFile(config.ExpandPath(opts.file))
		}
		if err != nil {
			return cli.Usage(err)
		}
		return sh.RunScript(ctx, opts.file, string(data), shell.ScriptOptions{Echo: opts.echo, ContinueOnError: opts.continueOnError})
	case !interactive && !shell.IsTerminal(in):
		data, err := io.ReadAll(in)
		if err != nil {
			return err
		}
		return sh.RunScript(ctx, "stdin", string(data), shell.ScriptOptions{Echo: opts.echo, ContinueOnError: opts.continueOnError})
	}

	if !opts.quiet {
		shell.PrintBanner(out, shell.BannerInfo{
			Name: name, Cluster: backend.Cluster, Version: Version, Consistency: p.Consistency,
		})
	}
	if err := os.MkdirAll(filepath.Dir(opts.history), 0o700); err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "warning: history disabled: %v\n", err)
		sh.HistoryFile = ""
	}
	return sh.Run(ctx)
}

// shellFlags is the resolved shell and script configuration (SPEC §4.2.2).
type shellFlags struct {
	execute, file, format, history string
	paging, historySize            int
	echo, continueOnError, quiet   bool
	timing, vi                     bool
}

func shellOptions(s *config.Settings) (shellFlags, error) {
	v := s.V
	o := shellFlags{
		execute: v.GetString("execute"), file: v.GetString("file"),
		format:          strings.ToLower(v.GetString("shell.format")),
		paging:          v.GetInt("shell.paging"),
		echo:            v.GetBool("shell.echo"),
		continueOnError: v.GetBool("shell.continue_on_error"),
		quiet:           v.GetBool("shell.quiet"),
		timing:          v.GetBool("shell.timing"),
		vi:              v.GetBool("shell.vi_mode"),
		historySize:     v.GetInt("shell.history_size"),
		history:         config.ExpandPath(v.GetString("paths.history")),
	}
	switch o.format {
	case "table", "expanded", "raw":
	default:
		return o, fmt.Errorf("invalid --format %q: use table, expanded or raw", o.format)
	}
	if o.paging < 0 {
		return o, fmt.Errorf("invalid --paging %d: use 0 or a positive number", o.paging)
	}
	if o.history == "" {
		o.history = filepath.Join(config.StateDir(), "history")
	}
	return o, nil
}

// describeFailure re-runs the staged test to name the stage that failed.
func describeFailure(ctx context.Context, p config.Profile, cause error) error {
	res := conn.Test(ctx, p)
	if res.OK || res.FailedStage == "" {
		return fmt.Errorf("connection failed: %w", cause)
	}
	return fmt.Errorf("connection failed at the %s stage: %s", res.FailedStage, res.Error)
}

// notImplemented reports an unbuilt command and exits with the usage code (2).
func notImplemented(what, milestone string) {
	fmt.Fprintf(os.Stderr, "%s: not implemented yet (planned for %s)\n", what, milestone)
	os.Exit(cli.ExitUsage)
}

// Execute adds all child commands to the root command and sets flags appropriately.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		if !errors.Is(err, context.Canceled) && !errors.Is(err, shell.ErrReported) {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		}
		os.Exit(cli.Code(err))
	}
}

func init() {
	rootCmd.SetFlagErrorFunc(cli.FlagError)
	config.AddConfigFlag(rootCmd)
	config.AddConnectionFlags(rootCmd, true)
	config.AddShellFlags(rootCmd)
}
