package coderd

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/httpapi/httperror"
	"github.com/coder/coder/v2/coderd/workspacescheduler"
	"github.com/coder/coder/v2/codersdk"
)

// The Global Workspace Scheduler (Health > User Quota in the dashboard) is
// kept by the platform service: every workspace must have a start time
// (autostart schedule) and a stop time (TTL), within a maximum, or follow a
// schedule the administrator sets for everyone.

// Actions the platform scheduler is asked about.
const (
	platformScheduleCreate    = "create"
	platformScheduleAutostart = "autostart"
	platformScheduleTTL       = "ttl"
)

type platformScheduleResponse struct {
	Allowed bool   `json:"allowed"`
	Message string `json:"message"`
	// Apply is the schedule to set instead (when the administrator sets it
	// for everyone).
	Apply *struct {
		AutostartSchedule string `json:"autostart_schedule"`
		TTLMillis         int64  `json:"ttl_ms"`
	} `json:"apply"`
}

// checkPlatformSchedule validates edits against the authoritative database policy.
func (api *API) checkPlatformSchedule(ctx context.Context, _ string, owner, action string, autostart *string, ttlMillis *int64) (*platformScheduleResponse, error) {
	p, err := workspacescheduler.Load(ctx, api.Database)
	if err != nil {
		return nil, err
	}
	if !p.Enabled {
		//nolint:nilnil // A nil value means this optional policy or integration is not configured.
		return nil, nil
	}
	//nolint:gocritic // The caller has already authorized the workspace owner.
	user, err := api.Database.GetUserByEmailOrUsername(dbauthz.AsSystemRestricted(ctx), database.GetUserByEmailOrUsernameParams{Username: owner, Email: ""})
	if err != nil {
		return nil, err
	}
	if p.Exempt(user) {
		//nolint:nilnil // A nil value means this optional policy or integration is not configured.
		return nil, nil
	}
	spec := ""
	if autostart != nil {
		spec = *autostart
	}
	var ttl time.Duration
	if ttlMillis != nil {
		ttl = time.Duration(*ttlMillis) * time.Millisecond
	}
	var answer platformScheduleResponse
	if p.Mode == "fixed" && action == platformScheduleCreate {
		required, duration, err := p.FixedSchedule()
		if err != nil {
			return nil, err
		}
		answer.Allowed = true
		answer.Apply = &struct {
			AutostartSchedule string `json:"autostart_schedule"`
			TTLMillis         int64  `json:"ttl_ms"`
		}{required, duration.Milliseconds()}
		return &answer, nil
	}
	// Edits may repair one half at a time; starts always require both.
	if action == platformScheduleAutostart {
		if p.Mode == "fixed" {
			_, ttl, err = p.FixedSchedule()
		} else {
			ttl = time.Minute
		}
	}
	if action == platformScheduleTTL {
		if p.Mode == "fixed" {
			spec, _, err = p.FixedSchedule()
		} else {
			spec = "0 8 * * *"
		}
	}
	if err != nil {
		return nil, err
	}
	answer.Message = p.Problem(spec, ttl)
	if answer.Message == "" {
		return &platformScheduleResponse{Allowed: true}, nil
	}

	message := answer.Message
	if message == "" {
		message = "This workspace schedule is not allowed."
	}
	// The request field the refusal is about.
	field := "autostart_schedule"
	switch action {
	case platformScheduleAutostart:
		field = "schedule"
	case platformScheduleTTL:
		field = "ttl_ms"
	}
	return nil, httperror.NewResponseError(http.StatusForbidden, codersdk.Response{
		Message:     message,
		Detail:      "Global Workspace Scheduler: an administrator sets it in Health > User Quota.",
		Validations: []codersdk.ValidationError{{Field: field, Detail: message}},
	})
}
