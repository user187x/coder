package platformbanner_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/platformbanner"
)

// The ids the banner service (Python, json.dumps) gave the same banners: the
// dismissals and receipts keyed by them must survive the move into coderd.
func TestIDMatchesTheBannerService(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		f        platformbanner.Fields
		revision int64
		id       string
	}{
		{platformbanner.Fields{Level: "info"}, 0, "a33fd46da6a4"},
		{platformbanner.Fields{Level: "warning", Title: "Heads up", Message: "Maintenance \"Saturday\" 02:00\\03:00\nline2\ttab",
			LinkText: "Details", LinkURL: "/docs"}, 3, "2dd86e9aa5d5"},
		{platformbanner.Fields{Level: "critical", Title: "Ünïcödé — 日本語",
			Message: "emoji 🚀 and 👩‍💻 and \x7f del \x01 ctrl <b>&amp;</b>", LinkURL: "https://example.com/a?b=c&d=e",
			Picture: "/pictures/usa.gif", Countdown: "2026-10-20T18:00:00Z"}, 12, "d3c303be2189"},
		{platformbanner.Fields{Level: "success", Picture: "https://x.test/p.png"}, 1, "270365862eed"},
	} {
		require.Equal(t, c.id, platformbanner.ID(c.f, c.revision), "%+v", c.f)
	}
	// how it looks does not change the id
	f := platformbanner.Fields{Level: "info", Message: "hi"}
	g := f
	g.Enabled, g.Effect, g.Font, g.Outline = true, "kitt", "serif", true
	require.Equal(t, platformbanner.ID(f, 1), platformbanner.ID(g, 1))
	require.NotEqual(t, platformbanner.ID(f, 1), platformbanner.ID(f, 2), "show again: a new id")
}

func clean(t *testing.T, payload any) (platformbanner.Fields, error) {
	t.Helper()
	raw, err := json.Marshal(payload)
	require.NoError(t, err)
	return platformbanner.Clean(raw)
}

func TestCleanFillsAndChecks(t *testing.T) {
	t.Parallel()
	f, err := clean(t, map[string]any{"message": "  hello  ", "speed": "fast", "unknown": 1, "id": "ignored"})
	require.NoError(t, err)
	want := platformbanner.FieldDefaults()
	want.Message, want.Speed, want.CrawlSpeed = "hello", "fast", 26 // the legacy pace for "fast"
	require.Equal(t, want, f)
	require.True(t, f.LoopText)
	for _, loop := range []bool{false, true} {
		configured, err := clean(t, map[string]any{"message": "hello", "loopText": loop})
		require.NoError(t, err)
		require.Equal(t, loop, configured.LoopText)
	}

	for _, c := range []struct {
		payload any
		err     string
	}{
		{map[string]any{"message": "x", "loopText": "true"}, "loopText must be true or false."},
		{map[string]any{"message": 5}, "message must be text."},
		{map[string]any{"title": strings.Repeat("é", 81), "message": "x"}, "title is too long (max 80 characters)."},
		{map[string]any{"message": "x", "dismissible": "yes"}, "dismissible must be true or false."},
		{map[string]any{"message": "x", "level": "loud"}, "Style must be one of: info, success, warning, critical."},
		{map[string]any{"message": "x", "effect": nil}, "Text effect must be one of: none, typewriter, fade, rise, wave, bounce, flip, shake, pulse, rainbow, starwars, pewpew, flap, shimmer, kitt."},
		{map[string]any{"message": "x", "crawlSpeed": 15.5}, "The crawl's speed must be a whole number from 4 to 60."},
		{map[string]any{"message": "x", "crawlSpeed": true}, "The crawl's speed must be a whole number from 4 to 60."},
		{map[string]any{"message": "x", "crawlTilt": 101}, "The crawl's convergence must be a whole number from 0 to 100."},
		{map[string]any{"message": "x", "opacity": 10}, "The banner's opacity must be a whole number from 20 to 100."},
		{map[string]any{"message": "x", "picture": "//evil.test/p.png"}, "The picture's address must start with https://, http:// or /."},
		{map[string]any{"message": "x", "countdown": "tomorrow"}, "The countdown must be a UTC time such as 2026-10-20T18:00:00Z."},
		{map[string]any{"message": "x", "refreshSeconds": 14}, "Check interval must be between 15 and 3600 seconds."},
		{map[string]any{}, "Write a message (or choose a background image or a countdown) before publishing the banner."},
		{map[string]any{"message": "x", "linkUrl": "javascript:alert(1)"}, "The link must start with https://, http:// or /."},
		{[]any{1}, "Expected a JSON object."},
	} {
		_, err := clean(t, c.payload)
		require.EqualError(t, err, c.err, "%v", c.payload)
	}
	_, err = platformbanner.Clean([]byte("{nope"))
	require.EqualError(t, err, "Invalid JSON.")
	// 1e2 and 100.0 are not whole numbers to the banner service (Python floats)
	for _, raw := range []string{`{"message":"x","refreshSeconds":1e2}`, `{"message":"x","refreshSeconds":100.0}`} {
		_, err = platformbanner.Clean([]byte(raw))
		require.EqualError(t, err, "Check interval must be between 15 and 3600 seconds.", raw)
	}
	_, err = platformbanner.Clean([]byte(`{"message":"x","refreshSeconds":100}`))
	require.NoError(t, err)

	// a picture alone, or a countdown alone, is an announcement; disabled needs nothing
	_, err = clean(t, map[string]any{"picture": "/pictures/usa.gif"})
	require.NoError(t, err)
	_, err = clean(t, map[string]any{"countdown": "2026-10-20T18:00Z"})
	require.NoError(t, err)
	_, err = clean(t, map[string]any{"enabled": false})
	require.NoError(t, err)
}

