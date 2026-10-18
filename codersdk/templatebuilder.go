package codersdk

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"

	"github.com/google/uuid"
)

// TemplateBuilderVariableType enumerates the variable types
// supported by template builder module manifests.
type TemplateBuilderVariableType string

const (
	TemplateBuilderVariableTypeString TemplateBuilderVariableType = "string"
	TemplateBuilderVariableTypeNumber TemplateBuilderVariableType = "number"
	TemplateBuilderVariableTypeBool   TemplateBuilderVariableType = "bool"
)

type TemplateBuilderModuleVariable struct {
	Name        string                      `json:"name"`
	Type        TemplateBuilderVariableType `json:"type"`
	Description string                      `json:"description"`
	Default     json.RawMessage             `json:"default,omitempty"`
	Required    bool                        `json:"required"`
	Sensitive   bool                        `json:"sensitive"`
}

// TemplateBuilderModule is the API response type returned by
// GET /api/v2/templatebuilder/modules. The Version field is
// populated from the catalog manifest's PinnedVersion at serving time.
type TemplateBuilderModule struct {
	ID            string                          `json:"id"`
	DisplayName   string                          `json:"display_name"`
	Description   string                          `json:"description"`
	Icon          string                          `json:"icon"`
	Category      string                          `json:"category"`
	Version       string                          `json:"version"`
	CompatibleOS  []string                        `json:"compatible_os"`
	ConflictsWith []string                        `json:"conflicts_with"`
	Variables     []TemplateBuilderModuleVariable `json:"variables"`
}

// TemplateBuilderModulesResponse is the response body for listing template builder modules.
type TemplateBuilderModulesResponse struct {
	Modules []TemplateBuilderModule `json:"modules"`
}

// TemplateBuilderBase is the API response type for a base template
// returned by GET /api/v2/templatebuilder/bases.
type TemplateBuilderBase struct {
	ID            string                          `json:"id"`
	Name          string                          `json:"name"`
	Description   string                          `json:"description"`
	Icon          string                          `json:"icon"`
	OS            string                          `json:"os"`
	Variables     []TemplateBuilderModuleVariable `json:"variables"`
	Prerequisites string                          `json:"prerequisites"`
	Agents        []TemplateBuilderBaseAgent      `json:"agents"`
	// TemplateID is the Coder template behind the deployment's own base (the
	// "platform" base): admins rename it from the builder (its display name).
	TemplateID *uuid.UUID `json:"template_id,omitempty" format:"uuid"`
}

// TemplateBuilderBaseAgent is a coder_agent a base template declares. Modules
// composed onto the base target one of these by Name.
type TemplateBuilderBaseAgent struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	// Default reports whether modules attach to this agent when they do not
	// name one.
	Default bool `json:"default"`
}

// TemplateBuilderBasesResponse is the response body for listing template builder bases.
type TemplateBuilderBasesResponse struct {
	Bases []TemplateBuilderBase `json:"bases"`
}

