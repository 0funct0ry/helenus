package config

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
	"github.com/spf13/viper"
)

// SecretCommandTimeout bounds password_command and token_command (SPEC §5.3).
const SecretCommandTimeout = 5 * time.Second

// TLS holds the profile's tls.* keys.
type TLS struct {
	Enabled            bool   `mapstructure:"enabled" yaml:"enabled,omitempty" json:"enabled"`
	CACert             string `mapstructure:"ca_cert" yaml:"ca_cert,omitempty" json:"ca_cert,omitempty"`
	Cert               string `mapstructure:"cert" yaml:"cert,omitempty" json:"cert,omitempty"`
	Key                string `mapstructure:"key" yaml:"key,omitempty" json:"key,omitempty"`
	ServerName         string `mapstructure:"server_name" yaml:"server_name,omitempty" json:"server_name,omitempty"`
	InsecureSkipVerify bool   `mapstructure:"insecure_skip_verify" yaml:"insecure_skip_verify,omitempty" json:"insecure_skip_verify"`
}

// Astra holds the profile's astra.* keys.
type Astra struct {
	SecureBundle string `mapstructure:"secure_bundle" yaml:"secure_bundle,omitempty" json:"secure_bundle,omitempty"`
	Token        string `mapstructure:"token" yaml:"token,omitempty" json:"-"`
	TokenCommand string `mapstructure:"token_command" yaml:"token_command,omitempty" json:"-"`
}

// Profile is one named connection (SPEC §5.2). Secret fields carry json:"-"
// so a Profile can never leak them through the API; use Redacted for output.
type Profile struct {
	Name              string   `mapstructure:"-" yaml:"-" json:"name"`
	Hosts             []string `mapstructure:"hosts" yaml:"hosts,omitempty" json:"hosts"`
	Port              int      `mapstructure:"port" yaml:"port,omitempty" json:"port"`
	Keyspace          string   `mapstructure:"keyspace" yaml:"keyspace,omitempty" json:"keyspace,omitempty"`
	Consistency       string   `mapstructure:"consistency" yaml:"consistency,omitempty" json:"consistency,omitempty"`
	SerialConsistency string   `mapstructure:"serial_consistency" yaml:"serial_consistency,omitempty" json:"serial_consistency,omitempty"`
	DC                string   `mapstructure:"dc" yaml:"dc,omitempty" json:"dc,omitempty"`
	Username          string   `mapstructure:"username" yaml:"username,omitempty" json:"username,omitempty"`
	Password          string   `mapstructure:"password" yaml:"password,omitempty" json:"-"`
	PasswordCommand   string   `mapstructure:"password_command" yaml:"password_command,omitempty" json:"-"`
	TLS               TLS      `mapstructure:"tls" yaml:"tls,omitempty" json:"tls"`
	Astra             Astra    `mapstructure:"astra" yaml:"astra,omitempty" json:"astra"`
	ConnectTimeout    string   `mapstructure:"connect_timeout" yaml:"connect_timeout,omitempty" json:"connect_timeout,omitempty"`
	RequestTimeout    string   `mapstructure:"request_timeout" yaml:"request_timeout,omitempty" json:"request_timeout,omitempty"`
	ProtocolVersion   int      `mapstructure:"protocol_version" yaml:"protocol_version,omitempty" json:"protocol_version,omitempty"`
}

// RedactedProfile is the secret-free view used by `profile show` and the API.
type RedactedProfile struct {
	Profile
	PasswordSet        bool `json:"password_set"`
	PasswordCommandSet bool `json:"password_command_set"`
	TokenSet           bool `json:"token_set"`
	TokenCommandSet    bool `json:"token_command_set"`
}

// Redacted returns the profile with secrets replaced by "is set" booleans.
func (p Profile) Redacted() RedactedProfile {
	return RedactedProfile{
		Profile:            p,
		PasswordSet:        p.Password != "",
		PasswordCommandSet: p.PasswordCommand != "",
		TokenSet:           p.Astra.Token != "",
		TokenCommandSet:    p.Astra.TokenCommand != "",
	}
}

// ProfileFromViper reads a Profile from the root keys of v (flag > env > profile > default).
func ProfileFromViper(v *viper.Viper, name string) (Profile, error) {
	var p Profile
	if err := v.Unmarshal(&p); err != nil {
		return p, fmt.Errorf("parsing profile: %w", err)
	}
	p.Name = name
	p.Hosts = StringList(v, "hosts")
	if len(p.Hosts) == 0 {
		p.Hosts = []string{"127.0.0.1"}
	}
	return p, nil
}

// ApplyDefaults fills unset fields with the SPEC §4.2.1 defaults.
func (p *Profile) ApplyDefaults() {
	if len(p.Hosts) == 0 {
		p.Hosts = []string{"127.0.0.1"}
	}
	if p.Port == 0 {
		p.Port = 9042
	}
	if p.Consistency == "" {
		p.Consistency = "LOCAL_ONE"
	}
	if p.SerialConsistency == "" {
		p.SerialConsistency = "SERIAL"
	}
	if p.ConnectTimeout == "" {
		p.ConnectTimeout = "5s"
	}
	if p.RequestTimeout == "" {
		p.RequestTimeout = "10s"
	}
}

