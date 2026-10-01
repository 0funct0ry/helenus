package cmd

import (
	"fmt"
	"runtime"
	"runtime/debug"

	"github.com/spf13/cobra"
)

// The following variables are injected at build time via ldflags.
var (
	Version   = "dev"
	Commit    = "unknown"
	BuildDate = "unknown"
)

// versionCmd represents the version command
var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print Helenus, Go, and driver versions",
	Long:  `Print Helenus version information along with the Go runtime and driver versions.`,
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("helenus %s\n", Version)
		fmt.Printf("commit: %s\n", Commit)
		fmt.Printf("build date: %s\n", BuildDate)
		fmt.Printf("go version: %s\n", runtime.Version())

		// Try to find the gocql driver version from build info
		if info, ok := debug.ReadBuildInfo(); ok {
			for _, dep := range info.Deps {
				if dep.Path == "github.com/apache/cassandra-gocql-driver/v2" {
					fmt.Printf("cassandra-gocql-driver %s\n", dep.Version)
				}
			}
		}
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)
}
