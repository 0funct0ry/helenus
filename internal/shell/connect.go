// Package shell is the interactive CQL shell. Until M4 it holds only the
// connect banner and a placeholder prompt that accepts EXIT.
package shell

import (
	"bufio"
	"fmt"
	"io"
	"runtime"
	"runtime/debug"
	"strings"

	"github.com/0funct0ry/helenus/internal/conn"
)

// BannerInfo is what the startup banner needs (SPEC §4.4).
type BannerInfo struct {
	Name        string
	Cluster     *conn.ClusterInfo
	Version     string
	Consistency string
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func driverVersion() string {
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, d := range info.Deps {
			if d.Path == "github.com/apache/cassandra-gocql-driver/v2" {
				return d.Version
			}
		}
	}
	return "v2"
}

// PrintBanner writes the four-line startup banner.
func PrintBanner(w io.Writer, b BannerInfo) {
	c := b.Cluster
	proto := ""
	if c.ProtocolVersion != "" {
		proto = ", native protocol v" + strings.TrimPrefix(c.ProtocolVersion, "v")
	}
	fmt.Fprintf(w, "Connected to %s (Cassandra %s, CQL spec %s%s)\n", b.Name, c.ReleaseVersion, c.CQLVersion, proto)
	fmt.Fprintf(w, "Cluster %s · %s · %s · local dc %s\n", c.Name, plural(len(c.Datacenters), "datacenter"), plural(c.NodeCount, "node"), c.LocalDC)
	fmt.Fprintf(w, "helenus %s · %s · cassandra-gocql-driver %s\n", b.Version, runtime.Version(), driverVersion())
	fmt.Fprintf(w, "Type HELP for commands. Consistency: %s\n", b.Consistency)
}

// Placeholder reads lines until EXIT or QUIT (or EOF). The real shell arrives in M4.
func Placeholder(in io.Reader, out io.Writer) {
	sc := bufio.NewScanner(in)
	for {
		fmt.Fprint(out, "helenus> ")
		if !sc.Scan() {
			fmt.Fprintln(out)
			return
		}
		switch strings.ToUpper(strings.TrimSuffix(strings.TrimSpace(sc.Text()), ";")) {
		case "":
		case "EXIT", "QUIT":
			return
		default:
			fmt.Fprintln(out, "not implemented yet (planned for M4); type EXIT to leave")
		}
	}
}
