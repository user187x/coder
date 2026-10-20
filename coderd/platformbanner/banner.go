// Package platformbanner is the dashboard's announcement banner, served by
// coderd itself under /__banner: the banner every page shows (banner.json),
// its live push to open tabs (live), and the admin calls that publish it
// (api/state, api/banner, api/reappear, api/reset). It replaces the banner's
// own service and the Traefik response-body rewrites it needed; the contract
// (paths, JSON, error texts, the banner's id) is that service's, so the
// dashboard and the platform service's receipts work unchanged.
//
// Its state is one runtime-config entry, shared by every replica; a change is
// announced on Coder's pubsub, so each replica pushes it to its own tabs.
package platformbanner

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Fields is a banner as an admin publishes it. The JSON names and their order
// are the contract with the dashboard (api/platform.ts BannerSettings).
type Fields struct {
	Enabled         bool   `json:"enabled"`
	Level           string `json:"level"`
	Title           string `json:"title"`
	Message         string `json:"message"`
	LinkText        string `json:"linkText"`
	LinkURL         string `json:"linkUrl"`
	Dismissible     bool   `json:"dismissible"`
	ShowOnLoginPage bool   `json:"showOnLoginPage"`
	RefreshSeconds  int    `json:"refreshSeconds"`
	Effect          string `json:"effect"`
	Repeat          bool   `json:"repeat"`
	Speed           string `json:"speed"`
	CrawlSpeed      int    `json:"crawlSpeed"`
	CrawlTilt       int    `json:"crawlTilt"`
	Font            string `json:"font"`
	// Receipts: the dashboard records who viewed the announcement and lets
	// them confirm it. Off for a greeting nobody needs to account for.
	Receipts    bool   `json:"receipts"`
	CloseEffect string `json:"closeEffect"`
	OpenEffect  string `json:"openEffect"`
	// The dashboard's editor writes plain text (false); older announcements
	// are Markdown.
	Markdown bool   `json:"markdown"`
	Align    string `json:"align"`
	// The message outlined in a contrasting color, legible over any picture.
	Outline bool `json:"outline"`
	// The banner's background picture (a same-site path or an http(s) URL)
	// and how it fills the banner.
	Picture    string `json:"picture"`
	PictureFit string `json:"pictureFit"`
	// The countdown shown as a watch at the banner's left ("" none).
	Countdown string `json:"countdown"`
}

// Banner is what every page reads: the fields and the banner's id, which the
// dashboard remembers a dismissal by.
type Banner struct {
	Fields
	ID string `json:"id"`
}

// FieldDefaults are the fields an admin's payload leaves out.
func FieldDefaults() Fields {
	return Fields{
		Enabled:         true,
		Level:           "info",
		Dismissible:     true,
		ShowOnLoginPage: true,
		RefreshSeconds:  60,
		Effect:          "none",
		Speed:           "normal",
		CrawlSpeed:      15,
		CrawlTilt:       100,
		Font:            "default",
		Receipts:        true,
		CloseEffect:     "fade",
		OpenEffect:      "none",
		Markdown:        true,
		Align:           "center",
		PictureFit:      "span",
	}
}

// Defaults is the banner before anything is published (and after a reset):
// none shown.
func Defaults() Fields {
	f := FieldDefaults()
	f.Enabled = false
	return f
}