// LoadProfile returns the named profile from the config file at path.
func LoadProfile(path, name string) (Profile, error) {
	v := viper.New()
	v.SetConfigFile(path)
	if err := v.ReadInConfig(); err != nil {
		return Profile{}, fmt.Errorf("reading config %s: %w", path, err)
	}
	sub := v.Sub("profiles." + name)
	if sub == nil || !v.IsSet("profiles."+name) {
		return Profile{}, &UnknownProfileError{Name: name}
	}
	p, err := ProfileFromViper(sub, name)
	if err != nil {
		return p, err
	}
	p.ApplyDefaults()
	return p, nil
}

// LoadProfiles returns all profiles from the config file, sorted by name. A
// missing file yields no profiles.
func LoadProfiles(path string) ([]Profile, error) {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	v := viper.New()
	v.SetConfigFile(path)
	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("reading config %s: %w", path, err)
	}
	var names []string
	for name := range v.GetStringMap("profiles") {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]Profile, 0, len(names))
	for _, name := range names {
		p, err := LoadProfile(path, name)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// UnknownProfileError reports a profile name that is not in the config file.
type UnknownProfileError struct{ Name string }

func (e *UnknownProfileError) Error() string { return fmt.Sprintf("unknown profile %q", e.Name) }

// ResolveSecrets expands ${ENV}, ~ and runs password_command / token_command,
// returning a copy that is ready to connect with. Secret output is never logged.
func (p Profile) ResolveSecrets(ctx context.Context) (Profile, error) {
	p.Username = os.ExpandEnv(p.Username)
	p.Password = os.ExpandEnv(p.Password)
	p.Astra.Token = os.ExpandEnv(p.Astra.Token)
	if p.Password == "" && p.PasswordCommand != "" {
		out, err := runSecretCommand(ctx, p.PasswordCommand)
		if err != nil {
			return p, fmt.Errorf("password_command: %w", err)
		}
		p.Password = out
	}
	if p.Astra.Token == "" && p.Astra.TokenCommand != "" {
		out, err := runSecretCommand(ctx, p.Astra.TokenCommand)
		if err != nil {
			return p, fmt.Errorf("token_command: %w", err)
		}
		p.Astra.Token = out
	}
	p.TLS.CACert = ExpandPath(p.TLS.CACert)
	p.TLS.Cert = ExpandPath(p.TLS.Cert)
	p.TLS.Key = ExpandPath(p.TLS.Key)
	p.Astra.SecureBundle = ExpandPath(p.Astra.SecureBundle)
	return p, nil
}

// ExpandPath expands a leading ~ to the home directory.
func ExpandPath(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimPrefix(path, "~"))
		}
	}
	return path
}

func runSecretCommand(ctx context.Context, command string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, SecretCommandTimeout)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd", "/C", command)
	} else {
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "sh"
		}
		cmd = exec.CommandContext(ctx, shell, "-c", command)
	}
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	// stderr is dropped on purpose: it may echo secrets.
	if err := cmd.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", fmt.Errorf("timed out after %s", SecretCommandTimeout)
		}
		return "", fmt.Errorf("command failed: %w", err)
	}
	return strings.TrimSpace(stdout.String()), nil
}

// ResolveProfile builds the connection profile for cmd: the selected profile,
// overridden by env vars and flags, then positional host [port] (root only).
func ResolveProfile(cmd *cobra.Command, s *Settings, args []string) (Profile, error) {
	if s.Profile != "" && s.Profile != DefaultProfile && !s.ProfileExists {
		return Profile{}, &UnknownProfileError{Name: s.Profile}
	}
	p, err := ProfileFromViper(s.V, s.Profile)
	if err != nil {
		return p, err
	}
	if len(args) > 0 {
		p.Hosts = []string{args[0]}
	}
	if len(args) > 1 {
		var port int
		if _, err := fmt.Sscanf(args[1], "%d", &port); err != nil || port <= 0 || port > 65535 {
			return p, fmt.Errorf("invalid port %q", args[1])
		}
		p.Port = port
	}
	p.ApplyDefaults()
	return p, nil
}

// ExplicitProfile returns the connection settings set explicitly by flag or
// environment on cmd, keyed by config key (e.g. "tls.ca_cert"). Used by
// `profile add` so only deliberate settings reach the file.
func ExplicitProfile(cmd *cobra.Command) map[string]any {
	out := map[string]any{}
	cmd.Flags().VisitAll(func(f *pflag.Flag) {
		spec, ok := Lookup(f.Name)
		if !ok || !spec.Profile {
			return
		}
		switch {
		case f.Changed:
		case os.Getenv(spec.Env()) != "":
			if err := f.Value.Set(os.Getenv(spec.Env())); err != nil {
				return
			}
		default:
			return
		}
		switch spec.Kind {
		case Int:
			n, _ := cmd.Flags().GetInt(f.Name)
			out[spec.Key] = n
		case Bool:
			b, _ := cmd.Flags().GetBool(f.Name)
			out[spec.Key] = b
		case StringSlice:
			l, _ := cmd.Flags().GetStringSlice(f.Name)
			out[spec.Key] = l
		default:
			out[spec.Key] = f.Value.String()
		}
	})
	return out
}
