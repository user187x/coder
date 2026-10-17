package agentfiles

import (
	"path/filepath"
	"strings"

	"golang.org/x/xerrors"
)

// canonicalizePathIn returns raw as a cleaned, absolute path with ~ expanded against home, and its symlinks
// resolved when the target exists. ~user forms are not supported; a relative path is refused as ambiguous.
func canonicalizePathIn(home string, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", xerrors.New("path is empty")
	}
	if raw == "~" {
		raw = home
	} else if strings.HasPrefix(raw, "~/") {
		raw = filepath.Join(home, raw[2:])
	}
	if !filepath.IsAbs(raw) {
		return "", xerrors.Errorf("path %q is not absolute", raw)
	}
	cleaned := filepath.Clean(raw)
	if resolved, err := filepath.EvalSymlinks(cleaned); err == nil {
		return resolved, nil
	}
	return cleaned, nil
}
