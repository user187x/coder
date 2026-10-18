package templatedecorator_test

import (
	"archive/tar"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/templatedecorator"
)

// A prototype with a section in each place the decorator knows.
const prototype = `variable "namespace" {
  type    = string
  default = "coder"
}

variable "user_storage" {
  type    = bool
  default = false
}

data "coder_workspace" "me" {}

locals {
  workspace_image = "img:1"
  coder_host      = regex("^[a-z]+://([^/:]+)", data.coder_workspace.me.access_url)[0]
}

# platform:begin lockdown
locals {
  platform_lockdown_sh = file("${path.module}/scripts/lockdown.sh")
}

resource "coder_script" "lockdown" {
  agent_id = coder_agent.main.id
  script   = local.platform_lockdown_sh
}
# platform:end lockdown

# platform:begin cloud-drive
data "kubernetes_config_map_v1" "cloud_drive" {
  count = var.user_storage ? 1 : 0
  metadata {
    name      = "coder-cloud-drive"
    namespace = var.namespace
  }
}
# platform:end cloud-drive

resource "coder_agent" "main" {
  os   = "linux"
  arch = "amd64"
  # platform:begin metrics
  metadata {
    display_name = "RAM"
    key          = "1_ram_usage"
    script       = "free"
    interval     = 10
    timeout      = 1
  }
  # platform:end metrics
}

resource "kubernetes_deployment_v1" "main" {
  metadata {
    name      = "ws"
    namespace = var.namespace
  }
  spec {
    template {
      metadata {
        # platform:begin cloud-drive
        annotations = var.user_storage ? { "platform.coder/cloud-drive" = "on" } : {}
        # platform:end cloud-drive
      }
      spec {
        # platform:begin lockdown
        init_container {
          name    = "lockdown"
          image   = local.workspace_image
          command = ["sh", "-c", local.platform_lockdown_sh, "lockdown", "off", local.coder_host, ""]
        }
        volume {
          name = "lockdown"
        }
        # platform:end lockdown
        container {
          name    = "dev"
          image   = local.workspace_image
          command = ["sh", "-c", coder_agent.main.init_script]
          # platform:begin lockdown
          volume_mount {
            name       = "lockdown"
            mount_path = "/etc/coder-lockdown"
          }
          # platform:end lockdown
        }
      }
    }
  }
}
`

var scripts = map[string][]byte{"scripts/lockdown.sh": []byte("#!/bin/sh\necho lockdown\n"), "scripts/startup.sh": []byte("#!/bin/sh\n")}

func payload(t *testing.T) *templatedecorator.Payload {
	t.Helper()
	p, err := templatedecorator.Extract([]byte(prototype), scripts, map[string]string{"user_storage": "true", "namespace": "coder"})
	require.NoError(t, err)
	return p
}

func parses(t *testing.T, src []byte) *hclsyntax.Body {
	t.Helper()
	f, diags := hclsyntax.ParseConfig(src, "main.tf", hcl.InitialPos)
	require.False(t, diags.HasErrors(), "%s\n%s", diags.Error(), src)
	return f.Body.(*hclsyntax.Body)
}

func TestExtract(t *testing.T) {
	t.Parallel()
	p := payload(t)
	require.Equal(t, []string{"lockdown", "cloud-drive", "metrics"}, p.Features)
	places := map[string]templatedecorator.Placement{}
	for _, s := range p.Sections {
		places[s.Feature+"/"+string(s.Placement)] = s.Placement
	}
	require.Contains(t, places, "lockdown/top")
	require.Contains(t, places, "lockdown/pod-spec")
	require.Contains(t, places, "lockdown/container")
	require.Contains(t, places, "cloud-drive/pod-metadata")
	require.Contains(t, places, "metrics/agent")
	require.Equal(t, []byte("#!/bin/sh\necho lockdown\n"), p.Files["lockdown.sh"])
	require.Equal(t, "local.workspace_image", p.ImageExpr)
	// the declarations outside the sections that they use
	for _, ref := range []string{"var.namespace", "var.user_storage", "local.coder_host", "data.coder_workspace.me"} {
		require.Contains(t, p.Requires, ref)
	}
	require.NotContains(t, p.Requires, "local.workspace_image") // the template's own image takes its place
}

