package platformbanner

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"cdr.dev/slog/v3"
	"github.com/coder/websocket"
)

// Live channel settings: the banner service's, which the dashboard's
// useBannerLive.ts expects (it reconnects after 60 s without a message).
const (
	liveMaxClients = 5000
	liveHeartbeat  = 20 * time.Second
	liveWriteWait  = 10 * time.Second
	liveQueue      = 16
	liveReadLimit  = 1024
	// a re-read now and then, in case a pubsub notice was lost
	liveRecheck = 30 * time.Second
)

// Hub pushes the banner to this replica's open tabs: on connect, on every
// change (any replica's, heard on pubsub), with a heartbeat in between.
type Hub struct {
	store  *Store
	logger slog.Logger

	mu      sync.Mutex
	clients map[*client]struct{}
	last    []byte // the banner message last sent

	cancel context.CancelFunc
	done   chan struct{}
}

type client struct {
	send chan []byte
}

// NewHub starts the hub: it listens for changes until Close.
func NewHub(store *Store, logger slog.Logger) *Hub {
	ctx, cancel := context.WithCancel(context.Background())
	h := &Hub{store: store, logger: logger, clients: map[*client]struct{}{}, cancel: cancel, done: make(chan struct{})}
	changed := make(chan struct{}, 1)
	unsubscribe, err := store.ps.Subscribe(ChangedChannel, func(context.Context, []byte) {
		select {
		case changed <- struct{}{}:
		default:
		}
	})
	if err != nil {
		logger.Warn(ctx, "subscribe to banner changes (re-reading every 30 s instead)", slog.Error(err))
		unsubscribe = func() {}
	}
	go func() {
		defer close(h.done)
		defer unsubscribe()
		recheck := time.NewTicker(liveRecheck)
		defer recheck.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-changed:
			case <-recheck.C:
			}
			h.refresh(ctx)
		}
	}()
	return h
}

// Close stops listening and drops every tab (they reconnect elsewhere).
func (h *Hub) Close() {
	h.cancel()
	<-h.done
	h.mu.Lock()
	for c := range h.clients {
		close(c.send)
		delete(h.clients, c)
	}
	h.mu.Unlock()
}

// Subscribers is the number of tabs this replica pushes to.
func (h *Hub) Subscribers() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

func message(b Banner) []byte {
	raw, _ := json.Marshal(struct {
		Type   string `json:"type"`
		Banner Banner `json:"banner"`
	}{"banner", b})
	return raw
}

// refresh reads the banner and sends it to every tab when it changed.
func (h *Hub) refresh(ctx context.Context) {
	st, err := h.store.Load(ctx)
	if err != nil {
		h.logger.Warn(ctx, "read the banner for the live tabs", slog.Error(err))
		return
	}
	h.Broadcast(st.Banner())
}

// Broadcast sends b to every tab when it differs from what they have; it
// returns how many tabs it reached.
func (h *Hub) Broadcast(b Banner) int {
	msg := message(b)
	h.mu.Lock()
	defer h.mu.Unlock()
	if string(msg) == string(h.last) {
		return len(h.clients)
	}
	h.last = msg
	n := 0
	for c := range h.clients {
		select {
		case c.send <- msg:
			n++
		default:
			// a tab that does not keep up: dropped (it reconnects)
			close(c.send)
			delete(h.clients, c)
		}
	}
	return n
}

// ServeHTTP is GET /__banner/live: a WebSocket that gets {"type":"banner",
// "banner":{...}} at once and at every change, and {"type":"hb"} every 20 s.
// No authentication: the banner is public. The Origin must be this host.
func (h *Hub) ServeHTTP(rw http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	full := len(h.clients) >= liveMaxClients
	h.mu.Unlock()
	if full {
		http.Error(rw, "Too many subscribers", http.StatusServiceUnavailable)
		return
	}
	st, err := h.store.Load(r.Context())
	if err != nil {
		http.Error(rw, "the banner is unavailable", http.StatusServiceUnavailable)
		return
	}
	// coder/websocket refuses an Origin other than the request's Host
	conn, err := websocket.Accept(rw, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(liveReadLimit)
	ctx := conn.CloseRead(context.Background()) // answers pings, ends when the tab goes
	c := &client{send: make(chan []byte, liveQueue)}
	c.send <- message(st.Banner())
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		if _, ok := h.clients[c]; ok {
			delete(h.clients, c)
			close(c.send)
		}
		h.mu.Unlock()
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}()

	hb := time.NewTicker(liveHeartbeat)
	defer hb.Stop()
	write := func(msg []byte) bool {
		wctx, cancel := context.WithTimeout(ctx, liveWriteWait)
		defer cancel()
		return conn.Write(wctx, websocket.MessageText, msg) == nil
	}
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-c.send:
			if !ok || !write(msg) {
				return
			}
		case <-hb.C:
			if !write([]byte(`{"type":"hb"}`)) {
				return
			}
			pctx, cancel := context.WithTimeout(ctx, liveWriteWait)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				return // silent: gone
			}
		}
	}
}
