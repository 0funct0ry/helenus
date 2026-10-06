package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/config"
)

var userAddCmd = &cobra.Command{
	Use:          "add <username>",
	Short:        "Create a web UI user (prompts for password)",
	Long:         `Create a web UI user (prompts for password).`,
	Args:         cli.Args(cobra.ExactArgs(1)),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return cli.UserAdd(cmd, cmd.OutOrStdout(), args[0])
	},
}

func init() {
	config.AddPasswordStdinFlag(userAddCmd)
	config.AddDBFlag(userAddCmd)
	userCmd.AddCommand(userAddCmd)
}
