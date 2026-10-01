package cmd

import "github.com/spf13/cobra"

var profileCmd = &cobra.Command{
	Use:   "profile",
	Short: "Manage connection profiles",
	Long:  `List, show, add, remove and test named connection profiles.`,
}

func init() { rootCmd.AddCommand(profileCmd) }
