// Package agentpki installs owner certificates independently of template scripts.
package agentpki

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/spf13/afero"

	"github.com/coder/coder/v2/codersdk/agentsdk"
)

var ownerName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._@+-]*$`)

// Result identifies the secret files managed by the native certificate installer.
type Result struct {
	// Handled identifies the encoded certificate secrets not written as plain files.
	Handled   []string
	Installed bool
}

// Sync writes the owner's uploaded certificate and removes only certificates it
// previously managed. Invalid input leaves the existing certificate intact.
func Sync(files afero.Fs, home, owner string, secrets []agentsdk.WorkspaceSecret) (Result, error) {
	var result Result
	if !filepath.IsAbs(home) || !ownerName.MatchString(owner) {
		return result, fmt.Errorf("certificate home or owner is invalid")
	}
	dir := filepath.Join(home, ".cert")
	stateDir := filepath.Join(home, ".local", "state", "coder-certificates")
	var candidates []agentsdk.WorkspaceSecret
	for _, secret := range secrets {
		path := secret.FilePath
		if strings.HasPrefix(path, "~/") {
			path = filepath.Join(home, path[2:])
		}
		if filepath.Dir(path) != dir {
			continue
		}
		name := filepath.Base(path)
		if !strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".p12.b64") {
			continue
		}
		previousOwner := strings.TrimSuffix(strings.TrimPrefix(name, "."), ".p12.b64")
		if !ownerName.MatchString(previousOwner) {
			continue
		}
		candidates = append(candidates, secret)
		result.Handled = append(result.Handled, secret.FilePath)
	}
	// Prefer an upload under the current username, then use a stable fallback for
	// uploads kept across a username change.
	slices.SortFunc(candidates, func(a, b agentsdk.WorkspaceSecret) int {
		current := "." + owner + ".p12.b64"
		aCurrent, bCurrent := filepath.Base(a.FilePath) == current, filepath.Base(b.FilePath) == current
		if aCurrent != bCurrent {
			if aCurrent {
				return -1
			}
			return 1
		}
		return strings.Compare(a.FilePath, b.FilePath)
	})
	var data []byte
	if len(candidates) > 0 {
		var err error
		data, err = base64.StdEncoding.DecodeString(strings.TrimSpace(string(candidates[0].Value)))
		if err != nil || len(data) == 0 || len(data) > 10<<20 {
			return result, fmt.Errorf("certificate upload is not valid base64 data")
		}
	}
	statePath := filepath.Join(stateDir, "native.json")
	var previous []string
	raw, err := afero.ReadFile(files, statePath)
	if err == nil {
		if err = json.Unmarshal(raw, &previous); err != nil {
			return result, fmt.Errorf("read certificate state: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return result, fmt.Errorf("read certificate state: %w", err)
	} else {
		legacy, legacyErr := afero.ReadFile(files, filepath.Join(stateDir, "installed"))
		if legacyErr == nil {
			previous = strings.Fields(string(legacy))
		} else if !os.IsNotExist(legacyErr) {
			return result, fmt.Errorf("read previous certificate state: %w", legacyErr)
		}
	}
	for _, name := range previous {
		if !ownerName.MatchString(name) {
			return result, fmt.Errorf("certificate state contains an invalid owner")
		}
	}
	if len(data) == 0 && len(previous) == 0 {
		return result, nil
	}
	if err = privateDirectory(files, home, dir); err != nil {
		return result, err
	}
	if err = privateDirectory(files, home, stateDir); err != nil {
		return result, err
	}
	if len(data) > 0 {
		if err = replace(files, filepath.Join(dir, owner+".p12"), data); err != nil {
			return result, err
		}
		result.Installed = true
	}
	for _, name := range previous {
		if !ownerName.MatchString(name) {
			return result, fmt.Errorf("certificate state contains an invalid owner")
		}
		if result.Installed && name == owner {
			continue
		}
		if err = files.Remove(filepath.Join(dir, name+".p12")); err != nil && !os.IsNotExist(err) {
			return result, fmt.Errorf("remove previous certificate: %w", err)
		}
	}
	var managed []string
	if result.Installed {
		managed = []string{owner}
	}
	raw, err = json.Marshal(managed)
	if err != nil {
		return result, err
	}
	if err = replace(files, statePath, raw); err != nil {
		return result, err
	}
	// Encoded files from older agents are removed only after successful install.
	for _, secret := range candidates {
		path := secret.FilePath
		if strings.HasPrefix(path, "~/") {
			path = filepath.Join(home, path[2:])
		}
		if err = files.Remove(path); err != nil && !os.IsNotExist(err) {
			return result, fmt.Errorf("remove encoded certificate: %w", err)
		}
	}
	return result, nil
}

func privateDirectory(files afero.Fs, home, path string) error {
	relative, err := filepath.Rel(home, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("certificate directory escapes home")
	}
	current := home
	for _, part := range strings.Split(relative, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		info, err := files.Stat(current)
		if lstater, ok := files.(afero.Lstater); ok {
			info, _, err = lstater.LstatIfPossible(current)
		}
		if os.IsNotExist(err) {
			if err = files.Mkdir(current, 0o700); err != nil {
				return fmt.Errorf("create certificate directory: %w", err)
			}
			continue
		}
		if err != nil {
			return fmt.Errorf("inspect certificate directory: %w", err)
		}
		if !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 {
			return fmt.Errorf("certificate directory must not be a symlink")
		}
	}
	return files.Chmod(path, 0o700)
}

func replace(files afero.Fs, target string, data []byte) error {
	file, err := afero.TempFile(files, filepath.Dir(target), ".certificate-")
	if err != nil {
		return fmt.Errorf("create certificate file: %w", err)
	}
	defer files.Remove(file.Name())
	if err = files.Chmod(file.Name(), 0o600); err != nil {
		file.Close()
		return err
	}
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = files.Rename(file.Name(), target); err != nil {
		return fmt.Errorf("replace certificate file: %w", err)
	}
	return nil
}
