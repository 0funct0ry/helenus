package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/config"
)

var userRemoveCmd = &cobra.Command{
	Use:          "remove <username>",
	Short:        "Delete a web UI user and revoke their tokens",
	Long:         `Delete a web UI user and revoke their tokens.`,
	Args:         cli.Args(cobra.ExactArgs(1)),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return cli.UserRemove(cmd, cmd.OutOrStdout(), args[0])
	},
}

func init() {
	config.AddYesFlag(userRemoveCmd)
	config.AddDBFlag(userRemoveCmd)
	userCmd.AddCommand(userRemoveCmd)
}
