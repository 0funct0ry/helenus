package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/config"
)

var profileAddCmd = &cobra.Command{
	Use:   "add <name>",
	Short: "Create a profile from connection flags",
	Long: `Create a profile from connection flags.

Only settings given by flag or environment variable are written; everything
else keeps its default. Comments and key order in config.yaml are preserved.`,
	Args:         cli.Args(cobra.ExactArgs(1)),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return cli.ProfileAdd(cmd, cmd.OutOrStdout(), args[0])
	},
}

func init() {
	config.AddConnectionFlags(profileAddCmd, false)
	profileCmd.AddCommand(profileAddCmd)
}
