// Package agentsetup prepares a platform workspace when it starts: the Start
// folder, the home directory's defaults and the workspace's services. It
// replaces the startup scripts that workspace templates used to carry, so
// every template gets the same setup from the agent binary.
//
// The agent runs it as the "Workspace setup" script (`coder agent-setup`), so
// its output appears in the workspace's Logs panel like any other script.
// Every step is safe to repeat: it changes only what is missing or still a
// default, and leaves what the user edited alone.
package agentsetup

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/afero"
	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/agent/agentexec"
)

// Inputs is what the setup needs to know about the workspace.
type Inputs struct {
	// Home is the workspace user's home directory.
	Home string
	// StartFolder is where terminals and File Browser open, relative to
	// Home or absolute under it. Empty means Home.
	StartFolder string
	OwnerName   string
	// WorkspaceName and AgentName build the path-based apps' prefix.
	WorkspaceName string
	AgentName     string
	// Path is the PATH programs are looked up on.
	Path string
}

// AppsPrefix is the path Coder proxies the workspace's path-based apps under.
func (in Inputs) AppsPrefix() string {
	return fmt.Sprintf("/@%s/%s.%s/apps", in.OwnerName, in.WorkspaceName, in.AgentName)
}

// Commander runs a program, so tests can stand in for the system's.
type Commander interface {
	// LookPath reports whether a program is installed.
	LookPath(name string) (string, error)
	// Run runs a program to completion with its output written to out.
	Run(ctx context.Context, out io.Writer, name string, args ...string) error
}

// Env is what every step works with.
type Env struct {
	Inputs Inputs
	FS     afero.Fs
	Cmd    Commander
	// Log is the Logs panel: one line per thing a step did.
	Log io.Writer
	// Paths of the workspace image's own files, overridable in tests.
	Paths ImagePaths
}

// Logf writes one line to the Logs panel.
func (e *Env) Logf(format string, args ...any) {
	_, _ = fmt.Fprintf(e.Log, format+"\n", args...)
}

// Step is one part of the setup.
type Step struct {
	Name string
	Run  func(ctx context.Context, env *Env) error
}

// Run runs each step in order. A step that fails is logged and the next one
// still runs, so one missing program never leaves the rest of the workspace
// unprepared; the failures are returned together.
func Run(ctx context.Context, env *Env, steps []Step) error {
	var failed []string
	for _, step := range steps {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := step.Run(ctx, env); err != nil {
			env.Logf("%s: %v", step.Name, err)
			failed = append(failed, step.Name)
		}
	}
	if len(failed) > 0 {
		return xerrors.Errorf("workspace setup steps failed: %s", strings.Join(failed, ", "))
	}
	return nil
}

// Steps is the full setup, in the order it runs.
func Steps() []Step {
	return []Step{
		{Name: "Start folder", Run: startFolder},
		{Name: "Shell defaults", Run: shellDefaults},
		{Name: "Image dotfiles", Run: imageDotfiles},
		{Name: "btop", Run: btopConfig},
		{Name: "tmux", Run: tmuxConfig},
		{Name: "btop disk", Run: btopDisk},
	}
}

// SystemCommander runs the system's programs.
type SystemCommander struct{}

// LookPath finds a program on PATH.
func (SystemCommander) LookPath(name string) (string, error) { return exec.LookPath(name) }

// Run runs a program with its output written to out.
func (SystemCommander) Run(ctx context.Context, out io.Writer, name string, args ...string) error {
	cmd := agentexec.DefaultExecer.CommandContext(ctx, name, args...)
	cmd.Stdout = out
	cmd.Stderr = out
	return cmd.Run()
}

// within reports whether path is dir itself or inside it.
func within(dir, path string) bool {
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, "../")
}
