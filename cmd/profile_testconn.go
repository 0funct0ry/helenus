package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/config"
)

var profileTestCmd = &cobra.Command{
	Use:   "test <name>",
	Short: "Connect, report version and topology, then disconnect",
	Long:  `Connect, report version and topology, then disconnect.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		notImplemented(cmd.CommandPath(), "M2")
	},
}

func init() {
	config.AddConnectionFlags(profileTestCmd, false)
	profileCmd.AddCommand(profileTestCmd)
}
