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
// starts from a copy of its active version's files.
func TestTemplateBuilderPlatformBase(t *testing.T) {
	t.Parallel()

	const mainTF = "resource \"coder_agent\" \"main\" {\n  os   = \"linux\"\n  arch = \"amd64\"\n}\n"
	dv := coderdtest.DeploymentValues(t)
	dv.TemplateBuilder.BaseTemplate = "ubuntu-base"
	db, ps := dbtestutil.NewDB(t)
	client := coderdtest.New(t, &coderdtest.Options{Database: db, Pubsub: ps, DeploymentValues: dv})
	owner := coderdtest.CreateFirstUser(t, client)

	file := dbgen.File(t, db, database.File{
		CreatedBy: owner.UserID,
		Mimetype:  codersdk.ContentTypeTar,
		Data: platformBaseTar(t, map[string]string{
			"main.tf":                mainTF,
			"certificates.tf":        "# the user's certificate\n",
			"scripts/cloud-drive.sh": "#!/bin/sh\n",
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
	dbgen.Template(t, db, database.Template{
		OrganizationID:  owner.OrganizationID,
		Name:            "ubuntu-base",
		DisplayName:     "UBUNTU",
		ActiveVersionID: version.ID,
		CreatedBy:       owner.UserID,
	})

	ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitLong)
	defer cancel()

	bases, err := client.TemplateBuilderBases(ctx)
	require.NoError(t, err)
	require.Len(t, bases.Bases, 1)
	require.Equal(t, "platform", bases.Bases[0].ID)
	require.Equal(t, "UBUNTU", bases.Bases[0].Name)

	data, err := client.TemplateBuilderCompose(ctx, codersdk.TemplateBuilderComposeRequest{BaseTemplateID: "platform"})
	require.NoError(t, err)
	files := untarForTest(t, data)
	require.Equal(t, mainTF, files["main.tf"])
	require.Equal(t, "# the user's certificate\n", files["certificates.tf"])
	require.Equal(t, "#!/bin/sh\n", files["scripts/cloud-drive.sh"])

	// The builder's own bases are not offered.
	_, err = client.TemplateBuilderCompose(ctx, codersdk.TemplateBuilderComposeRequest{BaseTemplateID: "kubernetes"})
	require.Error(t, err)
}