func TestExtractRefusesSectionsThatUseResourcesOutsideThem(t *testing.T) {
	t.Parallel()
	bad := strings.Replace(prototype, `script   = local.platform_lockdown_sh`, `script   = kubernetes_deployment_v1.main.id`, 1)
	_, err := templatedecorator.Extract([]byte(bad), scripts, nil)
	require.ErrorContains(t, err, "kubernetes_deployment_v1.main")
	_, err = templatedecorator.Extract([]byte("# platform:begin x\n"), scripts, nil)
	require.ErrorContains(t, err, "no end")
}

func TestStrip(t *testing.T) {
	t.Parallel()
	out, only, err := templatedecorator.Strip([]byte(prototype))
	require.NoError(t, err)
	require.NotContains(t, string(out), "platform:")
	require.NotContains(t, string(out), "lockdown")
	require.NotContains(t, string(out), "annotations")
	require.Equal(t, []string{"scripts/lockdown.sh"}, only)
	parses(t, out)
}

// A template made from the prototype (its sections stripped) gets them back when it is built: the materialized
// main.tf has every section at its place, and parses.
func TestDecorateTheStrippedPrototype(t *testing.T) {
	t.Parallel()
	p := payload(t)
	own, _, err := templatedecorator.Strip([]byte(prototype))
	require.NoError(t, err)
	res, err := p.Decorate(map[string][]byte{"main.tf": own, "README.md": []byte("hi")})
	require.NoError(t, err)
	require.Equal(t, []string{"lockdown", "cloud-drive", "metrics"}, res.Injected)
	require.Equal(t, []string{"main.tf"}, res.Changed)
	require.Equal(t, []string{".platform/lockdown.sh"}, res.Added)
	out := string(res.Files["main.tf"])
	body := parses(t, res.Files["main.tf"])
	require.Contains(t, out, `file("${path.module}/.platform/lockdown.sh")`)
	// in the agent, the pod's metadata and spec, and the container
	var dep *hclsyntax.Block
	for _, b := range body.Blocks {
		if b.Type == "resource" && b.Labels[0] == "kubernetes_deployment_v1" {
			dep = b
		}
		if b.Type == "resource" && b.Labels[0] == "coder_agent" {
			require.Len(t, b.Body.Blocks, 1)
			require.Equal(t, "metadata", b.Body.Blocks[0].Type)
		}
	}
	require.NotNil(t, dep)
	tmpl := dep.Body.Blocks[1].Body.Blocks[0]
	require.Contains(t, tmpl.Body.Blocks[0].Body.Attributes, "annotations")
	spec := tmpl.Body.Blocks[1]
	kinds := []string{}
	for _, b := range spec.Body.Blocks {
		kinds = append(kinds, b.Type)
	}
	require.ElementsMatch(t, []string{"container", "init_container", "volume"}, kinds)
	// decorating again changes nothing
	again, err := p.Decorate(res.Files)
	require.NoError(t, err)
	require.Empty(t, again.Injected)
	require.Equal(t, res.Files["main.tf"], again.Files["main.tf"])
}

// The prototype itself has every section: nothing is injected, the archive is the same.
func TestDecorateThePrototype(t *testing.T) {
	t.Parallel()
	p := payload(t)
	archive := tarOf(t, map[string][]byte{"main.tf": []byte(prototype), "scripts/lockdown.sh": scripts["scripts/lockdown.sh"]})
	out, res, err := p.DecorateArchive(archive)
	require.NoError(t, err)
	require.Empty(t, res.Injected)
	require.Equal(t, archive, out)
}

