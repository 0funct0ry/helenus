package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/cli"
)

var profileShowCmd = &cobra.Command{
	Use:          "show <name>",
	Short:        "Show a profile (secrets redacted)",
	Long:         `Show a profile as YAML. Passwords and tokens are masked.`,
	Args:         cli.Args(cobra.ExactArgs(1)),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return cli.ProfileShow(cmd, cmd.OutOrStdout(), args[0])
	},
}

func init() {
	profileCmd.AddCommand(profileShowCmd)
}
