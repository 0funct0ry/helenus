package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/config"
)

var profileRemoveCmd = &cobra.Command{
	Use:          "remove <name>",
	Short:        "Delete a profile",
	Long:         `Delete a profile from config.yaml, asking for confirmation unless --yes is given.`,
	Args:         cli.Args(cobra.ExactArgs(1)),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return cli.ProfileRemove(cmd, cmd.OutOrStdout(), args[0])
	},
}

func init() {
	config.AddYesFlag(profileRemoveCmd)
	profileCmd.AddCommand(profileRemoveCmd)
}
