package complete

import (
	"context"
	"testing"
)

func TestAliasNamesAfterColon(t *testing.T) {
	res := CompleteWith(context.Background(), nil, "", ":re", 3, []string{"recent", "other"})
	if len(res.Items) != 1 || res.Items[0].Insert != ":recent" {
		t.Errorf("items = %+v", res.Items)
	}
}
