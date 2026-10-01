package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/cli"
)

var profileListCmd = &cobra.Command{
	Use:          "list",
	Short:        "List profiles",
	Long:         `List the profiles in config.yaml.`,
	Args:         cli.Args(cobra.NoArgs),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return cli.ProfileList(cmd, cmd.OutOrStdout())
	},
}

func init() {
	profileCmd.AddCommand(profileListCmd)
}
