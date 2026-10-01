package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/config"
)

var userRemoveCmd = &cobra.Command{
	Use:   "remove <username>",
	Short: "Delete a web UI user and revoke their tokens",
	Long:  `Delete a web UI user and revoke their tokens.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		notImplemented(cmd.CommandPath(), "M10")
	},
}

func init() {
	config.AddYesFlag(userRemoveCmd)
	config.AddDBFlag(userRemoveCmd)
	userCmd.AddCommand(userRemoveCmd)
}
