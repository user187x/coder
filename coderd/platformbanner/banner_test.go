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
		{platformbanner.Fields{
			Level: "warning", Title: "Heads up", Message: "Maintenance \"Saturday\" 02:00\\03:00\nline2\ttab",
			LinkText: "Details", LinkURL: "/docs",
		}, 3, "2dd86e9aa5d5"},
		{platformbanner.Fields{
			Level: "critical", Title: "Ünïcödé \u2014 日本語",
			Message: "emoji 🚀 and 👩‍💻 and \x7f del \x01 ctrl <b>&amp;</b>", LinkURL: "https://example.com/a?b=c&d=e",
			Picture: "/pictures/usa.gif", Countdown: "2026-10-20T18:00:00Z",
		}, 12, "d3c303be2189"},
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

func TestCleanBlankBannerAndClearedFields(t *testing.T) {
	t.Parallel()
	f, err := clean(t, map[string]any{"enabled": true})
	require.NoError(t, err, "an enabled banner may be blank")
	require.True(t, f.Enabled)
	require.Empty(t, f.Message)
	require.Empty(t, f.Picture)
	require.Empty(t, f.Countdown)

	// A cleared field is stored cleared, not kept from before.
	f, err = clean(t, map[string]any{
		"enabled": true, "picture": "", "linkText": "", "linkUrl": "", "title": "", "countdown": "",
	})
	require.NoError(t, err)
	require.Empty(t, f.Picture)
	require.Empty(t, f.LinkText)
	require.Empty(t, f.LinkURL)
	require.Empty(t, f.Title)
	require.Empty(t, f.Countdown)
}

func TestCleanDismissible(t *testing.T) {
	t.Parallel()
	f, err := clean(t, map[string]any{"message": "x"})
	require.NoError(t, err)
	require.True(t, f.Dismissible, "dismissible unless turned off")
	f, err = clean(t, map[string]any{"message": "x", "dismissible": false})
	require.NoError(t, err)
	require.False(t, f.Dismissible)
}

func TestCleanPulldown(t *testing.T) {
	t.Parallel()
	f, err := clean(t, map[string]any{"message": "x"})
	require.NoError(t, err)
	require.True(t, f.Pulldown, "the pulldown is on unless turned off")
	f, err = clean(t, map[string]any{"message": "x", "pulldown": false})
	require.NoError(t, err)
	require.False(t, f.Pulldown)
}

func TestCleanIntroductions(t *testing.T) {
	t.Parallel()
	f, err := clean(t, map[string]any{"message": "hello"})
	require.NoError(t, err)
	require.False(t, f.Introductions, "settings saved before it existed: off")
	f, err = clean(t, map[string]any{"message": "hello", "introductions": true})
	require.NoError(t, err)
	require.True(t, f.Introductions)
}

// The effects ported from the visualfx library: the banner's text and the
// introduction accept every one.
func TestCleanAcceptsLibraryEffects(t *testing.T) {
	t.Parallel()
	for _, effect := range []string{"gold", "hologram", "vaporwave", "slam", "terminal", "prism", "sparkle", "frost", "longshadow", "retro", "popart", "glitch", "elastic", "pendulum", "stretch", "jitter", "iridescent", "motionblur", "karaoke", "marker", "loud", "duotone"} {
		for _, key := range []string{"effect", "introEffect"} {
			f, err := clean(t, map[string]any{"message": "x", key: effect})
			require.NoError(t, err, "%s=%s", key, effect)
			if key == "effect" {
				require.Equal(t, effect, f.Effect)
			} else {
				require.Equal(t, effect, f.IntroEffect)
			}
		}
	}
}

func TestCleanIntroductionLook(t *testing.T) {
	t.Parallel()
	f, err := clean(t, map[string]any{"message": "hello"})
	require.NoError(t, err)
	require.Equal(t, "none", f.IntroEffect, "settings saved before it existed: the fade")
	require.Equal(t, 2000, f.IntroDurationMs)
	require.Equal(t, "normal", f.IntroSize)
	require.Equal(t, "semibold", f.IntroWeight)

	f, err = clean(t, map[string]any{
		"message": "hello", "introEffect": "pewpew", "introDurationMs": 7500,
		"introSize": "xlarge", "introWeight": "black",
	})
	require.NoError(t, err)
	require.Equal(t, "pewpew", f.IntroEffect)
	require.Equal(t, 7500, f.IntroDurationMs)
	require.Equal(t, "xlarge", f.IntroSize)
	require.Equal(t, "black", f.IntroWeight)

	for _, c := range []struct {
		field string
		value any
		err   string
	}{
		{"introEffect", "confetti", "Introduction text effect must be one of: none, typewriter, fade, rise, wave, bounce, flip, shake, pulse, rainbow, pewpew, flap, shimmer, kitt, aurora, neon, chrome, focus, ember, spectrum, anaglyph, heartbeat, softblur, voltage, gold, hologram, vaporwave, slam, terminal, prism, sparkle, frost, longshadow, retro, popart, glitch, elastic, pendulum, stretch, jitter, iridescent, motionblur, karaoke, marker, loud, duotone."},
		{"introEffect", "starwars", "Introduction text effect must be one of: none, typewriter, fade, rise, wave, bounce, flip, shake, pulse, rainbow, pewpew, flap, shimmer, kitt, aurora, neon, chrome, focus, ember, spectrum, anaglyph, heartbeat, softblur, voltage, gold, hologram, vaporwave, slam, terminal, prism, sparkle, frost, longshadow, retro, popart, glitch, elastic, pendulum, stretch, jitter, iridescent, motionblur, karaoke, marker, loud, duotone."},
		{"introEffect", 3, "Introduction text effect must be one of: none, typewriter, fade, rise, wave, bounce, flip, shake, pulse, rainbow, pewpew, flap, shimmer, kitt, aurora, neon, chrome, focus, ember, spectrum, anaglyph, heartbeat, softblur, voltage, gold, hologram, vaporwave, slam, terminal, prism, sparkle, frost, longshadow, retro, popart, glitch, elastic, pendulum, stretch, jitter, iridescent, motionblur, karaoke, marker, loud, duotone."},
		{"introDurationMs", 500, "The introduction's duration (milliseconds) must be a whole number from 1000 to 10000."},
		{"introDurationMs", 10500, "The introduction's duration (milliseconds) must be a whole number from 1000 to 10000."},
		{"introDurationMs", 2.5, "The introduction's duration (milliseconds) must be a whole number from 1000 to 10000."},
		{"introDurationMs", 2250, "The introduction's duration must be a multiple of 500 milliseconds."},
		{"introSize", "huge", "Introduction size must be one of: normal, large, xlarge."},
		{"introWeight", "thin", "Introduction weight must be one of: semibold, bold, black."},
	} {
		_, err := clean(t, map[string]any{"message": "x", c.field: c.value})
		require.EqualError(t, err, c.err, "%s=%v", c.field, c.value)
	}
}

