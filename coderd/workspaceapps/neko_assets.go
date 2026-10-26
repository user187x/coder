package workspaceapps

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

const nekoClientManifest = "coder-neko-client.json"

// NekoClient serves an immutable snapshot validated against its operator pin.
// Construct it with LoadNekoClient before enabling a media gateway.
type NekoClient struct{ handler http.Handler }

// ServeHTTP serves only files included in the validated manifest.
func (c *NekoClient) ServeHTTP(w http.ResponseWriter, r *http.Request) { c.handler.ServeHTTP(w, r) }

// LoadNekoClient snapshots an operator-pinned relay-only Neko v3.1.6 legacy
// client. Workspace-provided HTML and JavaScript are never a trusted client.
func LoadNekoClient(source fs.FS, manifestSHA string) (*NekoClient, error) {
	expected, err := hex.DecodeString(manifestSHA)
	if err != nil || len(expected) != sha256.Size || source == nil {
		return nil, errors.New("neko client requires a pinned manifest digest")
	}
	raw, err := readNekoAsset(source, nekoClientManifest, 512*1024)
	if err != nil {
		return nil, fmt.Errorf("read Neko client manifest: %w", err)
	}
	digest := sha256.Sum256(raw)
	if !bytes.Equal(digest[:], expected) {
		return nil, errors.New("neko client manifest digest differs")
	}
	var manifest struct {
		Version   int               `json:"version"`
		Protocol  string            `json:"protocol"`
		RelayOnly bool              `json:"relay_only"`
		Files     map[string]string `json:"files"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return nil, fmt.Errorf("decode Neko client manifest: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("neko client manifest has trailing content")
	}
	if manifest.Version != 1 || manifest.Protocol != "neko-v3.1.6-legacy" || !manifest.RelayOnly || len(manifest.Files) == 0 || len(manifest.Files) > 4096 {
		return nil, errors.New("neko client manifest is not a bounded supported relay-only client")
	}
	files := make(map[string][]byte, len(manifest.Files))
	total := 0
	for name, want := range manifest.Files {
		if !fs.ValidPath(name) || name == "." || strings.HasPrefix(name, ".") || strings.Contains(name, "/.") {
			return nil, errors.New("neko client asset path is invalid")
		}
		contents, err := readNekoAsset(source, name, 16*1024*1024)
		if err != nil {
			return nil, fmt.Errorf("read Neko client asset: %w", err)
		}
		sum := sha256.Sum256(contents)
		if hex.EncodeToString(sum[:]) != want {
			return nil, errors.New("neko client asset digest differs")
		}
		total += len(contents)
		if total > 32*1024*1024 {
			return nil, errors.New("neko client exceeds the asset budget")
		}
		files[name] = contents
	}
	if len(files["index.html"]) == 0 {
		return nil, errors.New("neko client index is missing")
	}
	return &NekoClient{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}
		contents, ok := files[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'")
		if contentType := mime.TypeByExtension(path.Ext(name)); contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(contents))
	})}, nil
}

func readNekoAsset(source fs.FS, name string, limit int64) ([]byte, error) {
	file, err := source.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	contents, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(contents)) > limit {
		return nil, errors.New("neko asset exceeds its size bound")
	}
	return contents, nil
}
