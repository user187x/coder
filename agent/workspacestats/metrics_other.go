//go:build !linux

package workspacestats

import (
	"context"
	"errors"
)

// Collect is available in Linux workspaces.
func Collect(_ context.Context, _ string) (string, error) {
	return "", errors.New("platform workspace metrics require Linux")
}
