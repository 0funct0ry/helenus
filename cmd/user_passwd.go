package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/config"
)

var userPasswdCmd = &cobra.Command{
	Use:          "passwd <username>",
	Short:        "Change a web UI user's password",
	Long:         `Change a web UI user's password.`,
	Args:         cli.Args(cobra.ExactArgs(1)),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return cli.UserPasswd(cmd, cmd.OutOrStdout(), args[0])
	},
}

func init() {
	config.AddPasswordStdinFlag(userPasswdCmd)
	config.AddDBFlag(userPasswdCmd)
	userCmd.AddCommand(userPasswdCmd)
}
