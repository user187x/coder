package platformbanner

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTargetedLiveDelivery(t *testing.T) {
	t.Parallel()
	b := Banner{Fields: Fields{Audience: "selected", AudienceUserIDs: []string{"recipient"}, Message: "private"}}
	require.JSONEq(t, `{"type":"refresh"}`, string(delivery(b)))
	b.Audience = "everyone"
	require.Contains(t, string(delivery(b)), "private")
	require.NotContains(t, string(delivery(b)), "recipient")
}
