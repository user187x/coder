package agentfiles

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"cdr.dev/slog/v3"
	"github.com/coder/coder/v2/agent/usershell"
	"github.com/coder/coder/v2/codersdk/workspacesdk"
)

// API collects workspace files for support bundles through the agent.
type API struct {
	logger            slog.Logger
	envInfo           usershell.EnvInfoer
	bundleFilesLimits workspacesdk.BundleFilesLimits
}

// Option configures the API.
type Option func(*API)

// WithBundleFilesLimits overrides the bundle files collection limits.
func WithBundleFilesLimits(limits workspacesdk.BundleFilesLimits) Option {
	return func(api *API) {
		api.bundleFilesLimits = limits
	}
}

// WithEnvInfo overrides how the agent user's home directory is resolved.
func WithEnvInfo(envInfo usershell.EnvInfoer) Option {
	return func(api *API) {
		api.envInfo = envInfo
	}
}

func NewAPI(logger slog.Logger, opts ...Option) *API {
	api := &API{
		logger:            logger,
		envInfo:           usershell.SystemEnvInfo{},
		bundleFilesLimits: defaultBundleFilesLimits,
	}
	for _, opt := range opts {
		opt(api)
	}
	return api
}

// Routes returns the HTTP handler for file-related routes.
func (api *API) Routes() http.Handler {
	r := chi.NewRouter()

	r.Post("/bundle-files", api.HandleBundleFiles)

	return r
}
