package cli

import (
	"errors"
	"fmt"
	"io"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/auth"
	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/store"
)

func openUserStore(cmd *cobra.Command) (*store.Store, error) {
	s, err := config.Resolve(cmd)
	if err != nil {
		return nil, err
	}
	return store.Open(config.DBPath(s.V.GetString("paths.db")))
}

// newPassword reads a password from stdin (-s) or prompts twice with echo off.
func newPassword(cmd *cobra.Command, w io.Writer) (string, error) {
	if stdin, _ := cmd.Flags().GetBool("password-stdin"); stdin {
		return ReadPasswordStdin(cmd.InOrStdin())
	}
	in, ok := cmd.InOrStdin().(*os.File)
	if !ok {
		return "", Usagef("a password is required; use --password-stdin when input is not a terminal")
	}
	p1, err := PromptPassword("Password: ", in, w)
	if err != nil {
		return "", err
	}
	p2, err := PromptPassword("Confirm password: ", in, w)
	if err != nil {
		return "", err
	}
	if p1 != p2 {
		return "", Usagef("passwords do not match")
	}
	return p1, nil
}

// UserAdd creates a web UI user.
func UserAdd(cmd *cobra.Command, w io.Writer, username string) error {
	st, err := openUserStore(cmd)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()
	pw, err := newPassword(cmd, w)
	if err != nil {
		return err
	}
	if err := auth.New(st).CreateUser(username, pw); err != nil {
		if errors.Is(err, store.ErrUserExists) {
			return Usagef("user %q already exists", username)
		}
		return Usage(err)
	}
	fmt.Fprintf(w, "Created user %q\n", username)
	return nil
}

// UserPasswd changes a password and signs the user out of every session.
func UserPasswd(cmd *cobra.Command, w io.Writer, username string) error {
	st, err := openUserStore(cmd)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()
	if _, err := st.UserByName(username); err != nil {
		return userErr(err, username)
	}
	pw, err := newPassword(cmd, w)
	if err != nil {
		return err
	}
	if err := auth.New(st).SetPassword(username, pw); err != nil {
		return userErr(err, username)
	}
	fmt.Fprintf(w, "Changed the password for %q and signed them out everywhere\n", username)
	return nil
}

// UserRemove deletes a user after confirmation unless --yes is set; their sessions stop working.
func UserRemove(cmd *cobra.Command, w io.Writer, username string) error {
	st, err := openUserStore(cmd)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()
	if _, err := st.UserByName(username); err != nil {
		return userErr(err, username)
	}
	if yes, _ := cmd.Flags().GetBool("yes"); !yes {
		if !Confirm(cmd.InOrStdin(), w, fmt.Sprintf("Remove user %q?", username)) {
			return Usagef("aborted")
		}
	}
	if err := st.DeleteUser(username); err != nil {
		return userErr(err, username)
	}
	fmt.Fprintf(w, "Removed user %q\n", username)
	return nil
}

// UserList prints every user.
func UserList(cmd *cobra.Command, w io.Writer) error {
	st, err := openUserStore(cmd)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()
	users, err := st.ListUsers()
	if err != nil {
		return err
	}
	if len(users) == 0 {
		fmt.Fprintln(w, "No users. Create one with: helenus user add <username>")
		return nil
	}
	tw := tabwriter.NewWriter(w, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "USERNAME\tCREATED\tLAST SIGN-IN")
	for _, u := range users {
		last := u.LastLoginAt
		if last == "" {
			last = "never"
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\n", u.Username, u.CreatedAt, last)
	}
	return tw.Flush()
}

func userErr(err error, username string) error {
	if errors.Is(err, store.ErrUserNotFound) {
		return Usagef("no such user %q", username)
	}
	return Usage(err)
}