// TemplateBuilderBases returns the list of base templates available
// in the template builder.
func (c *Client) TemplateBuilderBases(ctx context.Context) (TemplateBuilderBasesResponse, error) {
	res, err := c.Request(ctx, http.MethodGet, "/api/v2/templatebuilder/bases", nil)
	if err != nil {
		return TemplateBuilderBasesResponse{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return TemplateBuilderBasesResponse{}, ReadBodyAsError(res)
	}
	var resp TemplateBuilderBasesResponse
	return resp, ReadBodyAsJSON(res, &resp)
}

// TemplateBuilderModules returns the list of modules available for a given
// base template. If base is empty, all modules are returned.
func (c *Client) TemplateBuilderModules(ctx context.Context, base string) (TemplateBuilderModulesResponse, error) {
	path := "/api/v2/templatebuilder/modules"
	if base != "" {
		q := url.Values{"base": {base}}
		path += "?" + q.Encode()
	}
	res, err := c.Request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return TemplateBuilderModulesResponse{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return TemplateBuilderModulesResponse{}, ReadBodyAsError(res)
	}
	var resp TemplateBuilderModulesResponse
	return resp, ReadBodyAsJSON(res, &resp)
}

// TemplateBuilderComposeRequest is the request body for
// POST /api/v2/templatebuilder/compose.
type TemplateBuilderComposeRequest struct {
	BaseTemplateID     string                         `json:"base_template_id"`
	BaseVariableValues map[string]string              `json:"base_variable_values,omitempty"`
	Modules            []TemplateBuilderComposeModule `json:"modules"`
}

// TemplateBuilderComposeModule identifies a module and its variable
// values for the compose request.
type TemplateBuilderComposeModule struct {
	ID string `json:"id"`
	// AgentName targets a base coder_agent by name. Empty uses the base default.
	AgentName string            `json:"agent_name,omitempty"`
	Variables map[string]string `json:"variables,omitempty"`
}

// TemplateBuilderCompose renders a base template with the selected
// modules and returns the resulting tar archive bytes.
func (c *Client) TemplateBuilderCompose(ctx context.Context, req TemplateBuilderComposeRequest) ([]byte, error) {
	res, err := c.Request(ctx, http.MethodPost, "/api/v2/templatebuilder/compose", req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, ReadBodyAsError(res)
	}
	return io.ReadAll(res.Body)
}

// TemplateBuilderCreateTemplateRequest is the request body for
// POST /api/v2/templatebuilder/compose/template.
type TemplateBuilderCreateTemplateRequest struct {
	BaseTemplateID     string                         `json:"base_template_id"`
	BaseVariableValues map[string]string              `json:"base_variable_values,omitempty"`
	Modules            []TemplateBuilderComposeModule `json:"modules"`
	OrganizationID     uuid.UUID                      `json:"organization_id" format:"uuid" validate:"required"`
	Name               string                         `json:"name" validate:"required,template_name"`
	DisplayName        string                         `json:"display_name,omitempty" validate:"template_display_name"`
	Description        string                         `json:"description,omitempty" validate:"lt=128"`
	Icon               string                         `json:"icon,omitempty"`
	ProvisionerTags    map[string]string              `json:"provisioner_tags,omitempty"`
}

// TemplateBuilderCreateTemplateResponse is the response body for
// POST /api/v2/templatebuilder/compose/template.
type TemplateBuilderCreateTemplateResponse struct {
	Template Template `json:"template"`
}

// TemplateBuilderCreateTemplate composes a template from a base and modules,
// validates it via a provisioner import job, and creates the template.
func (c *Client) TemplateBuilderCreateTemplate(ctx context.Context, req TemplateBuilderCreateTemplateRequest) (TemplateBuilderCreateTemplateResponse, error) {
	res, err := c.Request(ctx, http.MethodPost, "/api/v2/templatebuilder/compose/template", req)
	if err != nil {
		return TemplateBuilderCreateTemplateResponse{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		return TemplateBuilderCreateTemplateResponse{}, ReadBodyAsError(res)
	}
	var resp TemplateBuilderCreateTemplateResponse
	return resp, ReadBodyAsJSON(res, &resp)
}

// TemplateDecorator is the template decorator (coderd/templatedecorator): the
// platform's sections of the deployment's base template, which Coder injects
// into every template that lacks them when it is provisioned, and the files
// they read - the global files, provided to every template under .platform/.
type TemplateDecorator struct {
	Enabled bool `json:"enabled"`
	// BaseTemplate is the base template's name (TemplateBuilder.BaseTemplate).
	BaseTemplate string                     `json:"base_template"`
	BaseVersion  uuid.UUID                  `json:"base_version" format:"uuid"`
	Features     []string                   `json:"features"`
	Sections     []TemplateDecoratorSection `json:"sections"`
	GlobalFiles  []TemplateDecoratorFile    `json:"global_files"`
	// Error: the base template's sections could not be read.
	Error string `json:"error,omitempty"`
}

// TemplateDecoratorSection is one platform section of the base template.
type TemplateDecoratorSection struct {
	Feature string `json:"feature"`
	// Placement: top, agent, pod-metadata, pod-spec or container.
	Placement string `json:"placement"`
	Text      string `json:"text"`
}

// TemplateDecoratorFile is a file the decorator provides to every template.
type TemplateDecoratorFile struct {
	Name string `json:"name"`
	// Path in a decorated template (.platform/<name>).
	Path    string `json:"path"`
	Size    int    `json:"size"`
	Content string `json:"content"`
	// Reference: how a template uses it (the base template's own use of it).
	Reference string   `json:"reference"`
	Features  []string `json:"features"`
}

// TemplateMaterializeRequest is the request body for
// POST /api/v2/templatebuilder/materialize: a template version's files, or
// files as given (the editor's).
type TemplateMaterializeRequest struct {
	TemplateVersionID uuid.UUID         `json:"template_version_id,omitempty" format:"uuid"`
	Files             map[string]string `json:"files,omitempty"`
}

// TemplateMaterializeResponse is a template's Terraform as Coder provisions it:
// its own code with the decorator's sections injected.
type TemplateMaterializeResponse struct {
	// MainTF is main.tf as it is provisioned (the file with the agent, when the
	// template has no main.tf).
	MainTF     string `json:"main_tf"`
	MainTFName string `json:"main_tf_name"`
	// Changed: every .tf file the decorator changed, as provisioned.
	Changed map[string]string `json:"changed"`
	// Added: the files the decorator adds (.platform/...).
	Added    []string                `json:"added"`
	Injected []string                `json:"injected"`
	Skipped  []TemplateDecoratorSkip `json:"skipped"`
	Enabled  bool                    `json:"enabled"`
}

// TemplateDecoratorSkip is a feature the decorator did not inject, and why.
type TemplateDecoratorSkip struct {
	Feature string `json:"feature"`
	Reason  string `json:"reason"`
}

// TemplateDecorator reads the template decorator's sections and global files.
func (c *Client) TemplateDecorator(ctx context.Context) (TemplateDecorator, error) {
	res, err := c.Request(ctx, http.MethodGet, "/api/v2/templatebuilder/decorator", nil)
	if err != nil {
		return TemplateDecorator{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return TemplateDecorator{}, ReadBodyAsError(res)
	}
	var resp TemplateDecorator
	return resp, json.NewDecoder(res.Body).Decode(&resp)
}

// TemplateMaterialize is a template's Terraform as Coder provisions it.
func (c *Client) TemplateMaterialize(ctx context.Context, req TemplateMaterializeRequest) (TemplateMaterializeResponse, error) {
	res, err := c.Request(ctx, http.MethodPost, "/api/v2/templatebuilder/materialize", req)
	if err != nil {
		return TemplateMaterializeResponse{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return TemplateMaterializeResponse{}, ReadBodyAsError(res)
	}
	var resp TemplateMaterializeResponse
	return resp, json.NewDecoder(res.Body).Decode(&resp)
}
