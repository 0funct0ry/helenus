package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/config"
)

// rootCmd is the interactive shell; -e and -f run one-shot CQL.
var rootCmd = &cobra.Command{
	Use:   "helenus [host [port]]",
	Short: "A local-first Cassandra client: cqlsh-compatible shell and web UI",
	Long: `Helenus is a local-first Cassandra client shipped as one binary.

Run it with no subcommand to start the interactive CQL shell, with -e or -f to
run CQL non-interactively, or use "helenus ui" for the web UI.`,
	Args: cobra.MaximumNArgs(2),
	Run: func(cmd *cobra.Command, args []string) {
		notImplemented("the interactive shell", "M4")
	},
}

// notImplemented reports an unbuilt command and exits with the usage code (2).
func notImplemented(what, milestone string) {
	fmt.Fprintf(os.Stderr, "%s: not implemented yet (planned for %s)\n", what, milestone)
	os.Exit(2)
}

// Execute adds all child commands to the root command and sets flags appropriately.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	config.AddConfigFlag(rootCmd)
	config.AddConnectionFlags(rootCmd, true)
	config.AddShellFlags(rootCmd)
}
