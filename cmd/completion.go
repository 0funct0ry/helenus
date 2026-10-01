package cmd

import (
	"os"

	"github.com/spf13/cobra"
)

var completionCmd = &cobra.Command{
	Use:       "completion <shell>",
	Short:     "Generate shell completion (bash, zsh, fish, powershell)",
	Long:      `Print a completion script for the given shell to stdout.`,
	Args:      cobra.MatchAll(cobra.ExactArgs(1), cobra.OnlyValidArgs),
	ValidArgs: []string{"bash", "zsh", "fish", "powershell"},
	RunE: func(cmd *cobra.Command, args []string) error {
		switch args[0] {
		case "bash":
			return rootCmd.GenBashCompletionV2(os.Stdout, true)
		case "zsh":
			return rootCmd.GenZshCompletion(os.Stdout)
		case "fish":
			return rootCmd.GenFishCompletion(os.Stdout, true)
		default:
			return rootCmd.GenPowerShellCompletionWithDesc(os.Stdout)
		}
	},
}

func init() { rootCmd.AddCommand(completionCmd) }