// Another template: its own agent name, image and annotations; nothing it declares itself is declared twice; what
// the sections need and it lacks comes in, a variable with the prototype's value.
func TestDecorateAnotherTemplate(t *testing.T) {
	t.Parallel()
	p := payload(t)
	own := `resource "coder_agent" "dev" {
  os   = "linux"
  arch = "amd64"
}

resource "kubernetes_pod_v1" "ws" {
  metadata {
    name        = "ws"
    annotations = { "team" = "data" }
  }
  spec {
    container {
      name    = "sidecar"
      image   = "busybox"
    }
    container {
      name    = "work"
      image   = "my/image:2"
      command = ["sh", "-c", coder_agent.dev.init_script]
    }
  }
}
`
	archive := tarOf(t, map[string][]byte{"main.tf": []byte(own)})
	out, res, err := p.DecorateArchive(archive)
	require.NoError(t, err)
	require.Equal(t, []string{"lockdown", "cloud-drive", "metrics"}, res.Injected)
	files := untar(t, out)
	main := string(files["main.tf"])
	parses(t, files["main.tf"])
	require.Contains(t, main, "coder_agent.dev.id")
	require.NotContains(t, main, "coder_agent.main")
	require.Contains(t, main, `image   = "my/image:2"`)
	require.Contains(t, main, `merge({ "team" = "data" }, var.user_storage ? { "platform.coder/cloud-drive" = "on" } : {})`)
	require.Equal(t, 1, strings.Count(main, `volume_mount {`))
	require.Contains(t, main, "# platform:begin requires")
	require.Contains(t, main, `variable "user_storage"`)
	require.Regexp(t, `default\s*=\s*true`, main) // the prototype's value
	require.Contains(t, main, `data "coder_workspace" "me"`)
	require.Contains(t, main, `coder_host`)
	require.Equal(t, []byte("#!/bin/sh\necho lockdown\n"), files[".platform/lockdown.sh"])
	// the volume_mount went into the agent's container, not the first one
	body := parses(t, files["main.tf"])
	for _, b := range body.Blocks {
		if b.Type == "resource" && b.Labels[0] == "kubernetes_pod_v1" {
			spec := b.Body.Blocks[1]
			for _, c := range spec.Body.Blocks {
				if c.Type == "container" {
					name := string(c.Body.Attributes["name"].Expr.Range().SliceBytes(files["main.tf"]))
					require.Equal(t, name == `"work"`, len(c.Body.Blocks) == 1, name)
				}
			}
		}
	}
}

func TestDecorateSkips(t *testing.T) {
	t.Parallel()
	p := payload(t)
	// no Kubernetes pod: the agent's and the top-level features only
	res, err := p.Decorate(map[string][]byte{"main.tf": []byte("resource \"coder_agent\" \"main\" {\n  os = \"linux\"\n}\n")})
	require.NoError(t, err)
	require.Equal(t, []string{"metrics"}, res.Injected)
	require.Len(t, res.Skipped, 2)
	// opted out, no agent, its own declaration of a section's block
	res, err = p.Decorate(map[string][]byte{"main.tf": []byte("# platform:no-decorator\nresource \"coder_agent\" \"main\" {}\n")})
	require.NoError(t, err)
	require.Empty(t, res.Injected)
	res, err = p.Decorate(map[string][]byte{"main.tf": []byte("resource \"null_resource\" \"x\" {}\n")})
	require.NoError(t, err)
	require.Empty(t, res.Injected)
	res, err = p.Decorate(map[string][]byte{"main.tf": []byte("resource \"coder_agent\" \"main\" {}\nresource \"coder_script\" \"lockdown\" {\n  agent_id = coder_agent.main.id\n  script = \"x\"\n}\n")})
	require.NoError(t, err)
	require.Equal(t, []string{"metrics"}, res.Injected)
	// a template that does not parse is left to Terraform
	res, err = p.Decorate(map[string][]byte{"main.tf": []byte("resource \"coder_agent\" {")})
	require.NoError(t, err)
	require.Empty(t, res.Injected)
}

// The chart's own prototype (CODER_DECORATOR_PROTOTYPE: its files/ directory), when given.
func TestTheChartsPrototype(t *testing.T) {
	t.Parallel()
	dir := os.Getenv("CODER_DECORATOR_PROTOTYPE")
	if dir == "" {
		t.Skip("CODER_DECORATOR_PROTOTYPE not set")
	}
	files := map[string][]byte{}
	main, err := os.ReadFile(filepath.Join(dir, "main.tf"))
	require.NoError(t, err)
	entries, err := os.ReadDir(filepath.Join(dir, "scripts"))
	require.NoError(t, err)
	for _, e := range entries {
		data, err := os.ReadFile(filepath.Join(dir, "scripts", e.Name()))
		require.NoError(t, err)
		files["scripts/"+e.Name()] = data
	}
	p, err := templatedecorator.Extract(main, files, map[string]string{"user_storage": "true"})
	require.NoError(t, err)
	t.Logf("features %v; requires %d", p.Features, len(p.Requires))
	own, only, err := templatedecorator.Strip(main)
	require.NoError(t, err)
	t.Logf("stripped: %d lines (of %d); scripts only the sections read: %v", bytes.Count(own, []byte("\n")), bytes.Count(main, []byte("\n")), only)
	res, err := p.Decorate(map[string][]byte{"main.tf": own})
	require.NoError(t, err)
	require.Empty(t, res.Skipped, res.String())
	if out := os.Getenv("CODER_DECORATOR_OUT"); out != "" {
		require.NoError(t, os.WriteFile(filepath.Join(out, "stripped.tf"), own, 0o600))
		require.NoError(t, os.WriteFile(filepath.Join(out, "materialized.tf"), res.Files["main.tf"], 0o600))
	}
}