func TestSafeURL(t *testing.T) {
	t.Parallel()
	for u, ok := range map[string]bool{
		"/": true, "/docs": true, "https://x.test": true, "HTTP://X.TEST/a": true,
		"//x.test": false, "http://": false, "ftp://x": false, "/a b": false, "javascript:x": false, "": false,
	} {
		require.Equal(t, ok, platformbanner.SafeURL(u), u)
	}
}

func TestTargetAudience(t *testing.T) {
	t.Parallel()
	id := "672ea503-0c18-4456-840d-a4d6068491a1"
	f, err := clean(t, map[string]any{"message": "Private notice", "audience": "selected", "audienceUserIds": []string{id}, "showOnLoginPage": true, "autoScrollSpeed": 12, "pauseOnHover": true})
	require.NoError(t, err)
	require.False(t, f.ShowOnLoginPage)
	require.Equal(t, 12, f.AutoScrollSpeed)
	require.True(t, f.PauseOnHover)
	b := platformbanner.Banner{Fields: f}
	require.Empty(t, b.ForViewer("").Message)
	require.Empty(t, b.ForViewer("someone-else").Message)
	require.Equal(t, "Private notice", b.ForViewer(id).Message)
	require.Empty(t, b.ForViewer(id).AudienceUserIDs)
	for _, payload := range []map[string]any{{"audience": "selected"}, {"audience": "other"}, {"audience": "selected", "audienceUserIds": []string{"bad"}}, {"autoScrollSpeed": 0}, {"autoScrollSpeed": 61}} {
		_, err := clean(t, payload)
		require.Error(t, err)
	}
}

func TestCountdownActions(t *testing.T) {
	t.Parallel()
	for _, action := range []string{"none", "shake", "focus"} {
		f, err := clean(t, map[string]any{"message": "notice", "countdownAction": action})
		require.NoError(t, err)
		require.Equal(t, action, f.CountdownAction)
	}
	_, err := clean(t, map[string]any{"message": "notice", "countdownAction": "invalid"})
	require.Error(t, err)
	f := platformbanner.Fields{Message: "notice"}
	original := platformbanner.ID(f, 0)
	f.CountdownAction = "none"
	require.Equal(t, original, platformbanner.ID(f, 0))
	f.CountdownAction = "focus"
	require.NotEqual(t, original, platformbanner.ID(f, 0))
}
