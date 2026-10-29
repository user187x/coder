package templatedecorator

import (
	"bytes"
	"fmt"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"golang.org/x/xerrors"
)

// manageRuntime makes the privileged network runtime a server-owned part of
// every Kubernetes pod hosting an agent, independent of template script files.
func manageRuntime(files map[string][]byte, image, accessURL string) ([]string, error) {
	if image == "" {
		return nil, nil
	}
	if accessURL == "" {
		return nil, xerrors.New("workspace runtime requires the Coder access URL")
	}
	var agents []string
	parsed := map[string]*hclsyntax.Body{}
	for name, src := range files {
		if path.Dir(name) != "." || !strings.HasSuffix(name, ".tf") {
			continue
		}
		f, diags := hclsyntax.ParseConfig(src, name, hcl.InitialPos)
		if diags.HasErrors() {
			return nil, xerrors.Errorf("parse managed workspace runtime template: %s", diags.Error())
		}
		body := f.Body.(*hclsyntax.Body)
		parsed[name] = body
		agents = append(agents, agentNames(body)...)
	}
	var changed []string
	for name, body := range parsed {
		src := files[name]
		type edit struct {
			start, end int
			text       string
		}
		var edits []edit
		for _, resource := range body.Blocks {
			wl := findWorkload(&hclsyntax.Body{Blocks: []*hclsyntax.Block{resource}}, agents)
			if wl == nil {
				continue
			}
			agent := ""
			for _, candidate := range agents {
				if referencesAgent(wl.container, []string{candidate}) {
					if agent != "" {
						return nil, xerrors.New("workspace runtime pod references multiple agents")
					}
					agent = candidate
				}
			}
			if agent == "" {
				continue
			}
			caMount := ""
			hasRun := false
			var oldRuntime *hclsyntax.Block
			for _, block := range wl.podSpec.Body.Blocks {
				identity := blockIdentity(block, src)
				if identity == `volume/name="coder-platform-runtime"` {
					hasRun = true
				}
				if identity == `volume/name="ca-bundle"` {
					caMount = `volume_mount {
 name = "ca-bundle"
 mount_path = "/etc/ssl/certs/ca-certificates.crt"
 sub_path = "ca-certificates.crt"
 read_only = true
}`
				}
				if identity == `container/name="workspace-tunnel"` {
					oldRuntime = block
				}
			}
			runtime := fmt.Sprintf(`
container {
 name = "workspace-tunnel"
 image = %s
 image_pull_policy = "IfNotPresent"
 command = ["/usr/local/bin/workspace-tunnel-native"]
 security_context {
  run_as_user = 0
  run_as_non_root = false
  allow_privilege_escalation = false
  read_only_root_filesystem = true
  capabilities {
   drop = ["ALL"]
   add = ["NET_ADMIN"]
  }
 }
 env {
  name = "CODER_AGENT_TOKEN"
  value = coder_agent.%s.token
 }
 env {
  name = "WORKSPACE_TUNNEL_URL"
  value = %s
 }
 env {
  name = "POD_IP"
  value_from {
   field_ref { field_path = "status.podIP" }
  }
 }
 volume_mount {
  name = "coder-platform-runtime"
  mount_path = "/run"
 }
 %s
 resources {
  requests = { cpu = "25m", memory = "64Mi" }
  limits = { cpu = "500m", memory = "128Mi" }
 }
}
`, strconv.Quote(image), agent, strconv.Quote(strings.TrimRight(accessURL, "/")+"/__coder-ui/api/workspace-tunnels/agent/sync"), caMount)
			if oldRuntime != nil {
				oldText := strings.TrimSpace(string(hclwrite.Format([]byte(strings.TrimSpace(string(oldRuntime.Range().SliceBytes(src)))))))
				newText := strings.TrimSpace(string(hclwrite.Format([]byte(strings.TrimSpace(runtime)))))
				if oldText == newText && hasRun {
					continue
				}
				edits = append(edits, edit{oldRuntime.Range().Start.Byte, oldRuntime.Range().End.Byte, ""})
			}
			if !hasRun {
				runtime += "\nvolume {\n name = \"coder-platform-runtime\"\n empty_dir {}\n}\n"
			}
			edits = append(edits, edit{wl.podSpec.CloseBraceRange.Start.Byte, wl.podSpec.CloseBraceRange.Start.Byte, runtime})
		}
		if len(edits) == 0 {
			continue
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		out := bytes.Clone(src)
		for _, edit := range edits {
			out = append(append(append([]byte{}, out[:edit.start]...), edit.text...), out[edit.end:]...)
		}
		out = hclwrite.Format(out)
		if !bytes.Equal(src, out) {
			files[name] = out
			changed = append(changed, name)
		}
	}
	sort.Strings(changed)
	return changed, nil
}
