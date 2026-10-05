package coderd

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/codersdk"
)

// PlatformServiceRoute forwards requests under PathPrefix to Target. The
// dashboard's platform services (helm/coder-platform: /__coder-ui and
// /__banner) are reached this way, so they share Coder's origin however
// Coder is exposed: Ingress, Gateway API, LoadBalancer or port-forward.
type PlatformServiceRoute struct {
	PathPrefix string
	Target     *url.URL
}

// ParsePlatformServiceRoutes reads comma-separated "prefix=url" pairs, for
// example "/__coder-ui=http://coder-ui-updates,/__banner=http://coder-banner".
// Prefixes must start with "/__" so they can never shadow Coder's own routes.
func ParsePlatformServiceRoutes(value string) ([]PlatformServiceRoute, error) {
	var routes []PlatformServiceRoute
	seen := map[string]bool{}
	for _, entry := range strings.Split(value, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		prefix, rawTarget, ok := strings.Cut(entry, "=")
		if !ok {
			return nil, xerrors.Errorf("platform service route %q: want prefix=url", entry)
		}
		prefix = strings.TrimSuffix(strings.TrimSpace(prefix), "/")
		if !strings.HasPrefix(prefix, "/__") || strings.ContainsAny(prefix, "*{}") {
			return nil, xerrors.Errorf("platform service route %q: the path prefix must start with /__ and contain no patterns", entry)
		}
		if seen[prefix] {
			return nil, xerrors.Errorf("platform service route %q: prefix %s is listed twice", entry, prefix)
		}
		seen[prefix] = true
		target, err := url.Parse(strings.TrimSpace(rawTarget))
		if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" {
			return nil, xerrors.Errorf("platform service route %q: the target must be an http(s) URL", entry)
		}
		routes = append(routes, PlatformServiceRoute{PathPrefix: prefix, Target: target})
	}
	return routes, nil
}

// platformServiceProxy forwards requests, path and Host header unchanged, to
// one platform service. The services authenticate users with their Coder
// session and check the Host header against the request's Origin themselves.
func platformServiceProxy(logger slog.Logger, target *url.URL) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)
	// Long polls and the banner's WebSocket must not be buffered.
	proxy.FlushInterval = -1
	proxy.ErrorHandler = func(rw http.ResponseWriter, r *http.Request, err error) {
		logger.Warn(r.Context(), "platform service unreachable", slog.F("target", target.String()), slog.Error(err))
		httpapi.Write(r.Context(), rw, http.StatusBadGateway, codersdk.Response{
			Message: "The platform service is not reachable.",
			Detail:  err.Error(),
		})
	}
	return proxy
}
