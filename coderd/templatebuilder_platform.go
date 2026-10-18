package coderd

import (
	"archive/tar"
	"bytes"
	"context"
	"database/sql"
	"io"
	"path"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/templatebuilder"
	"github.com/coder/coder/v2/coderd/templatedecorator"
	"github.com/coder/coder/v2/codersdk"
)

// templateBuilderPlatformBaseID is the base ID of the deployment's own base
// template (TemplateBuilder.BaseTemplate): when set, the builder offers it
// alone, and a new template starts from a copy of its active version - its
// files and its variable values - with the builder's choices added. What the
// deployment builds into its base (the Cloud Drive, Lock Down, the user's
// certificate, the metrics) is then in every template made from it.
const templateBuilderPlatformBaseID = "platform"

// templateBuilderPlatformMaxFile bounds what is read of the base's files.
const templateBuilderPlatformMaxFile = 10 << 20

// platformBuilderBase is the deployment's base template as the builder uses it.
type platformBuilderBase struct {
	Template  database.Template
	MainTF    []byte
	Readme    []byte
	Files     map[string][]byte
	Variables []codersdk.VariableValue
}

// errPlatformBaseMissing: a base template is configured, but no template of
// that name is in the organization.
var errPlatformBaseMissing = xerrors.New("the deployment's base template is not there")

// templateBuilderPlatformBaseName is the configured base template's name, or
// "" when the builder uses its own bases.
func (api *API) templateBuilderPlatformBaseName() string {
	return strings.TrimSpace(api.DeploymentValues.TemplateBuilder.BaseTemplate.String())
}

// templateBuilderPlatformBase reads the deployment's base template in the
// organization (the default one when orgID is uuid.Nil). It reads as the
// system: the caller was authorized to read or create templates already.
func (api *API) templateBuilderPlatformBase(ctx context.Context, orgID uuid.UUID) (*platformBuilderBase, error) {
	name := api.templateBuilderPlatformBaseName()
	if name == "" {
		return nil, nil
	}
	//nolint:gocritic // The builder's base is read for a template admin, who may create templates.
	sys := dbauthz.AsSystemRestricted(ctx)
	if orgID == uuid.Nil {
		org, err := api.Database.GetDefaultOrganization(sys)
		if err != nil {
			return nil, xerrors.Errorf("default organization: %w", err)
		}
		orgID = org.ID
	}
	tmpl, err := api.Database.GetTemplateByOrganizationAndName(sys, database.GetTemplateByOrganizationAndNameParams{
		OrganizationID: orgID,
		Name:           name,
		Deleted:        false,
	})
	if xerrors.Is(err, sql.ErrNoRows) {
		return nil, errPlatformBaseMissing
	}
	if err != nil {
		return nil, xerrors.Errorf("base template %q: %w", name, err)
	}
	version, err := api.Database.GetTemplateVersionByID(sys, tmpl.ActiveVersionID)
	if err != nil {
		return nil, xerrors.Errorf("base template's active version: %w", err)
	}
	job, err := api.Database.GetProvisionerJobByID(sys, version.JobID)
	if err != nil {
		return nil, xerrors.Errorf("base template version's job: %w", err)
	}
	file, err := api.Database.GetFileByID(sys, job.FileID)
	if err != nil {
		return nil, xerrors.Errorf("base template version's files: %w", err)
	}
	files, err := untarTemplateFiles(file.Data)
	if err != nil {
		return nil, xerrors.Errorf("base template version's files: %w", err)
	}
	mainTF, ok := files["main.tf"]
	if !ok {
		return nil, xerrors.New("the base template has no main.tf")
	}
	delete(files, "main.tf")
	readme := files["README.md"]
	delete(files, "README.md")
	vars, err := api.Database.GetTemplateVersionVariables(sys, version.ID)
	if err != nil {
		return nil, xerrors.Errorf("base template version's variables: %w", err)
	}
	values := make([]codersdk.VariableValue, 0, len(vars))
	for _, v := range vars {
		if v.Value != "" {
			values = append(values, codersdk.VariableValue{Name: v.Name, Value: v.Value})
		}
	}
	return &platformBuilderBase{Template: tmpl, MainTF: mainTF, Readme: readme, Files: files, Variables: values}, nil
}

