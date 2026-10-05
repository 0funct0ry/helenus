// Package config loads Helenus configuration and wires command-line flags,
// environment variables and config file keys into one precedence chain
// (flag > environment > config file > default).
package config

import (
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// Kind is the value type of a flag.
type Kind int

// Flag value kinds.
const (
	String Kind = iota
	Int
	Bool
	StringSlice
)

// Spec describes one flag: its names, default and where it lives in the config file.
type Spec struct {
	Name    string
	Short   string
	Kind    Kind
	Default any
	Usage   string
	// Key is the config file key. Connection settings (Profile) live under
	// profiles.<name>.<Key>. Empty for flags that are not settings.
	Key string
	// Profile marks a connection setting stored under the selected profile.
	Profile bool
	// Setting is true when the flag must have a config key. One-shot action
	// flags (--execute, --yes, ...) and locator flags (--config, --profile)
	// are not settings (SPEC §4.2 rule 4).
	Setting bool
}

// Env returns the environment variable name: HELENUS_ + upper snake long name.
func (s Spec) Env() string {
	return "HELENUS_" + strings.ToUpper(strings.ReplaceAll(s.Name, "-", "_"))
}

func conn(name, short string, kind Kind, def any, usage, key string) Spec {
	return Spec{Name: name, Short: short, Kind: kind, Default: def, Usage: usage, Key: key, Profile: true, Setting: true}
}

func setting(name, short string, kind Kind, def any, usage, key string) Spec {
	return Spec{Name: name, Short: short, Kind: kind, Default: def, Usage: usage, Key: key, Setting: true}
}

func action(name, short string, kind Kind, def any, usage string) Spec {
	return Spec{Name: name, Short: short, Kind: kind, Default: def, Usage: usage}
}

// Specs for every flag in SPEC §4.2.
var (
	ConfigFlag  = action("config", "c", String, "", "Config file (default $XDG_CONFIG_HOME/helenus/config.yaml)")
	ProfileFlag = action("profile", "P", String, "", "Connection profile to use (default \"default\" if present)")

	connectionSpecs = []Spec{
		conn("hosts", "H", StringSlice, []string{"127.0.0.1"}, "Contact points, comma-separated", "hosts"),
		conn("port", "o", Int, 9042, "Native protocol port", "port"),
		conn("username", "u", String, "", "Username for PasswordAuthenticator", "username"),
		conn("password", "p", String, "", "Password (prompted when -u is set without one)", "password"),
		action("password-stdin", "s", Bool, false, "Read the password from stdin"),
		conn("keyspace", "k", String, "", "Initial keyspace", "keyspace"),
		conn("consistency", "C", String, "LOCAL_ONE", "Initial consistency level", "consistency"),
		conn("serial-consistency", "S", String, "SERIAL", "Serial consistency level for lightweight transactions", "serial_consistency"),
		conn("dc", "d", String, "", "Local datacenter for DC-aware routing", "dc"),
		conn("ssl", "t", Bool, false, "Enable TLS", "tls.enabled"),
		conn("ca-cert", "a", String, "", "PEM CA bundle", "tls.ca_cert"),
		conn("cert", "r", String, "", "Client certificate for mTLS", "tls.cert"),
		conn("key", "K", String, "", "Client key for mTLS", "tls.key"),
		conn("insecure-skip-verify", "i", Bool, false, "Disable TLS hostname and chain verification", "tls.insecure_skip_verify"),
		conn("secure-bundle", "b", String, "", "Astra secure connect bundle (.zip)", "astra.secure_bundle"),
		conn("token", "T", String, "", "Astra application token", "astra.token"),
		conn("connect-timeout", "w", String, "5s", "Connect timeout", "connect_timeout"),
		conn("request-timeout", "R", String, "10s", "Request timeout", "request_timeout"),
		conn("protocol-version", "V", Int, 0, "Native protocol version override (0 = auto)", "protocol_version"),
	}

	shellSpecs = []Spec{
		action("execute", "e", String, "", "Execute the given CQL and exit"),
		action("file", "f", String, "", "Execute a script file and exit"),
		setting("format", "F", String, "table", "Output format: table, expanded or raw", "shell.format"),
		setting("echo", "E", Bool, false, "Echo each statement of a -f script", "shell.echo"),
		setting("continue-on-error", "x", Bool, false, "Keep running a -f script after a failure", "shell.continue_on_error"),
		setting("quiet", "q", Bool, false, "Suppress the startup banner", "shell.quiet"),
		setting("paging", "g", Int, 100, "Rows per page; 0 disables paging", "shell.paging"),
		setting("timing", "m", Bool, false, "Print client round-trip time per statement", "shell.timing"),
		setting("vi-mode", "v", Bool, false, "Use vi key bindings", "shell.vi_mode"),
		setting("history-size", "n", Int, 10000, "Maximum history entries", "shell.history_size"),
		setting("history-file", "j", String, "", "History file (default XDG state path)", "paths.history"),
	}

	uiSpecs = []Spec{
		setting("addr", "a", String, "127.0.0.1:4042", "Listen address", "ui.addr"),
		setting("open", "o", Bool, true, "Open the browser on start (--open=false disables)", "ui.open_browser"),
		setting("auth", "A", Bool, false, "Require sign-in", "ui.auth.enabled"),
		setting("tls-cert", "C", String, "", "Serve HTTPS with this certificate", "ui.tls.cert"),
		setting("tls-key", "K", String, "", "Private key for --tls-cert", "ui.tls.key"),
		setting("max-upload", "U", Int, 1024, "Largest import upload in MB", "ui.max_upload_mb"),
	}

	// DBFlag is declared on ui and the user commands.
	DBFlag = setting("db", "D", String, "", "SQLite file (default XDG data path)", "paths.db")
	// YesFlag skips confirmation prompts.
	YesFlag = action("yes", "y", Bool, false, "Skip the confirmation prompt")
)

var registry = buildRegistry()

func buildRegistry() map[string]Spec {
	m := map[string]Spec{}
	all := [][]Spec{connectionSpecs, shellSpecs, uiSpecs, {ConfigFlag, ProfileFlag, DBFlag, YesFlag}}
	for _, group := range all {
		for _, s := range group {
			m[s.Name] = s
		}
	}
	return m
}

// Lookup returns the spec registered for a flag name.
func Lookup(name string) (Spec, bool) {
	s, ok := registry[name]
	return s, ok
}

func add(fs *pflag.FlagSet, s Spec) {
	switch s.Kind {
	case String:
		fs.StringP(s.Name, s.Short, s.Default.(string), s.Usage)
	case Int:
		fs.IntP(s.Name, s.Short, s.Default.(int), s.Usage)
	case Bool:
		fs.BoolP(s.Name, s.Short, s.Default.(bool), s.Usage)
	case StringSlice:
		fs.StringSliceP(s.Name, s.Short, s.Default.([]string), s.Usage)
	}
}

// AddConfigFlag declares the one persistent flag, -c/--config.
func AddConfigFlag(cmd *cobra.Command) { add(cmd.PersistentFlags(), ConfigFlag) }

// AddConnectionFlags declares the connection flags locally on cmd. The root
// command also takes --profile; profile add/test take the name positionally.
func AddConnectionFlags(cmd *cobra.Command, withProfile bool) {
	if withProfile {
		add(cmd.Flags(), ProfileFlag)
	}
	for _, s := range connectionSpecs {
		add(cmd.Flags(), s)
	}
}

// AddShellFlags declares the shell and script flags locally on cmd.
func AddShellFlags(cmd *cobra.Command) {
	for _, s := range shellSpecs {
		add(cmd.Flags(), s)
	}
}

// AddUIFlags declares the `helenus ui` flags (including --db) locally on cmd.
func AddUIFlags(cmd *cobra.Command) {
	for _, s := range uiSpecs {
		add(cmd.Flags(), s)
	}
	AddDBFlag(cmd)
}

// AddDBFlag declares -D/--db locally on cmd.
func AddDBFlag(cmd *cobra.Command) { add(cmd.Flags(), DBFlag) }

// AddYesFlag declares -y/--yes locally on cmd.
func AddYesFlag(cmd *cobra.Command) { add(cmd.Flags(), YesFlag) }

// AddPasswordStdinFlag declares -s/--password-stdin locally on cmd.
func AddPasswordStdinFlag(cmd *cobra.Command) {
	add(cmd.Flags(), registry["password-stdin"])
}
