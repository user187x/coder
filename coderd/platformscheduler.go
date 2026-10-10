package coderd

import (
	"context"
	"net/http"

	"github.com/coder/coder/v2/coderd/httpapi/httperror"
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

type platformScheduleRequest struct {
	Owner             string  `json:"owner"`
	Action            string  `json:"action"`
	AutostartSchedule *string `json:"autostart_schedule"`
	TTLMillis         *int64  `json:"ttl_ms"`
}

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

// checkPlatformSchedule asks the platform scheduler whether a workspace of
// owner may have this schedule (on create, or when its autostart or TTL
// changes). On create it may return the schedule to apply instead. It fails
// open: without the service or an answer, nothing is refused.
func (api *API) checkPlatformSchedule(ctx context.Context, sessionToken, owner, action string, autostart *string, ttlMillis *int64) (*platformScheduleResponse, error) {
	var answer platformScheduleResponse
	if !api.askPlatformService(ctx, "platform_scheduler", sessionToken, "/api/scheduler/check", platformScheduleRequest{
		Owner:             owner,
		Action:            action,
		AutostartSchedule: autostart,
		TTLMillis:         ttlMillis,
	}, &answer) {
		return nil, nil
	}
	if answer.Allowed {
		return &answer, nil
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
