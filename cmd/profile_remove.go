package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/config"
)

var profileRemoveCmd = &cobra.Command{
	Use:   "remove <name>",
	Short: "Delete a profile",
	Long:  `Delete a profile.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		notImplemented(cmd.CommandPath(), "M2")
	},
}

func init() {
	config.AddYesFlag(profileRemoveCmd)
	profileCmd.AddCommand(profileRemoveCmd)
}
