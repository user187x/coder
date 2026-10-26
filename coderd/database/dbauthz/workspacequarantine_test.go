package dbauthz_test

import (
	"github.com/brianvoe/gofakeit/v7"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbmock"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/testutil"
	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func (s *MethodTestSuite) TestWorkspaceQuarantine() {
	s.Run("TouchWorkspaceQuarantineLock", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		id := uuid.New()
		db.EXPECT().TouchWorkspaceQuarantineLock(gomock.Any(), id).Return(int64(1), nil).AnyTimes()
		check.Args(id).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(int64(1))
	}))

	s.Run("GetWorkspaceQuarantineByWorkspaceID", s.Mocked(func(db *dbmock.MockStore, faker *gofakeit.Faker, check *expects) {
		ws := testutil.Fake(s.T(), faker, database.Workspace{})
		db.EXPECT().GetWorkspaceByID(gomock.Any(), ws.ID).Return(ws, nil).AnyTimes()
		db.EXPECT().GetWorkspaceQuarantineByWorkspaceID(gomock.Any(), ws.ID).Return(database.WorkspaceQuarantine{}, nil).AnyTimes()
		check.Args(ws.ID).Asserts(ws, policy.ActionRead)
	}))
	s.Run("UpsertWorkspaceQuarantine", s.Mocked(func(db *dbmock.MockStore, faker *gofakeit.Faker, check *expects) {
		ws := testutil.Fake(s.T(), faker, database.Workspace{})
		arg := database.UpsertWorkspaceQuarantineParams{WorkspaceID: ws.ID, OrganizationID: ws.OrganizationID}
		db.EXPECT().GetWorkspaceByID(gomock.Any(), ws.ID).Return(ws, nil).AnyTimes()
		db.EXPECT().UpsertWorkspaceQuarantine(gomock.Any(), arg).Return(database.WorkspaceQuarantine{}, nil).AnyTimes()
		check.Args(arg).Asserts(ws, policy.ActionUpdate)
	}))
	s.Run("ConsumeWorkspaceQuarantineManualStart", s.Mocked(func(db *dbmock.MockStore, faker *gofakeit.Faker, check *expects) {
		ws := testutil.Fake(s.T(), faker, database.Workspace{})
		arg := database.ConsumeWorkspaceQuarantineManualStartParams{WorkspaceID: ws.ID, OrganizationID: ws.OrganizationID}
		db.EXPECT().GetWorkspaceByID(gomock.Any(), ws.ID).Return(ws, nil).AnyTimes()
		db.EXPECT().ConsumeWorkspaceQuarantineManualStart(gomock.Any(), arg).Return(nil).AnyTimes()
		check.Args(arg).Asserts(ws, policy.ActionWorkspaceStart)
	}))
	s.Run("PrepareWorkspaceQuarantineRelease", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.PrepareWorkspaceQuarantineReleaseParams{WorkspaceID: uuid.New(), OrganizationID: uuid.New(), Revision: uuid.New()}
		db.EXPECT().PrepareWorkspaceQuarantineRelease(gomock.Any(), arg).Return(int64(1), nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(int64(1))
	}))
}
