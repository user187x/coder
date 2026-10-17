package coderd

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/sqlc-dev/pqtype"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"cdr.dev/slog/v3"
	"cdr.dev/slog/v3/sloggers/slogtest"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbmock"
	"github.com/coder/coder/v2/coderd/database/dbtime"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/coderd/workspaceapps/appurl"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/codersdk/agentsdk"
	"github.com/coder/coder/v2/codersdk/workspacesdk"
	"github.com/coder/coder/v2/codersdk/workspacesdk/agentconnmock"
	"github.com/coder/coder/v2/codersdk/wsjson"
	"github.com/coder/coder/v2/tailnet"
	"github.com/coder/coder/v2/tailnet/tailnettest"
	"github.com/coder/coder/v2/testutil"
	"github.com/coder/quartz"
	"github.com/coder/websocket"
)

type fakeAgentProvider struct {
	agentConn func(ctx context.Context, agentID uuid.UUID) (_ workspacesdk.AgentConn, release func(), _ error)
}

func (fakeAgentProvider) ReverseProxy(targetURL, dashboardURL *url.URL, agentID uuid.UUID, app appurl.ApplicationURL, wildcardHost string) *httputil.ReverseProxy {
	panic("unimplemented")
}

func (f fakeAgentProvider) AgentConn(ctx context.Context, agentID uuid.UUID) (_ workspacesdk.AgentConn, release func(), _ error) {
	if f.agentConn != nil {
		return f.agentConn(ctx, agentID)
	}

	panic("unimplemented")
}

func (fakeAgentProvider) ServeHTTPDebug(w http.ResponseWriter, r *http.Request) {
	panic("unimplemented")
}

func (fakeAgentProvider) Close() error {
	return nil
}

type channelCloser struct {
	closeFn func()
}

func (c *channelCloser) Close() error {
	c.closeFn()
	return nil
}

// mockAuthorizer is a permissive rbac.Authorizer used by the mock-based
// handler tests in this file. Authorization behavior is tested
// separately in coderd/exp_chats_test.go against a real coderdtest
// server.
type mockAuthorizer struct{}

func (*mockAuthorizer) Authorize(context.Context, rbac.Subject, policy.Action, rbac.Object) error {
	return nil
}

func (*mockAuthorizer) Prepare(context.Context, rbac.Subject, policy.Action, string) (rbac.PreparedAuthorized, error) {
	//nolint:nilnil
	return nil, nil
}

var _ rbac.Authorizer = (*mockAuthorizer)(nil)

