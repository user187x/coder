package coderd_test

import (
	"archive/tar"
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/util/ptr"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

// platformBaseTar is a template version's files, as `coder templates push` uploads them.
func platformBaseTar(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	for name, content := range files {
		require.NoError(t, tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(content)), Typeflag: tar.TypeReg}))
		_, err := tw.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, tw.Close())
	return buf.Bytes()
}

func untarForTest(t *testing.T, data []byte) map[string]string {
	t.Helper()
	out := map[string]string{}
	tr := tar.NewReader(bytes.NewReader(data))
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return out
		}
		require.NoError(t, err)
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		b, err := io.ReadAll(tr)
		require.NoError(t, err)
		out[hdr.Name] = string(b)
	}
}

// The deployment's own base template (TemplateBuilder.BaseTemplate) is the builder's only base: a new template
// starts from a copy of its active version's own logic - its platform sections and the files only they read left
// out, the builder's app choices as its variables' defaults - and the template decorator injects the sections back
// when the template is provisioned (the Materialized view shows them).
func TestTemplateBuilderPlatformBase(t *testing.T) {
	t.Parallel()

	const mainTF = `variable "desktop" {
  type    = bool
  default = true
}

data "coder_workspace_owner" "me" {}

# platform:begin certificates
resource "coder_script" "user_certificates" {
  agent_id     = coder_agent.main.id
  display_name = "Certificates"
  script = templatefile("${path.module}/scripts/certificates.sh", {
    owner_name = data.coder_workspace_owner.me.name
  })
}
# platform:end certificates

resource "coder_agent" "main" {
  os             = "linux"
  arch           = "amd64"
  startup_script = file("${path.module}/scripts/startup.sh")
}
`
	dv := coderdtest.DeploymentValues(t)
	dv.TemplateBuilder.BaseTemplate = "ubuntu-base"
	db, ps := dbtestutil.NewDB(t)
	client := coderdtest.New(t, &coderdtest.Options{Database: db, Pubsub: ps, DeploymentValues: dv})
	owner := coderdtest.CreateFirstUser(t, client)

	file := dbgen.File(t, db, database.File{
		CreatedBy: owner.UserID,
		Mimetype:  codersdk.ContentTypeTar,
		Data: platformBaseTar(t, map[string]string{
			"main.tf":                 mainTF,
			"scripts/certificates.sh": "#!/bin/sh\necho certificate\n",
			"scripts/startup.sh":      "#!/bin/sh\n",
		}),
	})
	job := dbgen.ProvisionerJob(t, db, nil, database.ProvisionerJob{
		OrganizationID: owner.OrganizationID,
		InitiatorID:    owner.UserID,
		FileID:         file.ID,
		Tags:           database.StringMap{},
		Type:           database.ProvisionerJobTypeTemplateVersionImport,
	})
	version := dbgen.TemplateVersion(t, db, database.TemplateVersion{
		OrganizationID: owner.OrganizationID,
		JobID:          job.ID,
		CreatedBy:      owner.UserID,
	})
	dbgen.TemplateVersionVariable(t, db, database.TemplateVersionVariable{
		TemplateVersionID: version.ID,
		Name:              "user_storage",
		Value:             "true",
	})
	base := dbgen.Template(t, db, database.Template{
		OrganizationID:  owner.OrganizationID,
		Name:            "ubuntu-base",
		DisplayName:     "DEFAULT",
		ActiveVersionID: version.ID,
		CreatedBy:       owner.UserID,
	})

	ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitLong)
	defer cancel()

	bases, err := client.TemplateBuilderBases(ctx)
	require.NoError(t, err)
	require.Len(t, bases.Bases, 1)
	require.Equal(t, "platform", bases.Bases[0].ID)
	require.Equal(t, "DEFAULT", bases.Bases[0].Name)

	// A new template: the base's own logic, without the Desktop.
	data, err := client.TemplateBuilderCompose(ctx, codersdk.TemplateBuilderComposeRequest{
		BaseTemplateID:     "platform",
		BaseVariableValues: map[string]string{"desktop": "false"},
	})
	require.NoError(t, err)
	files := untarForTest(t, data)
	require.NotContains(t, files["main.tf"], "platform:")
	require.NotContains(t, files["main.tf"], "user_certificates")
	require.Regexp(t, `default\s*=\s*false`, files["main.tf"])
	require.NotContains(t, files, "scripts/certificates.sh") // only the platform's section read it
	require.Equal(t, "#!/bin/sh\n", files["scripts/startup.sh"])

	// The decorator: the base's sections, and the files it provides to every template.
	deco, err := client.TemplateDecorator(ctx)
	require.NoError(t, err)
	require.True(t, deco.Enabled, deco.Error)
	require.Equal(t, []string{"certificates"}, deco.Features)
	require.Len(t, deco.GlobalFiles, 1)
	require.Equal(t, ".platform/certificates.sh", deco.GlobalFiles[0].Path)
	require.Equal(t, "#!/bin/sh\necho certificate\n", deco.GlobalFiles[0].Content)
	require.Contains(t, deco.GlobalFiles[0].Reference, `templatefile("${path.module}/.platform/certificates.sh"`)

	// The new template as it is provisioned: the certificate's section back in its main.tf.
	mat, err := client.TemplateMaterialize(ctx, codersdk.TemplateMaterializeRequest{Files: files})
	require.NoError(t, err)
	require.True(t, mat.Enabled)
	require.Equal(t, []string{"certificates"}, mat.Injected)
	require.Contains(t, mat.MainTF, `resource "coder_script" "user_certificates"`)
	require.Contains(t, mat.MainTF, ".platform/certificates.sh")
	require.Equal(t, []string{".platform/certificates.sh"}, mat.Added)
	// The base itself has it: nothing to inject.
	mat, err = client.TemplateMaterialize(ctx, codersdk.TemplateMaterializeRequest{TemplateVersionID: version.ID})
	require.NoError(t, err)
	require.Empty(t, mat.Injected)
	require.Equal(t, mainTF, mat.MainTF)

	// The builder's own bases are not offered.
	_, err = client.TemplateBuilderCompose(ctx, codersdk.TemplateBuilderComposeRequest{BaseTemplateID: "kubernetes"})
	require.Error(t, err)

	// Its modules: the seven it offers, no other.
	modules, err := client.TemplateBuilderModules(ctx, "platform")
	require.NoError(t, err)
	ids := make([]string, 0, len(modules.Modules))
	for _, m := range modules.Modules {
		ids = append(ids, m.ID)
	}
	require.ElementsMatch(t, []string{"git-clone", "dotfiles", "personalize", "filebrowser", "git-config", "code-server", "vscode-desktop"}, ids)
	_, err = client.TemplateBuilderCompose(ctx, codersdk.TemplateBuilderComposeRequest{
		BaseTemplateID: "platform",
		Modules:        []codersdk.TemplateBuilderComposeModule{{ID: "claude-code"}},
	})
	require.ErrorContains(t, err, "not offered")

	// Renamed in the dashboard: still the base (by the ID recorded under its name), for the builder and the decorator.
	_, err = client.UpdateTemplateMeta(ctx, base.ID, codersdk.UpdateTemplateMeta{Name: ptr.Ref("default")})
	require.NoError(t, err)
	bases, err = client.TemplateBuilderBases(ctx)
	require.NoError(t, err)
	require.Len(t, bases.Bases, 1)
	require.Equal(t, base.ID, *bases.Bases[0].TemplateID)
	deco, err = client.TemplateDecorator(ctx)
	require.NoError(t, err)
	require.True(t, deco.Enabled, deco.Error)
	require.Equal(t, []string{"certificates"}, deco.Features)
}
