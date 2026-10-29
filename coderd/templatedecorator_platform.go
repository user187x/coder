package coderd

import (
	"context"
	"database/sql"
	"net/http"
	"path"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"

	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/coderd/templatedecorator"
	"github.com/coder/coder/v2/codersdk"
)

// The template decorator (coderd/templatedecorator): the platform's sections of
// the deployment's base template (TemplateBuilder.BaseTemplate) - the user's
// certificate, Lock Down, the Cloud Drive, the metrics - injected into every
// other template's Terraform when a provisioner takes its job (an import, a
// dry run, a workspace build), so a template's own code is only its own logic.
// The payload is read from the base template's active version, again when it
// changes.

// templateDecoratorState caches the payload by the base's active version.
type templateDecoratorState struct {
	mu      sync.Mutex
	version uuid.UUID
	payload *templatedecorator.Payload
	err     error
}

// templateDecoratorPayload is the payload, or nil when the deployment has no
// base template (or it is not pushed yet).
func (api *API) templateDecoratorPayload(ctx context.Context) (*templatedecorator.Payload, uuid.UUID, error) {
	name := api.templateBuilderPlatformBaseName()
	if name == "" {
		return nil, uuid.Nil, nil
	}
	//nolint:gocritic // The decorator reads the base template for every template's provisioner jobs.
	sys := dbauthz.AsSystemRestricted(ctx)
	org, err := api.Database.GetDefaultOrganization(sys)
	if err != nil {
		return nil, uuid.Nil, xerrors.Errorf("default organization: %w", err)
	}
	tmpl, err := api.platformBaseTemplate(sys, org.ID, name)
	if xerrors.Is(err, sql.ErrNoRows) {
		return nil, uuid.Nil, nil
	}
	if err != nil {
		return nil, uuid.Nil, xerrors.Errorf("base template %q: %w", name, err)
	}
	st := &api.templateDecorator
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.version == tmpl.ActiveVersionID {
		return st.payload, st.version, st.err
	}
	base, err := api.templateBuilderPlatformBase(ctx, org.ID)
	if err != nil {
		return nil, uuid.Nil, err
	}
	values := map[string]string{}
	for _, v := range base.Variables {
		values[v.Name] = v.Value
	}
	payload, err := templatedecorator.Extract(base.MainTF, base.Files, values)
	st.version, st.payload, st.err = tmpl.ActiveVersionID, payload, err
	if err != nil {
		api.Logger.Error(ctx, "template decorator: the base template's sections", slog.F("template", name), slog.Error(err))
	}
	return payload, st.version, err
}

// DecorateTemplateArchive is the provisioner servers' template decorator: the
// archive with the platform's sections it lacks, else as it is.
func (api *API) DecorateTemplateArchive(ctx context.Context, archive []byte) ([]byte, error) {
	payload, _, err := api.templateDecoratorPayload(ctx)
	if err != nil {
		return archive, err
	}
	if payload == nil {
		payload = &templatedecorator.Payload{}
	}
	managed := *payload
	managed.RuntimeImage = api.WorkspaceRuntimeImage
	managed.AccessURL = api.AccessURL.String()
	out, res, err := managed.DecorateArchive(archive)
	if err != nil {
		return archive, err
	}
	if len(res.Injected) > 0 {
		api.Logger.Debug(ctx, "template decorated", slog.F("result", res.String()))
	}
	return out, nil
}

// @Summary Get template decorator
// @Description The platform's sections and the files it provides.
// @ID get-template-decorator
// @Security CoderSessionToken
// @Produce json
// @Tags TemplateBuilder
// @Success 200 {object} codersdk.TemplateDecorator
// @Router /api/v2/templatebuilder/decorator [get]
func (api *API) templateBuilderDecorator(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !api.Authorize(r, policy.ActionRead, rbac.ResourceTemplate.AnyOrganization()) {
		httpapi.ResourceNotFound(rw)
		return
	}
	resp := codersdk.TemplateDecorator{
		BaseTemplate: api.templateBuilderPlatformBaseName(),
		Features:     []string{},
		Sections:     []codersdk.TemplateDecoratorSection{},
		GlobalFiles:  []codersdk.TemplateDecoratorFile{},
	}
	payload, version, err := api.templateDecoratorPayload(ctx)
	if err != nil {
		resp.Error = err.Error()
	}
	if payload != nil {
		resp.Enabled = true
		resp.BaseVersion = version
		resp.Features = payload.Features
		for _, s := range payload.Sections {
			resp.Sections = append(resp.Sections, codersdk.TemplateDecoratorSection{
				Feature: s.Feature, Placement: string(s.Placement), Text: s.Text,
			})
		}
		refs := payload.References()
		names := make([]string, 0, len(payload.Files))
		for name := range payload.Files {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			data := payload.Files[name]
			resp.GlobalFiles = append(resp.GlobalFiles, codersdk.TemplateDecoratorFile{
				Name:      name,
				Path:      templatedecorator.ScriptDir + "/" + name,
				Size:      len(data),
				Content:   string(data),
				Reference: refs[name].Text,
				Features:  refs[name].Features,
			})
		}
	}
	httpapi.Write(ctx, rw, http.StatusOK, resp)
}

