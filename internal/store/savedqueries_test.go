package store

import (
	"errors"
	"testing"
)

func TestSavedQueriesDeleteUser(t *testing.T) {
	s, _ := open(t)
	if _, err := s.CreateUser("bob", "hash"); err != nil {
		t.Fatal(err)
	}
	u, _ := s.UserByName("bob")
	if _, err := s.CreateSavedQuery(SavedQuery{Owner: u.ID, Name: "q", Text: "t"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateSavedQuery(SavedQuery{Owner: u.ID, Name: "Q"}); !errors.Is(err, ErrSavedQueryExists) {
		t.Fatalf("%v", err)
	}
	if err := s.DeleteUser("bob"); err != nil {
		t.Fatal(err)
	}
	if rows, _ := s.ListSavedQueries(u.ID, "", ""); len(rows) != 0 {
		t.Fatalf("left %v", rows)
	}
}