// The choices, in the order the error messages list them. They are the
// dashboard's (BANNER_EFFECTS, BANNER_OPEN_EFFECTS, bannerFonts.ts, ...).
var (
	levels       = []string{"info", "success", "warning", "critical"}
	effects      = []string{"none", "typewriter", "fade", "rise", "wave", "bounce", "flip", "shake", "pulse", "rainbow", "starwars", "pewpew", "flap", "shimmer", "kitt"}
	speeds       = []string{"slow", "normal", "fast"}
	closeEffects = []string{"none", "pixelate", "rollup", "fade", "wipe", "matrix", "gaussian", "evaporate", "kitt"}
	openEffects  = []string{"none", "fade", "rolldown", "kitt", "crt", "glitch"}
	fonts        = []string{"default", "sans", "serif", "condensed", "geist-mono", "ibm-plex-mono", "jetbrains-mono", "fira-code", "source-code-pro"}
	aligns       = []string{"left", "center", "right"}
	pictureFits  = []string{"center", "span", "tile", "fill", "stretch"}
	// The crawl's pace before it had its own setting, by speed.
	legacyCrawlSpeed = map[string]int{"slow": 9, "normal": 15, "fast": 26}
	// The countdown's moment: UTC, to the second at most.
	countdownRe = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z$`)
)

// Text limits, in characters (code points, as the dashboard counts them).
const (
	limitTitle    = 80
	limitMessage  = 4000
	limitLinkText = 60
	limitURL      = 500
)

// ValidationError is a payload an admin must fix; its text is shown to them.
type ValidationError string

func (e ValidationError) Error() string { return string(e) }

// Clean checks an admin's payload and fills in what it leaves out. The rules
// and the messages are the banner service's, in its order.
func Clean(raw []byte) (Fields, error) {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil || payload == nil {
		if err == nil || isJSONValueButNotObject(raw) {
			return Fields{}, ValidationError("Expected a JSON object.")
		}
		return Fields{}, ValidationError("Invalid JSON.")
	}
	out := FieldDefaults()

	for _, t := range []struct {
		key   string
		dst   *string
		limit int
	}{
		{"title", &out.Title, limitTitle},
		{"message", &out.Message, limitMessage},
		{"linkText", &out.LinkText, limitLinkText},
		{"linkUrl", &out.LinkURL, limitURL},
		{"picture", &out.Picture, limitURL},
	} {
		value := ""
		if v, ok := payload[t.key]; ok {
			s, isString := asString(v)
			if !isString {
				return Fields{}, ValidationError(t.key + " must be text.")
			}
			value = s
		}
		value = pyStrip(value)
		if utf8.RuneCountInString(value) > t.limit {
			return Fields{}, ValidationError(fmt.Sprintf("%s is too long (max %d characters).", t.key, t.limit))
		}
		*t.dst = value
	}

	for _, b := range []struct {
		key string
		dst *bool
	}{
		{"enabled", &out.Enabled},
		{"dismissible", &out.Dismissible},
		{"showOnLoginPage", &out.ShowOnLoginPage},
		{"repeat", &out.Repeat},
		{"receipts", &out.Receipts},
		{"markdown", &out.Markdown},
		{"outline", &out.Outline},
	} {
		if v, ok := payload[b.key]; ok {
			var value bool
			if err := json.Unmarshal(v, &value); err != nil || !isJSONBool(v) {
				return Fields{}, ValidationError(b.key + " must be true or false.")
			}
			*b.dst = value
		}
	}

	choice := func(key, fallback, what string, choices []string, dst *string) error {
		value := fallback
		if v, ok := payload[key]; ok {
			s, isString := asString(v)
			if !isString {
				s = "\x00" // never a choice
			}
			value = s
		}
		if !contains(choices, value) {
			return ValidationError(fmt.Sprintf("%s must be one of: %s.", what, strings.Join(choices, ", ")))
		}
		*dst = value
		return nil
	}
	if err := choice("level", "info", "Style", levels, &out.Level); err != nil {
		return Fields{}, err
	}
	if err := choice("closeEffect", "fade", "Close transition", closeEffects, &out.CloseEffect); err != nil {
		return Fields{}, err
	}
	if err := choice("openEffect", "none", "Open transition", openEffects, &out.OpenEffect); err != nil {
		return Fields{}, err
	}
	if err := choice("effect", "none", "Text effect", effects, &out.Effect); err != nil {
		return Fields{}, err
	}
	if err := choice("speed", "normal", "Speed", speeds, &out.Speed); err != nil {
		return Fields{}, err
	}

	crawlDefault, ok := legacyCrawlSpeed[out.Speed]
	if !ok {
		crawlDefault = FieldDefaults().CrawlSpeed
	}
	for _, n := range []struct {
		key       string
		fallback  int
		low, high int
		what      string
		dst       *int
	}{
		{"crawlSpeed", crawlDefault, 4, 60, "The crawl's speed", &out.CrawlSpeed},
		{"crawlTilt", FieldDefaults().CrawlTilt, 0, 100, "The crawl's convergence", &out.CrawlTilt},
	} {
		value := n.fallback
		if v, ok := payload[n.key]; ok {
			i, isInt := asInt(v)
			if !isInt {
				return Fields{}, ValidationError(fmt.Sprintf("%s must be a whole number from %d to %d.", n.what, n.low, n.high))
			}
			value = i
		}
		if value < n.low || value > n.high {
			return Fields{}, ValidationError(fmt.Sprintf("%s must be a whole number from %d to %d.", n.what, n.low, n.high))
		}
		*n.dst = value
	}

	if err := choice("font", "default", "Font", fonts, &out.Font); err != nil {
		return Fields{}, err
	}
	if err := choice("align", "center", "Alignment", aligns, &out.Align); err != nil {
		return Fields{}, err
	}
	if err := choice("pictureFit", "span", "The picture's fit", pictureFits, &out.PictureFit); err != nil {
		return Fields{}, err
	}
	if out.Picture != "" && !SafeURL(out.Picture) {
		return Fields{}, ValidationError("The picture's address must start with https://, http:// or /.")
	}

	countdown := ""
	if v, ok := payload["countdown"]; ok {
		s, isString := asString(v)
		if !isString || (s != "" && !countdownRe.MatchString(s)) {
			return Fields{}, ValidationError("The countdown must be a UTC time such as 2026-10-20T18:00:00Z.")
		}
		countdown = s
	}
	out.Countdown = countdown

	seconds := FieldDefaults().RefreshSeconds
	if v, ok := payload["refreshSeconds"]; ok {
		i, isInt := asInt(v)
		if !isInt {
			return Fields{}, ValidationError("Check interval must be between 15 and 3600 seconds.")
		}
		seconds = i
	}
	if seconds < 15 || seconds > 3600 {
		return Fields{}, ValidationError("Check interval must be between 15 and 3600 seconds.")
	}
	out.RefreshSeconds = seconds

	// A message, a background picture or a countdown: an announcement may be only a picture.
	if out.Enabled && !hasContent(out) {
		return Fields{}, ValidationError("Write a message (or choose a background image or a countdown) before publishing the banner.")
	}
	if out.LinkURL != "" && !SafeURL(out.LinkURL) {
		return Fields{}, ValidationError("The link must start with https://, http:// or /.")
	}
	return out, nil
}

func hasContent(f Fields) bool {
	return f.Message != "" || f.Picture != "" || f.Countdown != ""
}

// SafeURL reports whether u is an http(s) URL or a same-site path ("/x", not
// "//host"), with no whitespace.
func SafeURL(u string) bool {
	if u == "" || strings.IndexFunc(u, pyIsSpace) >= 0 {
		return false
	}
	lower := strings.ToLower(u)
	for _, scheme := range []string{"http://", "https://"} {
		if strings.HasPrefix(lower, scheme) {
			return len(u) > len(scheme)
		}
	}
	return u[0] == '/' && (len(u) == 1 || u[1] != '/')
}

// ID is the banner's id: the first 12 hex digits of the SHA-256 of its
// content and revision, encoded exactly as Python's json.dumps encoded them,
// so the ids (and the dismissals and receipts keyed by them) stay as they were.
// Enabling it, or changing how it looks, keeps the id.
func ID(f Fields, revision int64) string {
	var b bytes.Buffer
	_ = b.WriteByte('[')
	for i, s := range []string{f.Level, f.Title, f.Message, f.LinkText, f.LinkURL} {
		if i > 0 {
			_, _ = b.WriteString(", ")
		}
		pyQuote(&b, s)
	}
	_, _ = b.WriteString(", ")
	_, _ = b.WriteString(strconv.FormatInt(revision, 10))
	// A picture or a countdown makes another announcement; only when there is
	// one, so the ids of those published before them stay.
	for _, kv := range [][2]string{{"picture", f.Picture}, {"countdown", f.Countdown}} {
		if kv[1] == "" {
			continue
		}
		_, _ = b.WriteString(", [")
		pyQuote(&b, kv[0])
		_, _ = b.WriteString(", ")
		pyQuote(&b, kv[1])
		_ = b.WriteByte(']')
	}
	_ = b.WriteByte(']')
	sum := sha256.Sum256(b.Bytes())
	return hex.EncodeToString(sum[:])[:12]
}

// pyQuote writes s as Python's json.dumps does by default (ensure_ascii): the
// printable ASCII as it is, \" \\ \n \r \t \b \f, everything else \uXXXX in
// lowercase hex (beyond the BMP as a surrogate pair).
func pyQuote(b *bytes.Buffer, s string) {
	_ = b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			_, _ = b.WriteString(`\"`)
		case '\\':
			_, _ = b.WriteString(`\\`)
		case '\n':
			_, _ = b.WriteString(`\n`)
		case '\r':
			_, _ = b.WriteString(`\r`)
		case '\t':
			_, _ = b.WriteString(`\t`)
		case '\b':
			_, _ = b.WriteString(`\b`)
		case '\f':
			_, _ = b.WriteString(`\f`)
		default:
			switch {
			case r >= ' ' && r <= '~':
				_, _ = b.WriteRune(r)
			case r > 0xFFFF:
				r -= 0x10000
				_, _ = fmt.Fprintf(b, `\u%04x\u%04x`, 0xD800+(r>>10), 0xDC00+(r&0x3FF))
			default:
				_, _ = fmt.Fprintf(b, `\u%04x`, r)
			}
		}
	}
	_ = b.WriteByte('"')
}

