package coderd_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/quartz"
	"github.com/stretchr/testify/require"
)

// Only the login clock is advanced; unrelated server tickers use real time.
type passwordLoginTestClock struct {
	quartz.Clock
	now *quartz.Mock
}

func (c passwordLoginTestClock) Now(tags ...string) time.Time { return c.now.Now(tags...) }

func TestPasswordLoginLockout(t *testing.T) {
	t.Parallel()
	clock := quartz.NewMock(t)
	loginClock := passwordLoginTestClock{Clock: quartz.NewReal(), now: clock}
	client, db := coderdtest.NewWithDatabase(t, &coderdtest.Options{Clock: loginClock})
	coderdtest.CreateFirstUser(t, client)
	// A second server sharing the database must observe the same lockout.
	other := coderdtest.New(t, &coderdtest.Options{Clock: loginClock, Database: db})
	ctx := context.Background()
	good := codersdk.LoginWithPasswordRequest{Email: coderdtest.FirstUserParams.Email, Password: coderdtest.FirstUserParams.Password}
	bad := good
	bad.Email = strings.ToUpper(good.Email)
	bad.Password = "incorrect-password"
	login := func(c *codersdk.Client, req codersdk.LoginWithPasswordRequest, status int) {
		t.Helper()
		_, err := c.LoginWithPassword(ctx, req)
		if status == http.StatusCreated {
			require.NoError(t, err)
			return
		}
		var apiErr *codersdk.Error
		require.ErrorAs(t, err, &apiErr)
		require.Equal(t, status, apiErr.StatusCode())
	}
	// A successful login clears previous failures.
	for range 4 {
		login(client, bad, http.StatusUnauthorized)
	}
	login(other, good, http.StatusCreated)
	for range 4 {
		login(client, bad, http.StatusUnauthorized)
	}
	login(other, bad, http.StatusTooManyRequests)
	login(client, good, http.StatusTooManyRequests)
	clock.Advance(9 * time.Minute)
	login(other, bad, http.StatusTooManyRequests)
	login(other, good, http.StatusTooManyRequests)
	// Attempts during the lockout must not extend the original deadline.
	clock.Advance(time.Minute)
	login(other, good, http.StatusCreated)
	login(client, bad, http.StatusUnauthorized)
}
