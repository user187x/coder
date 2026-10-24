package codersdk

import (
	"context"
	"encoding/json"
	"net/http"
)

// GlobalLockdownUser describes one account's Coder workspace access.
type GlobalLockdownUser struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	AvatarURL    string `json:"avatar_url"`
	Admin        bool   `json:"admin"`
	Connected    bool   `json:"connected"`
	Disconnected bool   `json:"disconnected"`
}

// GlobalLockdownState reports the deployment's workspace access restriction.
type GlobalLockdownState struct {
	Enabled       bool                  `json:"enabled"`
	Revision      string                `json:"revision"`
	UpdatedBy     string                `json:"updated_by"`
	UpdatedAt     string                `json:"updated_at"`
	Admin         bool                  `json:"admin"`
	Confirmed     bool                  `json:"confirmed"`
	Users         []GlobalLockdownUser  `json:"users,omitempty"`
	AgentsTotal   int                   `json:"agents_total"`
	AgentsPending int                   `json:"agents_pending"`
	Agents        []GlobalLockdownAgent `json:"agents,omitempty"`
}

// GlobalLockdownAgent describes whether an agent has enforced the current policy.
type GlobalLockdownAgent struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	State string `json:"state"`
}

// UpdateGlobalLockdownRequest changes Coder workspace access. Enabling it
// requires Confirmation to contain the literal word "agree".
type UpdateGlobalLockdownRequest struct {
	Enabled      bool   `json:"enabled"`
	Confirmation string `json:"confirmation"`
}

// GlobalLockdown reads the workspace access restriction for this deployment.
func (c *Client) GlobalLockdown(ctx context.Context) (GlobalLockdownState, error) {
	res, err := c.Request(ctx, http.MethodGet, "/api/v2/global-lockdown", nil)
	if err != nil {
		return GlobalLockdownState{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return GlobalLockdownState{}, ReadBodyAsError(res)
	}
	var out GlobalLockdownState
	err = json.NewDecoder(res.Body).Decode(&out)
	return out, err
}

// UpdateGlobalLockdown changes workspace access for all non-owner accounts.
func (c *Client) UpdateGlobalLockdown(ctx context.Context, req UpdateGlobalLockdownRequest) (GlobalLockdownState, error) {
	res, err := c.Request(ctx, http.MethodPost, "/api/v2/global-lockdown", req)
	if err != nil {
		return GlobalLockdownState{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return GlobalLockdownState{}, ReadBodyAsError(res)
	}
	var out GlobalLockdownState
	err = json.NewDecoder(res.Body).Decode(&out)
	return out, err
}
