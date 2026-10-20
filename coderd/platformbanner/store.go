package platformbanner

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/database/pubsub"
)

// stateKey is the runtime-config entry that holds what admins published.
const stateKey = "platform_banner_state"

// lockID serializes the read-modify-write of a change across replicas.
var lockID = database.GenLockID(stateKey)

// ChangedChannel is the pubsub channel every replica hears a change on.
const ChangedChannel = "platform_banner_changed"

// State is what admins published: the banner they wrote (none: the defaults
// show), the revision a "show again" bumps, and who changed it last.
type State struct {
	Override  *Fields `json:"override,omitempty"`
	Revision  int64   `json:"revision"`
	UpdatedBy *string `json:"updatedBy"`
	UpdatedAt *string `json:"updatedAt"`
}

// Banner is the banner every page reads now.
func (s State) Banner() Banner {
	if s.Override != nil {
		return Banner{Fields: *s.Override, ID: ID(*s.Override, s.Revision)}
	}
	d := Defaults()
	return Banner{Fields: d, ID: ID(d, 0)}
}

// Store keeps the State in the database.
type Store struct {
	db  database.Store
	ps  pubsub.Pubsub
	now func() time.Time
}

func NewStore(db database.Store, ps pubsub.Pubsub) *Store {
	return &Store{db: db, ps: ps, now: time.Now}
}

// Load reads the state (none published yet: the zero State).
func (s *Store) Load(ctx context.Context) (State, error) {
	// The banner is public (every page, the sign-in page too); changes are
	// authorized by the handler before they reach the store.
	//nolint:gocritic // reading the one runtime-config entry the banner keeps
	return load(dbauthz.AsSystemRestricted(ctx), s.db)
}

func load(ctx context.Context, db database.Store) (State, error) {
	raw, err := db.GetRuntimeConfig(ctx, stateKey)
	if xerrors.Is(err, sql.ErrNoRows) {
		return State{}, nil
	}
	if err != nil {
		return State{}, xerrors.Errorf("read the banner: %w", err)
	}
	var stored struct {
		Override  json.RawMessage `json:"override"`
		Revision  int64           `json:"revision"`
		UpdatedBy *string         `json:"updatedBy"`
		UpdatedAt *string         `json:"updatedAt"`
	}
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return State{}, xerrors.Errorf("decode the banner: %w", err)
	}
	st := State{Revision: stored.Revision, UpdatedBy: stored.UpdatedBy, UpdatedAt: stored.UpdatedAt}
	if len(stored.Override) > 0 && string(stored.Override) != "null" {
		// over the defaults, so a field stored before it existed takes its default
		f := FieldDefaults()
		if err := json.Unmarshal(stored.Override, &f); err != nil {
			return State{}, xerrors.Errorf("decode the published banner: %w", err)
		}
		st.Override = &f
	}
	return st, nil
}

// Save publishes fields (cleaned) as the banner.
func (s *Store) Save(ctx context.Context, fields Fields, user string) (State, error) {
	return s.change(ctx, user, func(st *State) error {
		st.Override = &fields
		return nil
	})
}

// Reappear shows the banner again to everyone who dismissed it: a new
// revision (so a new id), enabled.
func (s *Store) Reappear(ctx context.Context, user string) (State, error) {
	return s.change(ctx, user, func(st *State) error {
		f := Defaults()
		if st.Override != nil {
			f = *st.Override
		}
		// A message, a picture or a countdown: the editor offers "show again"
		// for any announcement.
		if !hasContent(f) {
			return ValidationError("There is no banner message to show. Write and publish one first.")
		}
		f.Enabled = true
		st.Override = &f
		st.Revision++
		return nil
	})
}

// Reset drops what admins published: the defaults (no banner) show again.
func (s *Store) Reset(ctx context.Context, user string) (State, error) {
	return s.change(ctx, user, func(st *State) error {
		st.Override = nil
		return nil
	})
}

func (s *Store) change(ctx context.Context, user string, apply func(*State) error) (State, error) {
	// the handler authorized the admin (deployment settings: update)
	//nolint:gocritic // writing the one runtime-config entry the banner keeps
	sys := dbauthz.AsSystemRestricted(ctx)
	var out State
	err := s.db.InTx(func(tx database.Store) error {
		if err := tx.AcquireLock(sys, lockID); err != nil {
			return xerrors.Errorf("lock the banner: %w", err)
		}
		st, err := load(sys, tx)
		if err != nil {
			return err
		}
		if err := apply(&st); err != nil {
			return err
		}
		at := s.now().UTC().Format("2006-01-02T15:04:05Z")
		st.UpdatedBy, st.UpdatedAt = &user, &at
		raw, err := json.Marshal(st)
		if err != nil {
			return err
		}
		if err := tx.UpsertRuntimeConfig(sys, database.UpsertRuntimeConfigParams{Key: stateKey, Value: string(raw)}); err != nil {
			return xerrors.Errorf("save the banner: %w", err)
		}
		out = st
		return nil
	}, nil)
	if err != nil {
		return State{}, err
	}
	// every replica (this one too) pushes it to its open tabs
	_ = s.ps.Publish(ChangedChannel, []byte(out.Banner().ID))
	return out, nil
}
