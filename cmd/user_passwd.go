package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/config"
)

var userPasswdCmd = &cobra.Command{
	Use:   "passwd <username>",
	Short: "Change a web UI user's password",
	Long:  `Change a web UI user's password.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		notImplemented(cmd.CommandPath(), "M10")
	},
}

func init() {
	config.AddPasswordStdinFlag(userPasswdCmd)
	config.AddDBFlag(userPasswdCmd)
	userCmd.AddCommand(userPasswdCmd)
}
