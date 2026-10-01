package cmd

import (
	"github.com/spf13/cobra"
)

var profileShowCmd = &cobra.Command{
	Use:   "show <name>",
	Short: "Show a profile (secrets redacted)",
	Long:  `Show a profile (secrets redacted).`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		notImplemented(cmd.CommandPath(), "M2")
	},
}

func init() {
	profileCmd.AddCommand(profileShowCmd)
}