func TestWatchAgentContainers(t *testing.T) {
	t.Parallel()

	t.Run("CoderdWebSocketCanHandleClientClosing", func(t *testing.T) {
		t.Parallel()

		// This test ensures that the agent containers `/watch` websocket can gracefully
		// handle the client websocket closing. This test was created in
		// response to this issue: https://github.com/coder/coder/issues/19449

		var (
			ctx    = testutil.Context(t, testutil.WaitShort)
			logger = slogtest.Make(t, &slogtest.Options{IgnoreErrors: true}).Leveled(slog.LevelDebug).Named("coderd")
			mClock = quartz.NewMock(t)

			mCtrl        = gomock.NewController(t)
			mDB          = dbmock.NewMockStore(mCtrl)
			mCoordinator = tailnettest.NewMockCoordinator(mCtrl)
			mAgentConn   = agentconnmock.NewMockAgentConn(mCtrl)

			fAgentProvider = fakeAgentProvider{
				agentConn: func(ctx context.Context, agentID uuid.UUID) (_ workspacesdk.AgentConn, release func(), _ error) {
					return mAgentConn, func() {}, nil
				},
			}

			workspaceID = uuid.New()
			agentID     = uuid.New()
			resourceID  = uuid.New()

			containersCh = make(chan codersdk.WorkspaceAgentListContainersResponse)

			r = chi.NewMux()

			api = API{
				ctx: ctx,
				Options: &Options{
					AgentInactiveDisconnectTimeout: testutil.WaitShort,
					Database:                       mDB,
					Logger:                         logger,
					Clock:                          mClock,
					DeploymentValues:               &codersdk.DeploymentValues{},
					TailnetCoordinator:             tailnettest.NewFakeCoordinator(),
				},
				wsWatcher: httpapi.NewWSWatcher(mClock, nil),
			}
		)

		trap := mClock.Trap().NewTicker("WSWatcher")

		defer trap.Close()

		var tailnetCoordinator tailnet.Coordinator = mCoordinator
		api.TailnetCoordinator.Store(&tailnetCoordinator)
		api.agentProvider = fAgentProvider

		// Setup: Allow `ExtractWorkspaceAgentParams` to complete.
		mDB.EXPECT().GetWorkspaceAgentAndWorkspaceByID(gomock.Any(), agentID).Return(database.GetWorkspaceAgentAndWorkspaceByIDRow{
			WorkspaceAgent: database.WorkspaceAgent{
				ID:               agentID,
				ResourceID:       resourceID,
				LifecycleState:   database.WorkspaceAgentLifecycleStateReady,
				FirstConnectedAt: sql.NullTime{Valid: true, Time: dbtime.Now()},
				LastConnectedAt:  sql.NullTime{Valid: true, Time: dbtime.Now()},
			},
			WorkspaceTable: database.WorkspaceTable{
				ID: workspaceID,
			},
		}, nil)

		// And: Allow `db2dsk.WorkspaceAgent` to complete.
		mCoordinator.EXPECT().Node(gomock.Any()).Return(nil)

		// And: Allow `WatchContainers` to be called, returing our `containersCh` channel.
		mAgentConn.EXPECT().WatchContainers(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, _ slog.Logger) (<-chan codersdk.WorkspaceAgentListContainersResponse, io.Closer, error) {
				return containersCh, &channelCloser{closeFn: func() {
					close(containersCh)
				}}, nil
			})

		// And: We mount the HTTP Handler
		r.With(httpmw.ExtractWorkspaceAgentAndWorkspaceParam(mDB)).
			Get("/workspaceagents/{workspaceagent}/containers/watch", api.watchWorkspaceAgentContainers)

		// Given: We create the HTTP server
		srv := httptest.NewServer(r)
		defer srv.Close()

		// And: Dial the WebSocket
		wsURL := strings.Replace(srv.URL, "http://", "ws://", 1)
		conn, resp, err := websocket.Dial(ctx, fmt.Sprintf("%s/workspaceagents/%s/containers/watch", wsURL, agentID), nil)
		require.NoError(t, err)
		if resp.Body != nil {
			defer resp.Body.Close()
		}

		trap.MustWait(ctx).MustRelease(ctx)

		// And: Create a streaming decoder
		decoder := wsjson.NewDecoder[codersdk.WorkspaceAgentListContainersResponse](conn, websocket.MessageText, logger)
		defer decoder.Close()
		decodeCh := decoder.Chan()

		// And: We can successfully send through the channel.
		testutil.RequireSend(ctx, t, containersCh, codersdk.WorkspaceAgentListContainersResponse{
			Containers: []codersdk.WorkspaceAgentContainer{{
				ID: "test-container-id",
			}},
		})

		// And: Receive the data.
		containerResp := testutil.RequireReceive(ctx, t, decodeCh)
		require.Len(t, containerResp.Containers, 1)
		require.Equal(t, "test-container-id", containerResp.Containers[0].ID)

		// When: We close the WebSocket
		conn.Close(websocket.StatusNormalClosure, "test closing connection")
		mClock.Advance(httpapi.HeartbeatInterval).MustWait(ctx)

		// Then: We expect `containersCh` to be closed.
		select {
		case <-ctx.Done():
			t.Fail()

		case _, ok := <-containersCh:
			require.False(t, ok, "channel is expected to be closed")
		}
	})

	t.Run("CoderdWebSocketCanHandleAgentClosing", func(t *testing.T) {
		t.Parallel()

		// This test ensures that the agent containers `/watch` websocket can gracefully
		// handle the underlying websocket unexpectedly closing. This test was created in
		// response to this issue: https://github.com/coder/coder/issues/19372

		var (
			ctx    = testutil.Context(t, testutil.WaitShort)
			logger = slogtest.Make(t, &slogtest.Options{IgnoreErrors: true}).Leveled(slog.LevelDebug).Named("coderd")

			mCtrl        = gomock.NewController(t)
			mDB          = dbmock.NewMockStore(mCtrl)
			mCoordinator = tailnettest.NewMockCoordinator(mCtrl)
			mAgentConn   = agentconnmock.NewMockAgentConn(mCtrl)

			fAgentProvider = fakeAgentProvider{
				agentConn: func(ctx context.Context, agentID uuid.UUID) (_ workspacesdk.AgentConn, release func(), _ error) {
					return mAgentConn, func() {}, nil
				},
			}

			workspaceID = uuid.New()
			agentID     = uuid.New()
			resourceID  = uuid.New()

			containersCh = make(chan codersdk.WorkspaceAgentListContainersResponse)

			r = chi.NewMux()

			api = API{
				ctx: ctx,
				Options: &Options{
					AgentInactiveDisconnectTimeout: testutil.WaitShort,
					Database:                       mDB,
					Logger:                         logger,
					Clock:                          quartz.NewReal(),
					DeploymentValues:               &codersdk.DeploymentValues{},
					TailnetCoordinator:             tailnettest.NewFakeCoordinator(),
				},
				wsWatcher: httpapi.NewWSWatcher(quartz.NewReal(), nil),
			}
		)

		var tailnetCoordinator tailnet.Coordinator = mCoordinator
		api.TailnetCoordinator.Store(&tailnetCoordinator)
		api.agentProvider = fAgentProvider

		// Setup: Allow `ExtractWorkspaceAgentParams` to complete.
		mDB.EXPECT().GetWorkspaceAgentAndWorkspaceByID(gomock.Any(), agentID).Return(database.GetWorkspaceAgentAndWorkspaceByIDRow{
			WorkspaceAgent: database.WorkspaceAgent{
				ID:               agentID,
				ResourceID:       resourceID,
				LifecycleState:   database.WorkspaceAgentLifecycleStateReady,
				FirstConnectedAt: sql.NullTime{Valid: true, Time: dbtime.Now()},
				LastConnectedAt:  sql.NullTime{Valid: true, Time: dbtime.Now()},
			},
			WorkspaceTable: database.WorkspaceTable{
				ID: workspaceID,
			},
		}, nil)

		// And: Allow `db2dsk.WorkspaceAgent` to complete.
		mCoordinator.EXPECT().Node(gomock.Any()).Return(nil)

		// And: Allow `WatchContainers` to be called, returing our `containersCh` channel.
		mAgentConn.EXPECT().WatchContainers(gomock.Any(), gomock.Any()).
			Return(containersCh, io.NopCloser(&bytes.Buffer{}), nil)

		// And: We mount the HTTP Handler
		r.With(httpmw.ExtractWorkspaceAgentAndWorkspaceParam(mDB)).
			Get("/workspaceagents/{workspaceagent}/containers/watch", api.watchWorkspaceAgentContainers)

		// Given: We create the HTTP server
		srv := httptest.NewServer(r)
		defer srv.Close()

		// And: Dial the WebSocket
		wsURL := strings.Replace(srv.URL, "http://", "ws://", 1)
		conn, resp, err := websocket.Dial(ctx, fmt.Sprintf("%s/workspaceagents/%s/containers/watch", wsURL, agentID), nil)
		require.NoError(t, err)
		if resp.Body != nil {
			defer resp.Body.Close()
		}

		// And: Create a streaming decoder
		decoder := wsjson.NewDecoder[codersdk.WorkspaceAgentListContainersResponse](conn, websocket.MessageText, logger)
		defer decoder.Close()
		decodeCh := decoder.Chan()

		// And: We can successfully send through the channel.
		testutil.RequireSend(ctx, t, containersCh, codersdk.WorkspaceAgentListContainersResponse{
			Containers: []codersdk.WorkspaceAgentContainer{{
				ID: "test-container-id",
			}},
		})

		// And: Receive the data.
		containerResp := testutil.RequireReceive(ctx, t, decodeCh)
		require.Len(t, containerResp.Containers, 1)
		require.Equal(t, "test-container-id", containerResp.Containers[0].ID)

		// When: We close the `containersCh`
		close(containersCh)

		// Then: We expect `decodeCh` to be closed.
		select {
		case <-ctx.Done():
			t.Fail()

		case _, ok := <-decodeCh:
			require.False(t, ok, "channel is expected to be closed")
		}
	})
}

