package cmd

import (
	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/server"
)

var uiCmd = &cobra.Command{
	Use:   "ui",
	Short: "Start the web UI",
	Long:  `Serve the Helenus web UI on a local address (default 127.0.0.1:4042).`,
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		s, err := config.Resolve(cmd)
		if err != nil {
			return err
		}
		return server.Run(cmd.Context(), server.Options{
			Addr:    s.V.GetString("ui.addr"),
			Open:    s.V.GetBool("ui.open_browser"),
			Version: Version,
			Stderr:  cmd.ErrOrStderr(),
		})
	},
}

func init() {
	config.AddUIFlags(uiCmd)
	rootCmd.AddCommand(uiCmd)
}