// @Summary Materialize template
// @Description A template's Terraform as Coder provisions it (the decorator's sections injected).
// @ID materialize-template
// @Security CoderSessionToken
// @Accept json
// @Produce json
// @Tags TemplateBuilder
// @Param request body codersdk.TemplateMaterializeRequest true "A template version, or files"
// @Success 200 {object} codersdk.TemplateMaterializeResponse
// @Router /api/v2/templatebuilder/materialize [post]
func (api *API) templateBuilderMaterialize(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req codersdk.TemplateMaterializeRequest
	if !httpapi.Read(ctx, rw, r, &req) {
		return
	}
	files := map[string][]byte{}
	if req.TemplateVersionID != uuid.Nil {
		// as the caller: a version they may not read is not found
		version, err := api.Database.GetTemplateVersionByID(ctx, req.TemplateVersionID)
		if httpapi.Is404Error(err) {
			httpapi.ResourceNotFound(rw)
			return
		}
		if err != nil {
			httpapi.InternalServerError(rw, err)
			return
		}
		//nolint:gocritic // The caller may read the version: its job's files are read as the system.
		sys := dbauthz.AsSystemRestricted(ctx)
		job, err := api.Database.GetProvisionerJobByID(sys, version.JobID)
		if err != nil {
			httpapi.InternalServerError(rw, err)
			return
		}
		file, err := api.Database.GetFileByID(sys, job.FileID)
		if err != nil {
			httpapi.InternalServerError(rw, err)
			return
		}
		files, err = untarTemplateFiles(file.Data)
		if err != nil {
			httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{Message: "The version's files cannot be read.", Detail: err.Error()})
			return
		}
	} else {
		if !api.Authorize(r, policy.ActionRead, rbac.ResourceTemplate.AnyOrganization()) {
			httpapi.ResourceNotFound(rw)
			return
		}
		for name, content := range req.Files {
			files[path.Clean(strings.TrimPrefix(name, "./"))] = []byte(content)
		}
	}
	resp := codersdk.TemplateMaterializeResponse{
		Changed:  map[string]string{},
		Added:    []string{},
		Injected: []string{},
		Skipped:  []codersdk.TemplateDecoratorSkip{},
	}
	mainName := "main.tf"
	if _, ok := files[mainName]; !ok {
		for name, data := range files {
			if strings.HasSuffix(name, ".tf") && strings.Contains(string(data), `"coder_agent"`) {
				mainName = name
				break
			}
		}
	}
	resp.MainTFName = mainName
	resp.MainTF = string(files[mainName])
	payload, _, err := api.templateDecoratorPayload(ctx)
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{Message: "The template decorator's sections cannot be read.", Detail: err.Error()})
		return
	}
	if payload == nil && api.WorkspaceRuntimeImage == "" {
		httpapi.Write(ctx, rw, http.StatusOK, resp)
		return
	}
	if payload == nil {
		payload = &templatedecorator.Payload{}
	}
	managed := *payload
	managed.RuntimeImage = api.WorkspaceRuntimeImage
	managed.AccessURL = api.AccessURL.String()
	resp.Enabled = true
	res, err := managed.Decorate(files)
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{Message: "The template could not be decorated.", Detail: err.Error()})
		return
	}
	resp.MainTF = string(res.Files[mainName])
	for _, name := range res.Changed {
		resp.Changed[name] = string(res.Files[name])
	}
	resp.Added = append(resp.Added, res.Added...)
	resp.Injected = append(resp.Injected, res.Injected...)
	for _, s := range res.Skipped {
		resp.Skipped = append(resp.Skipped, codersdk.TemplateDecoratorSkip{Feature: s.Feature, Reason: s.Reason})
	}
	httpapi.Write(ctx, rw, http.StatusOK, resp)
}
