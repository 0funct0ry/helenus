package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
	"github.com/spf13/viper"
)

// EnvPrefix is prepended to every environment variable Helenus reads.
const EnvPrefix = "HELENUS"

// DefaultProfile is used when no --profile is given and a profile of that name exists.
const DefaultProfile = "default"

// Config is the parsed config file (SPEC §5.2). Profiles are read through LoadProfile(s).
type Config struct {
	Profiles map[string]map[string]any `mapstructure:"profiles"`
	Shell    ShellConfig               `mapstructure:"shell"`
	UI       UIConfig                  `mapstructure:"ui"`
	Paths    PathsConfig               `mapstructure:"paths"`
}

// ShellConfig holds the shell.* keys.
type ShellConfig struct {
	Format          string            `mapstructure:"format"`
	Paging          int               `mapstructure:"paging"`
	Timing          bool              `mapstructure:"timing"`
	HistorySize     int               `mapstructure:"history_size"`
	ViMode          bool              `mapstructure:"vi_mode"`
	Quiet           bool              `mapstructure:"quiet"`
	Echo            bool              `mapstructure:"echo"`
	ContinueOnError bool              `mapstructure:"continue_on_error"`
	Abbreviations   map[string]string `mapstructure:"abbreviations"`
	Aliases         map[string]string `mapstructure:"aliases"`
}

// UIConfig holds the ui.* keys.
type UIConfig struct {
	Addr        string `mapstructure:"addr"`
	OpenBrowser bool   `mapstructure:"open_browser"`
	Auth        struct {
		Enabled bool `mapstructure:"enabled"`
	} `mapstructure:"auth"`
	TLS struct {
		Cert string `mapstructure:"cert"`
		Key  string `mapstructure:"key"`
	} `mapstructure:"tls"`
}

// PathsConfig holds the paths.* keys. Empty means the XDG default.
type PathsConfig struct {
	DB      string `mapstructure:"db"`
	History string `mapstructure:"history"`
}

// Settings is the resolved view of one command's configuration.
type Settings struct {
	// V answers lookups by config key with flag > env > file > default precedence.
	V *viper.Viper
	// Config is the typed config file content with the same precedence applied.
	Config Config
	// Path is the config file that was read, empty if none exists.
	Path string
	// Profile is the selected profile name, empty if none.
	Profile string
	// ProfileExists reports whether Profile is defined in the config file.
	ProfileExists bool
}

// ConfigPath returns the config file location: -c flag, HELENUS_CONFIG, then XDG.
// explicit reports whether the path was requested rather than defaulted.
func ConfigPath(flagValue string) (path string, explicit bool) {
	if flagValue != "" {
		return flagValue, true
	}
	if env := os.Getenv(ConfigFlag.Env()); env != "" {
		return env, true
	}
	return filepath.Join(configDir(), "config.yaml"), false
}

func configDir() string { return xdgDir("XDG_CONFIG_HOME", ".config") }

// DataDir returns the directory for the SQLite file and bundles.
func DataDir() string { return xdgDir("XDG_DATA_HOME", filepath.Join(".local", "share")) }

// StateDir returns the directory for shell history.
func StateDir() string { return xdgDir("XDG_STATE_HOME", filepath.Join(".local", "state")) }

func xdgDir(env, fallback string) string {
	if runtime.GOOS == "windows" {
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, "helenus")
		}
	}
	if dir := os.Getenv(env); dir != "" {
		return filepath.Join(dir, "helenus")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, fallback, "helenus")
}

// Resolve builds the settings for cmd. Each command gets its own viper so that
// identically named local flags on different commands never share state.
func Resolve(cmd *cobra.Command) (*Settings, error) { return ResolveNamed(cmd, "") }

// ResolveNamed is Resolve for commands that take the profile name as a
// positional argument (profile test) instead of --profile. An empty name
// falls back to the --profile selection.
func ResolveNamed(cmd *cobra.Command, name string) (*Settings, error) {
	v := viper.New()
	s := &Settings{V: v}

	cfgFlag, _ := cmd.Flags().GetString(ConfigFlag.Name)
	path, explicit := ConfigPath(cfgFlag)
	v.SetConfigFile(path)
	if err := v.ReadInConfig(); err != nil {
		if !explicit && (errors.Is(err, fs.ErrNotExist) || os.IsNotExist(err)) {
			v = viper.New()
			s.V = v
		} else {
			return nil, fmt.Errorf("reading config %s: %w", path, err)
		}
	} else {
		s.Path = path
	}

	if name != "" || cmd.Flags().Lookup(ProfileFlag.Name) != nil {
		s.Profile = name
		if name == "" {
			s.Profile = selectProfile(cmd, v)
		}
		if s.Profile != "" {
			if p := v.GetStringMap("profiles." + s.Profile); len(p) > 0 {
				s.ProfileExists = true
				if err := v.MergeConfigMap(p); err != nil {
					return nil, err
				}
			}
		}
	}

	var bindErr error
	cmd.Flags().VisitAll(func(f *pflag.Flag) {
		spec, ok := Lookup(f.Name)
		if !ok {
			return
		}
		key := spec.Key
		if key == "" {
			key = spec.Name
		}
		if err := v.BindPFlag(key, f); err != nil {
			bindErr = err
		}
		if err := v.BindEnv(key, spec.Env()); err != nil {
			bindErr = err
		}
	})
	if bindErr != nil {
		return nil, bindErr
	}

	setDefaults(v)
	if err := v.Unmarshal(&s.Config); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}
	return s, nil
}

// setDefaults registers defaults for settings not exposed as flags on this command.
func setDefaults(v *viper.Viper) {
	for _, spec := range registry {
		if spec.Key != "" && !spec.Profile {
			v.SetDefault(spec.Key, spec.Default)
		}
	}
}

func selectProfile(cmd *cobra.Command, v *viper.Viper) string {
	f := cmd.Flags().Lookup(ProfileFlag.Name)
	switch {
	case f.Changed:
		return f.Value.String()
	case os.Getenv(ProfileFlag.Env()) != "":
		return os.Getenv(ProfileFlag.Env())
	case v.IsSet("profiles." + DefaultProfile):
		return DefaultProfile
	}
	return ""
}

// StringList reads a comma-separated list setting from flag, env or config.
func StringList(v *viper.Viper, key string) []string {
	var out []string
	for _, item := range v.GetStringSlice(key) {
		for _, part := range strings.Split(item, ",") {
			if part = strings.TrimSpace(part); part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}
