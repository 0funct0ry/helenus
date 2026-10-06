package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/config"
)

var userListCmd = &cobra.Command{
	Use:          "list",
	Short:        "List web UI users",
	Long:         `List web UI users.`,
	Args:         cli.Args(cobra.NoArgs),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return cli.UserList(cmd, cmd.OutOrStdout())
	},
}

func init() {
	config.AddDBFlag(userListCmd)
	userCmd.AddCommand(userListCmd)
}
