package coderd

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"
	"github.com/coder/coder/v2/coderd/apikey"
	"github.com/coder/coder/v2/coderd/audit"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/database/dbtime"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/notifications/dispatch"
	"github.com/coder/coder/v2/codersdk"
)

const (
	emailLoginPrefix = "email-login:v1:"
	emailLoginTTL    = 10 * time.Minute
)

func emailLoginDigest(user database.User, token string) string {
	d := sha256.Sum256([]byte(user.ID.String() + "\x00" + strings.ToLower(user.Email) + "\x00" + token))
	return emailLoginPrefix + hex.EncodeToString(d[:])
}

func (api *API) emailLoginAvailable() bool {
	cfg := api.DeploymentValues
	smtp := cfg.Notifications.SMTP
	host, port, err := net.SplitHostPort(smtp.Smarthost.String())
	if !cfg.EmailLoginEnabled.Value() || err != nil || smtp.From.String() == "" {
		return false
	}
	return net.ParseIP(host).IsLoopback() || (!smtp.TLS.InsecureSkipVerify.Value() && (smtp.ForceTLS.Value() || smtp.TLS.StartTLS.Value() || port == "465"))
}

func emailLoginUser(user database.User, email string) bool {
	return !user.Deleted && !user.IsServiceAccount && user.Status == database.UserStatusActive && user.LoginType != database.LoginTypeNone && strings.EqualFold(user.Email, email)
}

// @Summary Request an email sign-in token
// @ID request-email-login
// @Tags Authentication
// @Param request body codersdk.RequestOneTimePasscodeRequest true "Registered email address"
// @Success 204
// @Router /users/login/email/request [post]
func (api *API) requestEmailLogin(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !api.emailLoginAvailable() {
		httpapi.Write(ctx, rw, http.StatusForbidden, codersdk.Response{Message: "Email sign-in is unavailable."})
		return
	}
	var req codersdk.RequestOneTimePasscodeRequest
	if !httpapi.Read(ctx, rw, r, &req) {
		return
	}
	// Return the same response before contacting SMTP, including for unknown addresses.
	email := strings.TrimSpace(req.Email)
	//nolint:gocritic // Account lookup and recovery credentials precede authentication.
	sys := dbauthz.AsSystemRestricted(ctx)
	token := uuid.NewString()
	var recipient string
	err := api.Database.InTx(func(tx database.Store) error {
		recipient = ""
		user, err := tx.GetUserByEmailOrUsername(sys, database.GetUserByEmailOrUsernameParams{Email: email})
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if !emailLoginUser(user, email) {
			return nil
		}
		now := dbtime.Now()
		if strings.HasPrefix(string(user.HashedEmailLoginToken), emailLoginPrefix) && user.EmailLoginExpiresAt.Time.After(now.Add(emailLoginTTL-time.Minute)) {
			return nil
		}
		recipient = user.Email
		return tx.SetUserEmailLoginToken(sys, database.SetUserEmailLoginTokenParams{ID: user.ID, HashedEmailLoginToken: []byte(emailLoginDigest(user, token)), EmailLoginExpiresAt: sql.NullTime{Time: now.Add(emailLoginTTL), Valid: true}})
	}, &database.TxOptions{Isolation: sql.LevelSerializable})
	rw.WriteHeader(http.StatusNoContent)
	if f, ok := rw.(http.Flusher); ok {
		f.Flush()
	}
	if err != nil {
		api.Logger.Error(ctx, "record email login challenge", slog.Error(err))
		return
	}
	if recipient == "" {
		return
	}
	sendCtx, cancel := context.WithTimeout(api.ctx, 20*time.Second)
	defer cancel()
	if err := dispatch.NewSMTPHandler(api.DeploymentValues.Notifications.SMTP, api.Logger).SendLoginToken(sendCtx, recipient, token); err != nil {
		api.Logger.Error(sendCtx, "deliver email login challenge", slog.Error(err))
	}
}

// @Summary Sign in with a single-use email token
// @ID verify-email-login
// @Tags Authentication
// @Param request body emailLoginVerification true "Email address and token"
// @Success 204
// @Router /users/login/email/verify [post]
func (api *API) verifyEmailLogin(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !api.emailLoginAvailable() {
		httpapi.Write(ctx, rw, http.StatusForbidden, codersdk.Response{Message: "Email sign-in is unavailable."})
		return
	}
	var req emailLoginVerification
	if !httpapi.Read(ctx, rw, r, &req) {
		return
	}
	aReq, commit := audit.InitRequest[database.APIKey](rw, &audit.RequestParams{Audit: *api.Auditor.Load(), Log: api.Logger, Request: r, Action: database.AuditActionLogin, AdditionalFields: map[string]string{"login_type": "email_token"}, AllowUnknownUser: true})
	defer commit()
	//nolint:gocritic // A valid mailbox challenge authorizes one local session.
	sys := dbauthz.AsSystemRestricted(ctx)
	invalid := xerrors.New("invalid email token")
	var cookie *http.Cookie
	var key *database.APIKey
	err := api.Database.InTx(func(tx database.Store) error {
		email := strings.TrimSpace(req.Email)
		user, err := tx.GetUserByEmailOrUsername(sys, database.GetUserByEmailOrUsernameParams{Email: email})
		if errors.Is(err, sql.ErrNoRows) {
			return invalid
		}
		if err != nil {
			return err
		}
		aReq.UserID = user.ID
		if !emailLoginUser(user, email) || !user.EmailLoginExpiresAt.Valid || !user.EmailLoginExpiresAt.Time.After(dbtime.Now()) || subtle.ConstantTimeCompare(user.HashedEmailLoginToken, []byte(emailLoginDigest(user, strings.TrimSpace(req.Token)))) != 1 {
			return invalid
		}
		used, err := tx.ConsumeUserEmailLoginToken(sys, database.ConsumeUserEmailLoginTokenParams{ID: user.ID, HashedEmailLoginToken: user.HashedEmailLoginToken})
		if err != nil {
			return err
		}
		if used != 1 {
			return invalid
		}
		cookie, key, err = api.createAPIKeyWithStore(sys, tx, apikey.CreateParams{UserID: user.ID, LoginType: database.LoginTypePassword, RemoteAddr: r.RemoteAddr, DefaultLifetime: api.DeploymentValues.Sessions.DefaultDuration.Value()})
		return err
	}, &database.TxOptions{Isolation: sql.LevelSerializable})
	if errors.Is(err, invalid) {
		httpapi.Write(ctx, rw, http.StatusUnauthorized, codersdk.Response{Message: "Invalid or expired email sign-in token."})
		return
	}
	if err != nil {
		api.Logger.Error(ctx, "redeem email login challenge", slog.Error(err))
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{Message: "Email sign-in could not be completed."})
		return
	}
	aReq.New = *key
	http.SetCookie(rw, cookie)
	rw.WriteHeader(http.StatusNoContent)
}

type emailLoginVerification struct {
	Email string `json:"email" validate:"required,email,max=320"`
	Token string `json:"token" validate:"required,max=128"`
}
