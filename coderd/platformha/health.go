package platformha

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"time"

	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"
)

// ServeHealth serves the replica's probes and status on Config.HealthAddress,
// from the start - a standby does not serve Coder's own port:
//
//	/livez     the process runs
//	/readyz    not fenced (a standby is ready: the Service picks the active one
//	           by its pod's label, so rollouts never wait on a standby)
//	/status    this replica, its role and the members, as JSON
//	/handover  the preStop hook: hands the active lease over (only while the
//	           pod is terminating - a stray request does nothing)
//
// The returned function stops it.
func (r *Registry) ServeHealth(ctx context.Context) (func(), error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/livez", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		if r.Fenced() {
			http.Error(w, "fenced: this replica holds no lease", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/status", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(r.Status())
	})
	mux.HandleFunc("/handover", func(w http.ResponseWriter, req *http.Request) {
		r.mu.Lock()
		kube := r.kube
		r.mu.Unlock()
		if kube == nil || r.cfg.PodName == "" {
			http.Error(w, "no Kubernetes API: not handing over", http.StatusPreconditionFailed)
			return
		}
		terminating, err := kube.podTerminating(req.Context(), r.cfg.PodName)
		if err != nil || !terminating {
			http.Error(w, "the pod is not terminating: not handing over", http.StatusPreconditionFailed)
			return
		}
		hctx, cancel := context.WithTimeout(context.Background(), r.cfg.HandoverTimeout+10*time.Second)
		defer cancel()
		wasActive := r.Role() == RoleActive
		if err := r.Handover(hctx); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if wasActive {
			// Keep serving while ingress controllers observe the role-label change.
			// Ending preStop immediately can close the old listener before routing
			// removes it, producing gateway errors despite a ready successor.
			drain := time.NewTimer(5 * time.Second)
			defer drain.Stop()
			select {
			case <-hctx.Done():
			case <-drain.C:
			}
		}
		_, _ = w.Write([]byte("handed over\n"))
	})
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", r.cfg.HealthAddress)
	if err != nil {
		return nil, xerrors.Errorf("listen on %s: %w", r.cfg.HealthAddress, err)
	}
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			r.logger.Error(ctx, "platform HA health server", slog.Error(err))
		}
	}()
	r.logger.Info(ctx, "platform HA health server listening", slog.F("address", ln.Addr().String()))
	return func() {
		sctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}, nil
}