func TestCleanFillsAndChecks(t *testing.T) {
	t.Parallel()
	f, err := clean(t, map[string]any{"message": "  hello  ", "speed": "fast", "unknown": 1, "id": "ignored"})
	require.NoError(t, err)
	want := platformbanner.FieldDefaults()
	want.Message, want.Speed, want.CrawlSpeed = "hello", "fast", 26 // the legacy pace for "fast"
	require.Equal(t, want, f)
	require.True(t, f.LoopText)
	require.False(t, f.AnimationsDisabled)
	for _, loop := range []bool{false, true} {
		configured, err := clean(t, map[string]any{"message": "hello", "loopText": loop, "animationsDisabled": loop})
		require.NoError(t, err)
		require.Equal(t, loop, configured.LoopText)
		require.Equal(t, loop, configured.AnimationsDisabled)
	}

	for _, c := range []struct {
		payload any
		err     string
	}{
		{map[string]any{"message": "x", "animationsDisabled": "true"}, "animationsDisabled must be true or false."},
		{map[string]any{"message": "x", "loopText": "true"}, "loopText must be true or false."},
		{map[string]any{"message": 5}, "message must be text."},
		{map[string]any{"title": strings.Repeat("é", 81), "message": "x"}, "title is too long (max 80 characters)."},
		{map[string]any{"message": "x", "introductions": "yes"}, "introductions must be true or false."},
		{map[string]any{"message": "x", "dismissible": "yes"}, "dismissible must be true or false."},
		{map[string]any{"message": "x", "pulldown": "yes"}, "pulldown must be true or false."},
		{map[string]any{"message": "x", "level": "loud"}, "Style must be one of: info, success, warning, critical."},
		{map[string]any{"message": "x", "effect": nil}, "Text effect must be one of: none, typewriter, fade, rise, wave, bounce, flip, shake, pulse, rainbow, starwars, pewpew, flap, shimmer, kitt, aurora, neon, chrome, focus, ember, spectrum, anaglyph, heartbeat, softblur, voltage, gold, hologram, vaporwave, slam, terminal, prism, sparkle, frost, longshadow, retro, popart, glitch, elastic, pendulum, stretch, jitter, iridescent, motionblur, karaoke, marker, loud, duotone."},
		{map[string]any{"message": "x", "crawlSpeed": 15.5}, "The crawl's speed must be a whole number from 4 to 60."},
		{map[string]any{"message": "x", "crawlSpeed": true}, "The crawl's speed must be a whole number from 4 to 60."},
		{map[string]any{"message": "x", "crawlTilt": 101}, "The crawl's convergence must be a whole number from 0 to 100."},
		{map[string]any{"message": "x", "opacity": 10}, "The banner's opacity must be a whole number from 20 to 100."},
		{map[string]any{"message": "x", "picture": "//evil.test/p.png"}, "The picture's address must start with https://, http:// or /."},
		{map[string]any{"message": "x", "countdown": "tomorrow"}, "The countdown must be a UTC time such as 2026-10-20T18:00:00Z."},
		{map[string]any{"message": "x", "refreshSeconds": 14}, "Check interval must be between 15 and 3600 seconds."},
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

func TestImageAndTextEffects(t *testing.T) {
	t.Parallel()
	for _, effect := range []string{"none", "pan-up", "pan-down", "roller", "glitch", "fade", "gaussian", "ripple"} {
		f, err := clean(t, map[string]any{"message": "Test", "pictureEffect": effect})
		require.NoError(t, err)
		require.Equal(t, effect, f.PictureEffect)
		encoded, err := json.Marshal(f)
		require.NoError(t, err)
		saved, err := platformbanner.Clean(encoded)
		require.NoError(t, err)
		require.Equal(t, effect, saved.PictureEffect)
	}
	_, err := clean(t, map[string]any{"message": "Test", "pictureEffect": "unsupported"})
	require.Error(t, err)
	for _, effect := range []string{"aurora", "neon", "chrome", "focus", "ember", "spectrum", "anaglyph", "heartbeat", "softblur", "voltage"} {
		f, err := clean(t, map[string]any{"message": "Test", "effect": effect})
		require.NoError(t, err)
		require.Equal(t, effect, f.Effect)
	}
}
