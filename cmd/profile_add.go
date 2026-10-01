package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/config"
)

var profileAddCmd = &cobra.Command{
	Use:   "add <name>",
	Short: "Create a profile from connection flags",
	Long:  `Create a profile from connection flags.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		notImplemented(cmd.CommandPath(), "M2")
	},
}

func init() {
	config.AddConnectionFlags(profileAddCmd, false)
	profileCmd.AddCommand(profileAddCmd)
}
