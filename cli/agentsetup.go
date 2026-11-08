package cli

import (
	"os"

	"github.com/spf13/afero"
	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/agent/agentsetup"
	"github.com/coder/serpent"
)

// agentSetup prepares a platform workspace when it starts. The agent runs it
// in place of a template's "Workspace setup" script; see agent/agentsetup.
func agentSetup() *serpent.Command {
	var startFolder string
	return &serpent.Command{
		Use:    "agent-setup",
		Hidden: true,
		Short:  "Prepare a platform workspace (run by the workspace agent at start)",
		Options: serpent.OptionSet{{
			Flag:        "start-folder",
			Description: "Where terminals and File Browser open: under the home, or the home itself.",
			Value:       serpent.StringOf(&startFolder),
		}},
		Handler: func(inv *serpent.Invocation) error {
			home, err := os.UserHomeDir()
			if err != nil {
				return xerrors.Errorf("find the home directory: %w", err)
			}
			env := &agentsetup.Env{
				Inputs: agentsetup.Inputs{
					Home:          home,
					StartFolder:   startFolder,
					OwnerName:     os.Getenv("CODER_WORKSPACE_OWNER_NAME"),
					WorkspaceName: os.Getenv("CODER_WORKSPACE_NAME"),
					AgentName:     os.Getenv("CODER_WORKSPACE_AGENT_NAME"),
				},
				FS:    afero.NewOsFs(),
				Cmd:   agentsetup.SystemCommander{},
				Log:   inv.Stdout,
				Paths: agentsetup.DefaultImagePaths,
			}
			env.Logf("Preparing workspace %s of %s", env.Inputs.WorkspaceName, env.Inputs.OwnerName)
			if err := agentsetup.Run(inv.Context(), env, agentsetup.Steps()); err != nil {
				return err
			}
			env.Logf("Workspace setup done")
			return nil
		},
	}
}
