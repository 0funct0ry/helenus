package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/config"
)

var profileTestCmd = &cobra.Command{
	Use:   "test <name>",
	Short: "Connect, report version and topology, then disconnect",
	Long: `Connect, report version and topology, then disconnect.

Reports each stage (DNS, TCP, TLS, authentication, protocol) and names the one
that failed. Connection flags override the saved profile for this run only.`,
	Args:         cli.Args(cobra.ExactArgs(1)),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return cli.ProfileTest(cmd.Context(), cmd, cmd.OutOrStdout(), args[0])
	},
}

func init() {
	config.AddConnectionFlags(profileTestCmd, false)
	profileCmd.AddCommand(profileTestCmd)
}
