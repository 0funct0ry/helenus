package cmd

import (
	"github.com/spf13/cobra"
)

var profileListCmd = &cobra.Command{
	Use:   "list",
	Short: "List profiles",
	Long:  `List profiles.`,
	Args:  cobra.NoArgs,
	Run: func(cmd *cobra.Command, args []string) {
		notImplemented(cmd.CommandPath(), "M2")
	},
}

func init() {
	profileCmd.AddCommand(profileListCmd)
}
