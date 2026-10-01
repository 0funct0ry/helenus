package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/config"
)

var userListCmd = &cobra.Command{
	Use:   "list",
	Short: "List web UI users",
	Long:  `List web UI users.`,
	Args:  cobra.NoArgs,
	Run: func(cmd *cobra.Command, args []string) {
		notImplemented(cmd.CommandPath(), "M10")
	},
}

func init() {
	config.AddDBFlag(userListCmd)
	userCmd.AddCommand(userListCmd)
}
