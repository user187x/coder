package platformha

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"
)

// RoleLabel is the pod label the Coder Service selects in activeStandby: the
// active replica's pod carries "active", the others "standby".
const RoleLabel = "coder-airgapped/ha-role"

const serviceAccountDir = "/var/run/secrets/kubernetes.io/serviceaccount"

// kubeClient is the little of the Kubernetes API the registry needs - its own
// pod's labels and whether it is terminating - with the pod's service account
// (Coder's, which may patch pods in its namespace). No client library: the fork
// has none.
type kubeClient struct {
	base      string
	namespace string
	token     func() (string, error)
	http      *http.Client
}

// inClusterKube is the API of the cluster the pod runs in, or an error outside one.
func inClusterKube() (*kubeClient, error) {
	host, port := os.Getenv("KUBERNETES_SERVICE_HOST"), os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" || port == "" {
		return nil, xerrors.New("not in a Kubernetes pod")
	}
	ns, err := os.ReadFile(serviceAccountDir + "/namespace")
	if err != nil {
		return nil, xerrors.Errorf("read the pod's namespace: %w", err)
	}
	ca, err := os.ReadFile(serviceAccountDir + "/ca.crt")
	if err != nil {
		return nil, xerrors.Errorf("read the cluster CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		return nil, xerrors.New("the cluster CA holds no certificate")
	}
	return &kubeClient{
		base:      "https://" + strings.TrimSpace(host) + ":" + strings.TrimSpace(port),
		namespace: strings.TrimSpace(string(ns)),
		// the token rotates: read it for every call
		token: func() (string, error) {
			b, err := os.ReadFile(serviceAccountDir + "/token")
			return strings.TrimSpace(string(b)), err
		},
		http: &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
		}},
	}, nil
}

func (k *kubeClient) do(ctx context.Context, method, path, contentType string, body []byte, out any) error {
	tok, err := k.token()
	if err != nil {
		return xerrors.Errorf("read the service account token: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, method, k.base+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := k.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		return xerrors.Errorf("%s %s: HTTP %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

func (k *kubeClient) podPath(pod string) string {
	return fmt.Sprintf("/api/v1/namespaces/%s/pods/%s", url.PathEscape(k.namespace), url.PathEscape(pod))
}

// labelPod sets one label on a pod (a merge patch: the others stay).
func (k *kubeClient) labelPod(ctx context.Context, pod, key, value string) error {
	patch, _ := json.Marshal(map[string]any{"metadata": map[string]any{"labels": map[string]string{key: value}}})
	return k.do(ctx, http.MethodPatch, k.podPath(pod), "application/merge-patch+json", patch, nil)
}

// podTerminating reports whether the pod is being deleted (its preStop runs).
func (k *kubeClient) podTerminating(ctx context.Context, pod string) (bool, error) {
	var p struct {
		Metadata struct {
			DeletionTimestamp *string `json:"deletionTimestamp"`
		} `json:"metadata"`
	}
	if err := k.do(ctx, http.MethodGet, k.podPath(pod), "", nil, &p); err != nil {
		return false, err
	}
	return p.Metadata.DeletionTimestamp != nil, nil
}

// podLabeler keeps the pod's RoleLabel equal to the replica's role, retrying
// until it lands (the newest wanted value wins).
type podLabeler struct {
	kube   *kubeClient
	pod    string
	logger slog.Logger
	mu     sync.Mutex
	want   string
	kick   chan struct{}
}

func (l *podLabeler) set(role string) {
	l.mu.Lock()
	l.want = role
	l.mu.Unlock()
	select {
	case l.kick <- struct{}{}:
	default:
	}
}

func (l *podLabeler) run(ctx context.Context) {
	applied := ""
	backoff := time.Second
	for {
		l.mu.Lock()
		want := l.want
		l.mu.Unlock()
		if want != applied {
			if err := l.kube.labelPod(ctx, l.pod, RoleLabel, want); err != nil {
				l.logger.Warn(ctx, "label the pod with its role", slog.F("role", want), slog.Error(err))
				select {
				case <-ctx.Done():
					return
				case <-time.After(backoff):
				}
				if backoff < 10*time.Second {
					backoff *= 2
				}
				continue
			}
			applied, backoff = want, time.Second
			l.logger.Info(ctx, "pod labeled with its role", slog.F("role", want))
		}
		select {
		case <-ctx.Done():
			return
		case <-l.kick:
		}
	}
}

// StartPodLabeler labels this replica's pod with its role (activeStandby) from
// now on: "standby" at once, "active" once it holds the lease and serves. Outside
// Kubernetes it only logs that it cannot.
func (r *Registry) StartPodLabeler(ctx context.Context) {
	kube, err := inClusterKube()
	if err != nil || r.cfg.PodName == "" {
		r.logger.Warn(ctx, "cannot label the pod with its role (the Service selects the active pod by it)", slog.Error(err))
		return
	}
	r.mu.Lock()
	r.kube = kube
	r.mu.Unlock()
	l := &podLabeler{kube: kube, pod: r.cfg.PodName, logger: r.logger, kick: make(chan struct{}, 1)}
	l.set(r.Role())
	r.OnRoleChange(l.set)
	go l.run(ctx)
}
