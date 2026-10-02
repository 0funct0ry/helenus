package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
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
	for _, f := range []string{"execute", "file"} {
		if v, _ := cmd.Flags().GetString(f); v != "" {
			notImplemented("--"+f, "M4")
		}
	}
	s, err := config.Resolve(cmd)
	if err != nil {
		return cli.Usage(err)
	}
	p, err := config.ResolveProfile(cmd, s, args)
	if err != nil {
		return cli.Usage(err)
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
	name := p.Name
	if name == "" {
		name = p.Hosts[0]
	}
	sess, warnings, err := mgr.Session(ctx, name, p)
	if err != nil {
		return cli.ConnectionFailed(describeFailure(ctx, p, err))
	}
	for _, w := range warnings {
		fmt.Fprintf(cmd.ErrOrStderr(), "warning: %s\n", w)
	}
	info, err := conn.Info(ctx, sess)
	if err != nil {
		return cli.ConnectionFailed(err)
	}
	if quiet := s.V.GetBool("shell.quiet"); !quiet {
		shell.PrintBanner(cmd.OutOrStdout(), shell.BannerInfo{
			Name: name, Cluster: info, Version: Version, Consistency: p.Consistency,
		})
	}
	port := p.Port
	if port == 0 {
		port = 9042
	}
	sh := &shell.Shell{
		In: cmd.InOrStdin(), Out: cmd.OutOrStdout(), Err: cmd.ErrOrStderr(),
		Describer: &sessionDescriber{name: name, sess: sess, cache: schema.NewCache()},
		Cluster:   info, Version: Version, Host: p.Hosts[0], Port: port,
	}
	sh.Run(ctx)
	return nil
}

// sessionDescriber answers the shell's DESCRIBE statements from the live session.
type sessionDescriber struct {
	name  string
	sess  *gocql.Session
	cache *schema.Cache
}

func (d *sessionDescriber) Describe(ctx context.Context, t schema.Target, currentKS string) (string, error) {
	return d.cache.Describe(ctx, d.name, d.sess, t, currentKS)
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
		if !errors.Is(err, context.Canceled) {
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
