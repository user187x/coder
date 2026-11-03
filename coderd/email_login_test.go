package coderd_test

import (
	"io"
	"mime/quotedprintable"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/notifications/dispatch/smtptest"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
	"github.com/coder/serpent"
)

func TestEmailLogin(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	mail := smtptest.NewBackend(smtptest.Config{})
	server, listen, err := smtptest.CreateMockSMTPServer(mail, false)
	require.NoError(t, err)
	var wg sync.WaitGroup
	wg.Go(func() { _ = server.Serve(listen) })
	t.Cleanup(func() { _ = server.Close(); wg.Wait() })
	cfg := coderdtest.DeploymentValues(t)
	cfg.EmailLoginEnabled = true
	cfg.Notifications.SMTP.Smarthost = serpent.String(listen.Addr().String())
	cfg.Notifications.SMTP.From = "coder@example.com"
	cfg.Notifications.SMTP.TLS.StartTLS = false
	client := coderdtest.New(t, &coderdtest.Options{DeploymentValues: cfg})
	coderdtest.CreateFirstUser(t, client)
	guest := codersdk.New(client.URL)
	email := coderdtest.FirstUserParams.Email
	post := func(path string, body map[string]string) (int, []*http.Cookie) {
		res, err := guest.Request(ctx, http.MethodPost, "/api/v2/users/login/email/"+path, body)
		require.NoError(t, err)
		defer res.Body.Close()
		_, err = io.Copy(io.Discard, res.Body)
		require.NoError(t, err)
		return res.StatusCode, res.Cookies()
	}
	status, _ := post("request", map[string]string{"email": "unknown@example.com"})
	require.Equal(t, http.StatusNoContent, status)
	status, _ = post("request", map[string]string{"email": email})
	require.Equal(t, http.StatusNoContent, status)
	require.Eventually(t, func() bool { return mail.LastMessage() != nil }, testutil.WaitLong, testutil.IntervalFast)
	msg := mail.LastMessage()
	require.Equal(t, []string{email}, msg.To)
	decoded, err := io.ReadAll(quotedprintable.NewReader(strings.NewReader(msg.Contents)))
	require.NoError(t, err)
	match := regexp.MustCompile(`ten minutes: ([0-9a-f-]{36})`).FindStringSubmatch(string(decoded))
	require.Len(t, match, 2)
	token := match[1]
	status, _ = post("verify", map[string]string{"email": email, "token": "invalid"})
	require.Equal(t, http.StatusUnauthorized, status)
	status, cookies := post("verify", map[string]string{"email": email, "token": token})
	require.Equal(t, http.StatusNoContent, status)
	var session *http.Cookie
	for _, cookie := range cookies {
		if cookie.Name == codersdk.SessionTokenCookie {
			session = cookie
		}
	}
	require.NotNil(t, session)
	require.True(t, session.HttpOnly)
	guest.SetSessionToken(session.Value)
	me, err := guest.User(ctx, codersdk.Me)
	require.NoError(t, err)
	require.Equal(t, email, me.Email)
	status, _ = post("verify", map[string]string{"email": email, "token": token})
	require.Equal(t, http.StatusUnauthorized, status)
}
