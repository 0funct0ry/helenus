package shell

import (
	"fmt"
	"sort"
	"strings"
)

type helpEntry struct {
	usage string
	text  string
}

var helpTopics = map[string]helpEntry{
	"USE":         {"USE <keyspace>", "Switch the current keyspace. The prompt shows it."},
	"CONSISTENCY": {"CONSISTENCY [level]", "Show or set the consistency level for this session."},
	"SERIAL":      {"SERIAL CONSISTENCY [SERIAL|LOCAL_SERIAL]", "Show or set the serial consistency level used by lightweight transactions."},
	"EXPAND":      {"EXPAND ON|OFF", "Print rows as one record per block (shorthand for FORMAT expanded and FORMAT table)."},
	"FORMAT":      {"FORMAT table|expanded|raw", "Choose the output format. raw is tab-separated with the header first and nulls empty."},
	"PAGING":      {"PAGING ON|OFF|<rows>", "Set the page size. At a terminal, the shell stops after each page with a --More-- prompt. OFF fetches everything without stopping."},
	"DESCRIBE":    {"DESCRIBE CLUSTER|KEYSPACES|KEYSPACE [ks]|TABLES|TABLE <t>|TYPES|TYPE <t>|MATERIALIZED VIEW <v>|INDEX <i>|FUNCTIONS|FUNCTION <f>|AGGREGATES|SCHEMA|FULL SCHEMA", "Print schema definitions. DESC is short for DESCRIBE."},
	"SHOW":        {"SHOW VERSION | SHOW HOST | SHOW SESSION <trace-id>", "Print version details, the connected contact point, or a stored trace."},
	"TRACING":     {"TRACING ON|OFF", "Trace every statement and print the trace table after its results."},
	"TIMING":      {"TIMING ON|OFF", "Print the client round-trip time after each statement, with the coordinator time when tracing is on."},
	"SOURCE":      {"SOURCE '<file>'", "Run the statements in a script file. Stops at the first error."},
	"CLEAR":       {"CLEAR | CLS", "Clear the screen."},
	"HELP":        {"HELP [topic]", "List commands, or explain one."},
	"EXIT":        {"EXIT | QUIT", "Leave the shell. Ctrl-D on an empty line does the same."},
	`\PROFILE`:    {`\profile [name]`, "Show the current profile, or reconnect using another profile from the config file."},
}

var helpAlias = map[string]string{"DESC": "DESCRIBE", "QUIT": "EXIT", "CLS": "CLEAR", "PROFILE": `\PROFILE`}

func (s *Shell) help(args []string) {
	if len(args) == 0 {
		names := make([]string, 0, len(helpTopics))
		for k := range helpTopics {
			names = append(names, k)
		}
		sort.Strings(names)
		fmt.Fprintln(s.Out, "Shell commands (case-insensitive, the semicolon is optional):")
		fmt.Fprintln(s.Out)
		for _, k := range names {
			fmt.Fprintf(s.Out, "  %s\n", helpTopics[k].usage)
		}
		fmt.Fprintln(s.Out)
		fmt.Fprintln(s.Out, "Anything else is sent to Cassandra as CQL. End a statement with a semicolon.")
		fmt.Fprintln(s.Out, "Type HELP <command> for details. Ctrl-C cancels input or a running query; Ctrl-D exits.")
		return
	}
	t := strings.ToUpper(strings.TrimPrefix(args[0], `\`))
	if strings.HasPrefix(args[0], `\`) {
		t = `\` + t
	}
	if a, ok := helpAlias[t]; ok {
		t = a
	}
	if e, ok := helpTopics[t]; ok {
		fmt.Fprintf(s.Out, "%s\n\n  %s\n", e.usage, e.text)
		return
	}
	fmt.Fprintf(s.Out, "No help for %q. Type HELP for the list of commands.\n", args[0])
}