// composePlatform is templatebuilder.Compose for the deployment's base: the
// modules rendered onto a copy of its own logic - its platform sections (the
// certificate, Lock Down, the Cloud Drive, the metrics) and the files only they
// read left out: the template decorator injects them when the template is
// provisioned - with the builder's choices of the base's variables (the
// Desktop, File Browser and Terminal apps) as their defaults.
func (api *API) composePlatform(base *platformBuilderBase, modules []templatebuilder.ComposeModule, choices map[string]string) (*templatebuilder.ComposeResult, error) {
	own, only, err := templatedecorator.Strip(base.MainTF)
	if err != nil {
		return nil, xerrors.Errorf("the base template's platform sections: %w", err)
	}
	own, err = setVariableDefaults(own, choices)
	if err != nil {
		return nil, err
	}
	skip := map[string]bool{}
	for _, name := range only {
		skip[name] = true
	}
	extra := make(map[string][]byte, len(base.Files))
	for name, data := range base.Files {
		if !skip[name] {
			extra[name] = data
		}
	}
	return templatebuilder.ComposeOnto(own, base.Readme, extra,
		api.DeploymentValues.TemplateBuilder.RegistryURL.String(), modules)
}

// setVariableDefaults: the main.tf with the given variables' defaults (only the
// variables it declares; a bool's or a number's value as such).
func setVariableDefaults(mainTF []byte, values map[string]string) ([]byte, error) {
	if len(values) == 0 {
		return mainTF, nil
	}
	f, diags := hclwrite.ParseConfig(mainTF, "main.tf", hcl.InitialPos)
	if diags.HasErrors() {
		return nil, xerrors.Errorf("the base template's main.tf: %s", diags.Error())
	}
	for _, blk := range f.Body().Blocks() {
		if blk.Type() != "variable" || len(blk.Labels()) != 1 {
			continue
		}
		v, ok := values[blk.Labels()[0]]
		if !ok {
			continue
		}
		typ := ""
		if a := blk.Body().GetAttribute("type"); a != nil {
			typ = strings.TrimSpace(string(a.Expr().BuildTokens(nil).Bytes()))
		}
		switch typ {
		case "bool":
			if v != "true" && v != "false" {
				return nil, xerrors.Errorf("%s: true or false", blk.Labels()[0])
			}
			blk.Body().SetAttributeValue("default", cty.BoolVal(v == "true"))
		case "number":
			n, err := strconv.ParseFloat(v, 64)
			if err != nil {
				return nil, xerrors.Errorf("%s: a number", blk.Labels()[0])
			}
			blk.Body().SetAttributeValue("default", cty.NumberFloatVal(n))
		default:
			blk.Body().SetAttributeValue("default", cty.StringVal(v))
		}
	}
	return f.Bytes(), nil
}

// platformBuilderBaseSDK is the deployment's base as the builder lists it.
func platformBuilderBaseSDK(base *platformBuilderBase) codersdk.TemplateBuilderBase {
	name := base.Template.DisplayName
	if name == "" {
		name = base.Template.Name
	}
	return codersdk.TemplateBuilderBase{
		ID:          templateBuilderPlatformBaseID,
		Name:        name,
		Description: base.Template.Description,
		Icon:        base.Template.Icon,
		OS:          string(templatebuilder.BaseOSLinux),
		Variables:   []codersdk.TemplateBuilderModuleVariable{},
		Agents:      []codersdk.TemplateBuilderBaseAgent{{Name: "main", Default: true}},
	}
}

// untarTemplateFiles reads a template version's tar into {path: content}
// (regular files only, at most templateBuilderPlatformMaxFile each).
func untarTemplateFiles(data []byte) (map[string][]byte, error) {
	files := map[string][]byte{}
	tr := tar.NewReader(bytes.NewReader(data))
	for {
		hdr, err := tr.Next()
		if xerrors.Is(err, io.EOF) {
			return files, nil
		}
		if err != nil {
			return nil, xerrors.Errorf("not a tar archive: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		name := path.Clean(strings.TrimPrefix(hdr.Name, "./"))
		if name == "." || strings.HasPrefix(name, "../") || path.IsAbs(name) {
			continue
		}
		if hdr.Size > templateBuilderPlatformMaxFile {
			return nil, xerrors.Errorf("%s is larger than %d bytes", name, templateBuilderPlatformMaxFile)
		}
		content, err := io.ReadAll(io.LimitReader(tr, templateBuilderPlatformMaxFile))
		if err != nil {
			return nil, xerrors.Errorf("read %s: %w", name, err)
		}
		files[name] = content
	}
}
