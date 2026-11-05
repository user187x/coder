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

func (s *MethodTestSuite) TestShortTermLeases() {
	s.Run("GetShortTermLeaseCredential", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.GetShortTermLeaseCredentialParams{}
		db.EXPECT().GetShortTermLeaseCredential(gomock.Any(), arg).Return(database.ShortTermLeaseCredential{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionRead).Returns(database.ShortTermLeaseCredential{})
	}))
	s.Run("GetShortTermLeaseForUpdate", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.GetShortTermLeaseForUpdateParams{}
		db.EXPECT().GetShortTermLeaseForUpdate(gomock.Any(), arg).Return(database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(database.ShortTermLease{})
	}))
	s.Run("ListShortTermLeaseCredentials", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		db.EXPECT().ListShortTermLeaseCredentials(gomock.Any()).Return([]database.ShortTermLeaseCredential{}, nil).AnyTimes()
		check.Args().Asserts(rbac.ResourceSystem, policy.ActionRead).Returns([]database.ShortTermLeaseCredential{})
	}))
	s.Run("UpsertShortTermLeaseCredential", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.UpsertShortTermLeaseCredentialParams{}
		db.EXPECT().UpsertShortTermLeaseCredential(gomock.Any(), arg).Return(nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns()
	}))
	s.Run("BindShortTermLease", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.BindShortTermLeaseParams{}
		db.EXPECT().BindShortTermLease(gomock.Any(), arg).Return(database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(database.ShortTermLease{})
	}))
	s.Run("ConfigureShortTermLease", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.ConfigureShortTermLeaseParams{}
		db.EXPECT().ConfigureShortTermLease(gomock.Any(), arg).Return(database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(database.ShortTermLease{})
	}))
	s.Run("ExtendShortTermLease", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.ExtendShortTermLeaseParams{}
		db.EXPECT().ExtendShortTermLease(gomock.Any(), arg).Return(database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(database.ShortTermLease{})
	}))
	s.Run("GetExpiredShortTermLeases", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		db.EXPECT().GetExpiredShortTermLeases(gomock.Any()).Return([]database.ShortTermLease{}, nil).AnyTimes()
		check.Args().Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns([]database.ShortTermLease{})
	}))
	s.Run("GetShortTermLeaseByUserID", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := uuid.New()
		db.EXPECT().GetShortTermLeaseByUserID(gomock.Any(), arg).Return(database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(database.ShortTermLease{})
	}))
	s.Run("GetShortTermLeaseByWorkspaceID", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := uuid.NullUUID{UUID: uuid.New(), Valid: true}
		db.EXPECT().GetShortTermLeaseByWorkspaceID(gomock.Any(), arg).Return(database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(database.ShortTermLease{})
	}))
	s.Run("GetShortTermLeasesByOrganization", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := uuid.New()
		db.EXPECT().GetShortTermLeasesByOrganization(gomock.Any(), arg).Return([]database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns([]database.ShortTermLease{})
	}))
	s.Run("HideShortTermLease", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.HideShortTermLeaseParams{}
		db.EXPECT().HideShortTermLease(gomock.Any(), arg).Return(database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(database.ShortTermLease{})
	}))
	s.Run("InsertShortTermLease", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.InsertShortTermLeaseParams{}
		db.EXPECT().InsertShortTermLease(gomock.Any(), arg).Return(database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(database.ShortTermLease{})
	}))
	s.Run("RequestShortTermLeaseExtension", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := uuid.New()
		db.EXPECT().RequestShortTermLeaseExtension(gomock.Any(), arg).Return(database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(database.ShortTermLease{})
	}))
	s.Run("RevokeShortTermLease", s.Mocked(func(db *dbmock.MockStore, _ *gofakeit.Faker, check *expects) {
		arg := database.RevokeShortTermLeaseParams{}
		db.EXPECT().RevokeShortTermLease(gomock.Any(), arg).Return(database.ShortTermLease{}, nil).AnyTimes()
		check.Args(arg).Asserts(rbac.ResourceSystem, policy.ActionUpdate).Returns(database.ShortTermLease{})
	}))
}