func tarOf(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	for _, name := range []string{"main.tf", "README.md", "scripts/lockdown.sh"} {
		data, ok := files[name]
		if !ok {
			continue
		}
		require.NoError(t, tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(data)), Typeflag: tar.TypeReg}))
		_, err := tw.Write(data)
		require.NoError(t, err)
	}
	require.NoError(t, tw.Close())
	return buf.Bytes()
}

func untar(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	out := map[string][]byte{}
	tr := tar.NewReader(bytes.NewReader(data))
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return out
		}
		require.NoError(t, err)
		if hdr.Typeflag == tar.TypeReg {
			b, err := io.ReadAll(tr)
			require.NoError(t, err)
			out[hdr.Name] = b
		}
	}
}

func TestReferences(t *testing.T) {
	t.Parallel()
	refs := payload(t).References()
	require.Equal(t, []string{"lockdown"}, refs["lockdown.sh"].Features)
	require.Equal(t, `platform_lockdown_sh = file("${path.module}/.platform/lockdown.sh")`, strings.TrimSpace(refs["lockdown.sh"].Text))
}

// A template with the platform's code from before the decorator (unmarked, its own names): nothing is declared
// twice - a feature whose top-level block it has is skipped, an agent's metadata of the same key is not added.
func TestDecorateATemplateFromBeforeTheDecorator(t *testing.T) {
	t.Parallel()
	p := payload(t)
	old := `resource "coder_agent" "main" {
  os = "linux"
  metadata {
    display_name = "RAM"
    key          = "1_ram_usage"
    script       = "free -m"
    interval     = 10
    timeout      = 1
  }
}

resource "coder_script" "lockdown" {
  agent_id = coder_agent.main.id
  script   = "true"
}
`
	res, err := p.Decorate(map[string][]byte{"main.tf": []byte(old)})
	require.NoError(t, err)
	require.Contains(t, res.Injected, "metrics")
	require.Equal(t, 1, strings.Count(string(res.Files["main.tf"]), `key          = "1_ram_usage"`))
	require.Contains(t, res.Skipped, templatedecorator.Skip{Feature: "lockdown", Reason: "the template declares coder_script.lockdown itself"})
	parses(t, res.Files["main.tf"])
}

// A variable a platform section declares comes in with the prototype's value as its default (the deployment's).
func TestInjectedVariablesTakeThePrototypesValues(t *testing.T) {
	t.Parallel()
	proto := strings.Replace(prototype, `# platform:end lockdown
`, `variable "relay_image" {
  type    = string
  default = ""
}
# platform:end lockdown
`, 1)
	p, err := templatedecorator.Extract([]byte(proto), scripts, map[string]string{"relay_image": "registry/relay:7"})
	require.NoError(t, err)
	own, _, err := templatedecorator.Strip([]byte(proto))
	require.NoError(t, err)
	res, err := p.Decorate(map[string][]byte{"main.tf": own})
	require.NoError(t, err)
	require.Contains(t, string(res.Files["main.tf"]), `default = "registry/relay:7"`)
	// a one-line agent block: the injected section's markers on lines of their own (decorated again: nothing new)
	res, err = p.Decorate(map[string][]byte{"main.tf": []byte("resource \"coder_agent\" \"main\" {}\n")})
	require.NoError(t, err)
	again, err := p.Decorate(res.Files)
	require.NoError(t, err)
	require.Empty(t, again.Injected)
}
