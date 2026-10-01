// Package cli holds the helpers behind the thin Cobra command files: exit
// codes (SPEC §4.3), password prompts, confirmations, and profile commands.
package cli

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"
)

// Exit codes from SPEC §4.3.
const (
	ExitCQL        = 1
	ExitUsage      = 2
	ExitConnection = 3
	ExitScript     = 4
)

// ExitError carries a process exit code out of a command.
type ExitError struct {
	Code int
	Err  error
}

func (e *ExitError) Error() string { return e.Err.Error() }
func (e *ExitError) Unwrap() error { return e.Err }

// Usage wraps err as a usage error (exit 2).
func Usage(err error) error { return &ExitError{Code: ExitUsage, Err: err} }

// Usagef formats a usage error.
func Usagef(format string, a ...any) error { return Usage(fmt.Errorf(format, a...)) }

// ConnectionFailed wraps err as a connection or authentication failure (exit 3).
func ConnectionFailed(err error) error { return &ExitError{Code: ExitConnection, Err: err} }

// Code returns the exit code for err: its ExitError code, otherwise 1.
func Code(err error) int {
	var ee *ExitError
	if errors.As(err, &ee) {
		return ee.Code
	}
	return 1
}

// Args wraps a positional-argument validator so its failures exit with the usage code.
func Args(v cobra.PositionalArgs) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if err := v(cmd, args); err != nil {
			return Usage(err)
		}
		return nil
	}
}

// FlagError is a cobra FlagErrorFunc that maps flag errors to the usage code.
func FlagError(_ *cobra.Command, err error) error { return Usage(err) }

// PromptPassword reads a password from the terminal with echo off.
func PromptPassword(prompt string, in *os.File, out io.Writer) (string, error) {
	if !term.IsTerminal(int(in.Fd())) {
		return "", errors.New("a password is required but stdin is not a terminal; use --password-stdin or --password")
	}
	fmt.Fprint(out, prompt)
	b, err := term.ReadPassword(int(in.Fd()))
	fmt.Fprintln(out)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ReadPasswordStdin reads the first line of r as a password.
func ReadPasswordStdin(r io.Reader) (string, error) {
	line, err := bufio.NewReader(r).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	pw := strings.TrimRight(line, "\r\n")
	if pw == "" {
		return "", errors.New("no password on stdin")
	}
	return pw, nil
}

// Confirm asks a yes/no question; only y or yes (any case) is a yes.
func Confirm(r io.Reader, w io.Writer, question string) bool {
	fmt.Fprintf(w, "%s [y/N] ", question)
	line, _ := bufio.NewReader(r).ReadString('\n')
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true
	}
	return false
}