// pyIsSpace is Python's str.isspace for one character: Go's unicode.IsSpace
// plus the information separators U+001C-U+001F.
func pyIsSpace(r rune) bool {
	return unicode.IsSpace(r) || (r >= 0x1C && r <= 0x1F)
}

// pyStrip is Python's str.strip().
func pyStrip(s string) string {
	return strings.TrimFunc(s, pyIsSpace)
}

func asString(v json.RawMessage) (string, bool) {
	v = bytes.TrimSpace(v)
	if len(v) == 0 || v[0] != '"' {
		return "", false
	}
	var s string
	if err := json.Unmarshal(v, &s); err != nil {
		return "", false
	}
	return s, true
}

// asInt accepts a JSON integer only: not a boolean, not 15.0, not 1e2.
func asInt(v json.RawMessage) (int, bool) {
	s := string(bytes.TrimSpace(v))
	if s == "" || strings.ContainsAny(s, ".eE") {
		return 0, false
	}
	i, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		// a JSON number too big for int64 is still a whole number: out of every range
		if numeric(s) {
			return 1 << 30, true
		}
		return 0, false
	}
	if i > 1<<30 || i < -(1<<30) {
		i = 1 << 30
	}
	return int(i), true
}

func numeric(s string) bool {
	s = strings.TrimPrefix(s, "-")
	return s != "" && strings.Trim(s, "0123456789") == ""
}

func isJSONBool(v json.RawMessage) bool {
	s := string(bytes.TrimSpace(v))
	return s == "true" || s == "false"
}

func isJSONValueButNotObject(raw []byte) bool {
	var v any
	return json.Unmarshal(raw, &v) == nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
