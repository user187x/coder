package medialease

import (
	"context"
	"sync"
)

// Fence revokes existing lease contexts when a replica stops serving. Recovery
// creates a new context without reviving any session from the previous epoch.
type Fence struct {
	mu     sync.Mutex
	ctx    context.Context
	cancel context.CancelFunc
}

// NewFence starts fenced until an authoritative serving decision permits media.
func NewFence() *Fence {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return &Fence{ctx: ctx, cancel: cancel}
}

// SetServing is safe in nonblocking HA role and fencing callbacks.
func (f *Fence) SetServing(allowed bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !allowed {
		f.cancel()
		return
	}
	if f.ctx.Err() != nil {
		f.ctx, f.cancel = context.WithCancel(context.Background())
	}
}

// Context returns this replica's current serving epoch, canceled while fenced.
func (f *Fence) Context() context.Context { f.mu.Lock(); defer f.mu.Unlock(); return f.ctx }
