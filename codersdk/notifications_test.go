package codersdk_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/codersdk"
)

func TestCustomNotificationValidation(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	for _, tc := range []struct {
		name           string
		ids            []uuid.UUID
		title, message string
		valid          bool
	}{
		{name: "self", title: "Hello", message: "World", valid: true},
		{name: "unicode limit", ids: []uuid.UUID{id}, title: strings.Repeat("界", 120), message: strings.Repeat("界", 2000), valid: true},
		{name: "title too long", title: strings.Repeat("界", 121), message: "World"},
		{name: "empty recipients", ids: []uuid.UUID{}, title: "Hello", message: "World"},
		{name: "duplicate recipients", ids: []uuid.UUID{id, id}, title: "Hello", message: "World"},
		{name: "too many recipients", ids: make([]uuid.UUID, 101), title: "Hello", message: "World"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := (codersdk.CustomNotificationRequest{UserIDs: tc.ids, Content: &codersdk.CustomNotificationContent{Title: tc.title, Message: tc.message}}).Validate()
			if tc.valid {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}
