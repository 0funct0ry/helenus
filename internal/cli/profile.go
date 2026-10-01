package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/conn"
)

func configPath(cmd *cobra.Command) string {
	flag, _ := cmd.Flags().GetString(config.ConfigFlag.Name)
	path, _ := config.ConfigPath(flag)
	return path
}

func mapProfileErr(err error) error {
	var unknown *config.UnknownProfileError
	if asUnknown(err, &unknown) {
		return Usage(err)
	}
	return err
}

func asUnknown(err error, target **config.UnknownProfileError) bool {
	for err != nil {
		if u, ok := err.(*config.UnknownProfileError); ok {
			*target = u
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}

// ProfileList prints a table of profiles.
func ProfileList(cmd *cobra.Command, w io.Writer) error {
	profiles, err := config.LoadProfiles(configPath(cmd))
	if err != nil {
		return err
	}
	if len(profiles) == 0 {
		fmt.Fprintln(w, "No profiles. Create one with: helenus profile add <name> --hosts <host>")
		return nil
	}
	tw := tabwriter.NewWriter(w, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "NAME\tTARGET\tAUTH\tTLS")
	for _, p := range profiles {
		target := strings.Join(p.Hosts, ",") + fmt.Sprintf(":%d", p.Port)
		auth := "none"
		switch {
		case p.Astra.SecureBundle != "":
			target, auth = "astra:"+shortPath(p.Astra.SecureBundle), "token"
		case p.Username != "":
			auth = "password"
		}
		tls := "off"
		if p.TLS.Enabled || p.Astra.SecureBundle != "" {
			tls = "on"
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", p.Name, target, auth, tls)
	}
	return tw.Flush()
}

func shortPath(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

// ProfileShow prints one profile as YAML with secrets masked.
func ProfileShow(cmd *cobra.Command, w io.Writer, name string) error {
	p, err := config.LoadProfile(configPath(cmd), name)
	if err != nil {
		return mapProfileErr(err)
	}
	if p.Password != "" {
		p.Password = "********"
	}
	if p.Astra.Token != "" {
		p.Astra.Token = "********"
	}
	out, err := yaml.Marshal(map[string]any{name: p})
	if err != nil {
		return err
	}
	_, err = w.Write(out)
	return err
}

// ProfileAdd writes a new profile from the command's connection flags.
func ProfileAdd(cmd *cobra.Command, w io.Writer, name string) error {
	fields := config.ExplicitProfile(cmd)
	if stdin, _ := cmd.Flags().GetBool("password-stdin"); stdin {
		pw, err := ReadPasswordStdin(cmd.InOrStdin())
		if err != nil {
			return Usage(err)
		}
		fields["password"] = pw
	}
	path := configPath(cmd)
	if err := (config.Writer{Path: path}).AddProfile(name, fields); err != nil {
		return err
	}
	fmt.Fprintf(w, "Added profile %q to %s\n", name, path)
	if _, ok := fields["password"]; ok {
		fmt.Fprintln(w, "Note: the password is stored in plain text; prefer password_command or ${ENV} references.")
	}
	return nil
}

// ProfileRemove deletes a profile after confirmation unless --yes is set.
func ProfileRemove(cmd *cobra.Command, w io.Writer, name string) error {
	path := configPath(cmd)
	if _, err := config.LoadProfile(path, name); err != nil {
		return mapProfileErr(err)
	}
	if yes, _ := cmd.Flags().GetBool("yes"); !yes {
		if !Confirm(cmd.InOrStdin(), w, fmt.Sprintf("Remove profile %q?", name)) {
			return Usagef("aborted")
		}
	}
	if err := (config.Writer{Path: path}).RemoveProfile(name); err != nil {
		return mapProfileErr(err)
	}
	fmt.Fprintf(w, "Removed profile %q\n", name)
	return nil
}

// ProfileTest connects to a saved profile (flags override it) and prints each stage.
func ProfileTest(ctx context.Context, cmd *cobra.Command, w io.Writer, name string) error {
	path := configPath(cmd)
	if _, err := config.LoadProfile(path, name); err != nil {
		return mapProfileErr(err)
	}
	s, err := config.ResolveNamed(cmd, name)
	if err != nil {
		return err
	}
	p, err := config.ResolveProfile(cmd, s, nil)
	if err != nil {
		return Usage(err)
	}
	if stdin, _ := cmd.Flags().GetBool("password-stdin"); stdin {
		pw, err := ReadPasswordStdin(cmd.InOrStdin())
		if err != nil {
			return Usage(err)
		}
		p.Password = pw
	}
	res := conn.Test(ctx, p)
	PrintTest(w, name, res)
	if !res.OK {
		return &ExitError{Code: ExitConnection, Err: fmt.Errorf("connection test failed at the %s stage", res.FailedStage)}
	}
	return nil
}

// PrintTest renders a staged connection test result.
func PrintTest(w io.Writer, name string, res *conn.TestResult) {
	fmt.Fprintf(w, "Testing %s\n", name)
	for _, st := range res.Stages {
		mark, detail := "ok  ", st.Detail
		if !st.OK {
			mark = "FAIL"
		}
		if detail != "" {
			detail = "  " + detail
		}
		fmt.Fprintf(w, "  [%s] %s%s\n", mark, st.Name, detail)
	}
	for _, warn := range res.Warnings {
		fmt.Fprintf(os.Stderr, "warning: %s\n", warn)
	}
	if res.OK && res.Info != nil {
		i := res.Info
		fmt.Fprintf(w, "Connected: Cassandra %s, cluster %s, %d datacenter(s), %d node(s), %.0f ms\n",
			i.ReleaseVersion, i.Name, len(i.Datacenters), i.NodeCount, res.RTTMillis)
	}
}