func TestCreateExternalAuthResponse(t *testing.T) {
	t.Parallel()

	// Use a fixed future time.
	expiry := dbtime.Now().Add(8 * time.Hour).UTC()

	assertExpiry := func(t *testing.T, resp agentsdk.ExternalAuthResponse, want time.Time) {
		t.Helper()
		require.Equal(t, want.UTC(), resp.ExpiresAt.UTC(),
			"ExpiresAt should match the expiry passed to createExternalAuthResponse")
	}

	t.Run("WithExpiry", func(t *testing.T) {
		t.Parallel()

		resp, err := createExternalAuthResponse("github", "tok", pqtype.NullRawMessage{}, expiry)
		require.NoError(t, err)
		assertExpiry(t, resp, expiry)
		require.Equal(t, "tok", resp.AccessToken)
	})

	t.Run("ZeroExpiry", func(t *testing.T) {
		t.Parallel()

		// A zero expiry means the token never expires. ExpiresAt should stay zero.
		resp, err := createExternalAuthResponse("github", "tok", pqtype.NullRawMessage{}, time.Time{})
		require.NoError(t, err)
		require.True(t, resp.ExpiresAt.IsZero(), "ExpiresAt should be zero when no expiry is set")
	})

	// Each provider type maps the token into a different Username/Password pair.
	// All of them must also carry ExpiresAt through unchanged.
	providerTests := []struct {
		name         string
		typ          string
		token        string
		wantUsername string
		wantPassword string
	}{
		{
			name:         "GitHub",
			typ:          codersdk.EnhancedExternalAuthProviderGitHub.String(),
			token:        "ghtoken",
			wantUsername: "ghtoken",
			wantPassword: "",
		},
		{
			name:         "GitLab",
			typ:          codersdk.EnhancedExternalAuthProviderGitLab.String(),
			token:        "gltoken",
			wantUsername: "oauth2",
			wantPassword: "gltoken",
		},
		{
			name:         "BitbucketCloud",
			typ:          codersdk.EnhancedExternalAuthProviderBitBucketCloud.String(),
			token:        "bbtoken",
			wantUsername: "x-token-auth",
			wantPassword: "bbtoken",
		},
		{
			name:         "BitbucketServer",
			typ:          codersdk.EnhancedExternalAuthProviderBitBucketServer.String(),
			token:        "bbtoken",
			wantUsername: "x-token-auth",
			wantPassword: "bbtoken",
		},
	}
	for _, tt := range providerTests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			resp, err := createExternalAuthResponse(tt.typ, tt.token, pqtype.NullRawMessage{}, expiry)
			require.NoError(t, err)
			require.Equal(t, tt.wantUsername, resp.Username)
			require.Equal(t, tt.wantPassword, resp.Password)
			require.Equal(t, tt.token, resp.AccessToken)
			assertExpiry(t, resp, expiry)
		})
	}

	t.Run("WithTokenExtra", func(t *testing.T) {
		t.Parallel()

		extra := pqtype.NullRawMessage{
			RawMessage: []byte(`{"user_id":"u_42","scope":"repo"}`),
			Valid:      true,
		}
		resp, err := createExternalAuthResponse("slack", "slacktoken", extra, expiry)
		require.NoError(t, err)
		require.Equal(t, "u_42", resp.TokenExtra["user_id"])
		require.Equal(t, "repo", resp.TokenExtra["scope"])
		assertExpiry(t, resp, expiry)
	})

	t.Run("InvalidExtraJSON", func(t *testing.T) {
		t.Parallel()

		// Malformed JSON in the extra field should produce an error but
		// ExpiresAt should still reflect the expiry that was passed in.
		extra := pqtype.NullRawMessage{
			RawMessage: []byte(`not-valid-json`),
			Valid:      true,
		}
		_, err := createExternalAuthResponse("github", "tok", extra, expiry)
		require.Error(t, err, "malformed extra JSON should produce an error")
	})
}
