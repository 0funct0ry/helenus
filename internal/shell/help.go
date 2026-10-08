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
	".use":         {".use <keyspace>", "Switch the current keyspace. The prompt shows it."},
	".consistency": {".consistency [level]", "Show or set the consistency level for this session."},
	".serial":      {".serial consistency [serial|local_serial]", "Show or set the serial consistency level used by lightweight transactions."},
	".expand":      {".expand on|off", "Print rows as one record per block (shorthand for .format expanded and .format table)."},
	".format":      {".format table|expanded|raw", "Choose the output format. raw is tab-separated with the header first and nulls empty."},
	".paging":      {".paging on|off|<rows>", "Set the page size. At a terminal, the shell stops after each page with a --More-- prompt. off fetches everything without stopping."},
	".describe":    {".describe cluster|keyspaces|keyspace [ks]|tables|table <t>|types|type <t>|materialized view <v>|index <i>|functions|function <f>|aggregates|schema|full schema", "Print schema definitions. .desc is short for .describe."},
	".tables":      {".tables", "List the tables in the current keyspace with their keys, index and view counts."},
	".views":       {".views", "List the materialized views in the current keyspace."},
	".types":       {".types", "List the user-defined types in the current keyspace."},
	".functions":   {".functions", "List the user-defined functions in the current keyspace."},
	".aggregates":  {".aggregates", "List the user-defined aggregates in the current keyspace."},
	".indexes":     {".indexes", "List the indexes (including SAI) in the current keyspace."},
	".triggers":    {".triggers", "List the triggers on tables in the current keyspace."},
	".show":        {".show version | .show host | .show session <trace-id>", "Print version details, the connected contact point, or a stored trace."},
	".tracing":     {".tracing on|off", "Trace every statement and print the trace table after its results."},
	".timing":      {".timing on|off", "Print the client round-trip time after each statement, with the coordinator time when tracing is on."},
	".source":      {".source '<file>'", "Run the statements in a script file. Stops at the first error."},
	".save":        {".save [-n N | -a] [-f] <path> | .save --db [-n N | -a] [-f] [--global] <name>", "Write the last statement (or the last N, or all with -a) of this session to a file, or to the query library with --db. An existing file needs -f."},
	".open":        {".open <path>", "Edit a file in $VISUAL or $EDITOR, then offer to run its statements."},
	".queries":     {".queries [filter]", "List the saved queries of the query library, optionally filtered by name."},
	".load":        {".load [--global] <name>", "Edit a saved query in your editor, offer to run it, and offer to save changes back to the library."},
	".clear":       {".clear | .cls", "Clear the screen."},
	".help":        {".help [command]", "List commands, or explain one."},
	".exit":        {".exit | .quit", "Leave the shell. Ctrl-D on an empty line does the same."},
	".profile":     {".profile [name]", "Show the current profile, or reconnect using another profile from the config file."},
	".alias":       {".alias [name [= body]] | .alias --save [name] | .alias --dry-run :name [args]", "List, show or define an alias. --save writes it to the config file; --dry-run prints the expanded CQL without running it."},
	".unalias":     {".unalias <name>", "Remove an alias for this session."},
	".set":         {".set [name [value]]", "List or set a template variable available to alias bodies."},
	".unset":       {".unset <name>", "Remove a template variable."},
	".abbrev":      {".abbrev", "List abbreviations; typing one at the start of a statement followed by a space expands it."},
	":":            {":<alias> [args…]", "Run an alias. Its body is a Go template that expands to CQL."},
}

var helpAlias = map[string]string{".desc": ".describe", ".quit": ".exit", ".cls": ".clear"}

func (s *Shell) help(args []string) {
	if len(args) == 0 {
		names := make([]string, 0, len(helpTopics))
		for k := range helpTopics {
			names = append(names, k)
		}
		sort.Strings(names)
		fmt.Fprintln(s.Out, "Shell commands (lowercase, start with a dot, the semicolon is optional):")
		fmt.Fprintln(s.Out)
		rows := make([][]string, len(names))
		for i, k := range names {
			rows[i] = []string{helpTopics[k].usage, helpTopics[k].text}
		}
		s.printTable([]string{"command", "what it does"}, rows)
		fmt.Fprintln(s.Out)
		fmt.Fprintln(s.Out, "Anything else is sent to Cassandra as CQL. End a statement with a semicolon.")
		fmt.Fprintln(s.Out, "Type .help <command> for details. Ctrl-C cancels input or a running query; Ctrl-D exits.")
		return
	}
	t := strings.ToLower(args[0])
	if t != ":" && !strings.HasPrefix(t, ".") {
		t = "." + t
	}
	if a, ok := helpAlias[t]; ok {
		t = a
	}
	if e, ok := helpTopics[t]; ok {
		fmt.Fprintf(s.Out, "%s\n\n  %s\n", paint(ansiHeader+"\x1b[1m", e.usage, s.Styled), e.text)
		return
	}
	fmt.Fprintf(s.Out, "No help for %q. Type .help for the list of commands.\n", args[0])
}
