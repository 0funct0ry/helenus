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
		cfgFlag, _ := cmd.Flags().GetString(config.ConfigFlag.Name)
		cfgPath, _ := config.ConfigPath(cfgFlag)
		if err != nil {
			return err
		}
		return server.Run(cmd.Context(), server.Options{
			ConfigPath: cfgPath,
			Addr:       s.V.GetString("ui.addr"),
			Open:       s.V.GetBool("ui.open_browser"),
			DB:         s.V.GetString("paths.db"),
			MaxUpload:  int64(s.V.GetInt("ui.max_upload_mb")) << 20,
			Version:    Version,
			Stderr:     cmd.ErrOrStderr(),
		})
	},
}

func init() {
	config.AddUIFlags(uiCmd)
	rootCmd.AddCommand(uiCmd)
}
