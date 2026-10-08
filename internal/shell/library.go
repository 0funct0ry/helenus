package shell

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/0funct0ry/helenus/internal/library"
)

// lib opens the query library on first use, as the local owner.
func (s *Shell) lib() (library.Library, error) {
	if s.st == nil {
		if s.OpenStore == nil {
			return library.Library{}, errors.New("query library unavailable: no database configured")
		}
		st, err := s.OpenStore()
		if err != nil {
			return library.Library{}, fmt.Errorf("query library unavailable: %w", err)
		}
		s.st = st
	}
	return library.Library{Store: s.st}, nil
}

// CloseLibrary closes the library database if it was opened.
func (s *Shell) CloseLibrary() {
	if s.st != nil {
		_ = s.st.Close()
		s.st = nil
	}
}

// LibraryNames lists library names for completion; nil when unavailable.
func (s *Shell) LibraryNames() []string {
	l, err := s.lib()
	if err != nil {
		return nil
	}
	rows, err := l.List(s.Profile, "")
	if err != nil {
		return nil
	}
	names := make([]string, len(rows))
	for i, r := range rows {
		names[i] = r.Name
	}
	return names
}

func (s *Shell) saveToLibrary(a saveArgs, text string, count int) error {
	l, err := s.lib()
	if err != nil {
		return err
	}
	global := a.global || s.Profile == ""
	name, err := library.NormalizeName(unquote(a.target))
	if err != nil {
		return err
	}
	rows, err := l.List(s.Profile, "")
	if err != nil {
		return err
	}
	for _, r := range rows {
		if strings.EqualFold(r.Name, name) && r.Global == global {
			if !a.force {
				return fmt.Errorf("%s: already in the library; use -f to overwrite", name)
			}
			if _, err := l.Update(s.Profile, r.ID, 0, name, text, global); err != nil {
				return err
			}
			s.savedMsg(count, name, global)
			return nil
		}
	}
	if _, err := l.Create(s.Profile, name, text, global); err != nil {
		return err
	}
	s.savedMsg(count, name, global)
	return nil
}

func (s *Shell) savedMsg(count int, name string, global bool) {
	scope := "profile " + s.Profile
	if global {
		scope = "Global"
	}
	fmt.Fprintf(s.Out, "Saved %d %s to the library as %q (%s)\n", count, plural1(count, "statement"), name, scope)
}

func unquote(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && (s[0] == '\'' && s[len(s)-1] == '\'' || s[0] == '"' && s[len(s)-1] == '"') {
		return s[1 : len(s)-1]
	}
	return s
}

// libFlags pulls --global out of the arguments and returns the rest joined.
func libFlags(rest string) (global bool, arg string) {
	var keep []string
	for _, w := range strings.Fields(rest) {
		if w == "--global" {
			global = true
			continue
		}
		keep = append(keep, w)
	}
	return global, strings.Join(keep, " ")
}

// queriesCmd implements .queries [filter].
func (s *Shell) queriesCmd(line string) error {
	l, err := s.lib()
	if err != nil {
		return err
	}
	rows, err := l.List(s.Profile, unquote(rawArgs(line)))
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		fmt.Fprintln(s.Out, "No saved queries.")
		return nil
	}
	table := make([][]string, len(rows))
	for i, r := range rows {
		scope := s.Profile
		if r.Global {
			scope = "Global"
		}
		table[i] = []string{r.Name, scope, localTime(r.UpdatedAt)}
	}
	s.printTable([]string{"name", "scope", "updated"}, table)
	return nil
}

func localTime(stored string) string {
	t, err := time.Parse("2006-01-02T15:04:05.000Z", stored)
	if err != nil {
		return stored
	}
	return t.Local().Format("2006-01-02 15:04")
}

// loadCmd implements .load [--global] <name>.
func (s *Shell) loadCmd(ctx context.Context, line string) error {
	globalOnly, arg := libFlags(rawArgs(line))
	name := unquote(arg)
	if name == "" {
		return syntaxErr("usage: .load [--global] <name>")
	}
	l, err := s.lib()
	if err != nil {
		return err
	}
	q, err := l.FindByName(s.Profile, name, globalOnly)
	if err != nil {
		if errors.Is(err, library.ErrQueryNotFound) {
			return fmt.Errorf("%s: not in the library", name)
		}
		return err
	}
	f, err := os.CreateTemp("", "helenus-*.cql")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, werr := f.WriteString(q.Text)
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		_ = os.Remove(tmp)
		return werr
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.Remove(tmp)
		}
	}()
	final, err := s.editAndRun(ctx, tmp)
	if final == "" && err != nil {
		return err
	}
	if final != q.Text && s.ask("Save changes to the library? [y/N] ") == "y" {
		_, uerr := l.Update(s.Profile, q.ID, q.Version, q.Name, final, q.Global)
		var conf *library.ConflictError
		switch {
		case errors.As(uerr, &conf):
			keep = true
			fmt.Fprintf(s.Out, "changed elsewhere; use .save --db -f to overwrite (your text is in %s)\n", tmp)
		case uerr != nil:
			keep = true
			return uerr
		default:
			fmt.Fprintf(s.Out, "Saved %q to the library.\n", q.Name)
		}
	}
	return err
}
