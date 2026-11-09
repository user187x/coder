package dbauthz_test

import (
	"github.com/brianvoe/gofakeit/v7"
	"github.com/google/uuid"
	"go.uber.org/mock/gomock"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbmock"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
)

func (s *MethodTestSuite) TestAuditCollectors() {
	s.Run("GetAuditCollectors", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		org := uuid.New()
		arg := database.GetAuditCollectorsParams{OrganizationID: org, Kind: "metrics"}
		db.EXPECT().GetAuditCollectors(gomock.Any(), arg).Return([]database.AuditCollector{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceDeploymentConfig, policy.ActionUpdate, rbac.ResourceAuditLog.InOrg(org), policy.ActionRead).Returns([]database.AuditCollector{})
	}))
	s.Run("InsertAuditCollector", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.InsertAuditCollectorParams{ID: uuid.New(), OrganizationID: uuid.New()}
		db.EXPECT().InsertAuditCollector(gomock.Any(), arg).Return(database.AuditCollector{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceDeploymentConfig, policy.ActionUpdate, rbac.ResourceAuditLog.InOrg(arg.OrganizationID), policy.ActionRead).Returns(database.AuditCollector{})
	}))
	s.Run("DeleteAuditCollector", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.DeleteAuditCollectorParams{ID: uuid.New(), OrganizationID: uuid.New()}
		db.EXPECT().DeleteAuditCollector(gomock.Any(), arg).Return(database.AuditCollector{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceDeploymentConfig, policy.ActionUpdate, rbac.ResourceAuditLog.InOrg(arg.OrganizationID), policy.ActionRead).Returns(database.AuditCollector{})
	}))
}
