package codersdk

// GlobalControlStatus describes the PIN guard for deployment-wide controls.
// Token is returned only after successful PIN verification and expires shortly.
type GlobalControlStatus struct {
	Configured bool   `json:"configured"`
	Token      string `json:"token,omitempty"`
	ExpiresAt  string `json:"expires_at,omitempty"`
}

// GlobalControlPINRequest verifies the deployment control PIN.
type GlobalControlPINRequest struct {
	PIN string `json:"pin"`
}

// ConfigureGlobalControlPINRequest sets or rotates the deployment control PIN.
// Rotating an existing PIN requires its current value or an unlocked session.
type ConfigureGlobalControlPINRequest struct {
	PIN        string `json:"pin"`
	CurrentPIN string `json:"current_pin"`
}
