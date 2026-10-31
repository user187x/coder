package coderd

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/codersdk"
)

func TestValidateLeaseTerms(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, mode    string
		domains       []string
		noRoot, valid bool
	}{
		{name: "unrestricted", mode: "all", noRoot: true, valid: true},
		{name: "normalized", mode: "allowlist", domains: []string{" *.Example.com "}, noRoot: true, valid: true},
		{name: "root denied", mode: "all"},
		{name: "empty allowlist", mode: "allowlist", noRoot: true},
		{name: "URL rejected", mode: "blocklist", domains: []string{"https://example.com"}, noRoot: true},
		{name: "duplicates", mode: "blocklist", domains: []string{"example.com", "EXAMPLE.com"}, noRoot: true},
		{name: "ignored domains", mode: "all", domains: []string{"example.com"}, noRoot: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			terms := codersdk.ShortTermLeaseTerms{NoRoot: tc.noRoot, SandboxOnly: true, WebsiteMode: tc.mode, Websites: tc.domains}
			err := validateLeaseTerms(&terms)
			if !tc.valid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, terms.Websites)
			if tc.mode == "allowlist" {
				require.Equal(t, []string{"example.com"}, terms.Websites)
			}
		})
	}
}
