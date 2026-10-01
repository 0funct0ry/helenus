package cmd

import "github.com/spf13/cobra"

var userCmd = &cobra.Command{
	Use:   "user",
	Short: "Manage web UI users",
	Long:  `Add, list, change and remove the users who may sign in to the web UI.`,
}

func init() { rootCmd.AddCommand(userCmd) }
