import type { AdminNote } from "#/api/adminNotes";
import { MockOrganization, MockUserOwner } from "./entities";

export const MockAdminNote: AdminNote = {
	id: "10000000-0000-4000-8000-000000000001",
	organization_id: MockOrganization.id,
	author_id: MockUserOwner.id,
	author_name: MockUserOwner.username,
	text: "Check the storage capacity before the next workspace migration.",
	shared: false,
	revision: 1,
	created_at: "2026-10-30T15:00:00Z",
	updated_at: "2026-10-30T15:00:00Z",
	can_edit: true,
	unread: false,
};

export const MockUnreadAdminNote: AdminNote = {
	...MockAdminNote,
	id: "10000000-0000-4000-8000-000000000002",
	author_name: "another-admin",
	author_id: "10000000-0000-4000-8000-000000000003",
	text: "Shared handover: the cluster is ready for new workspaces.",
	shared: true,
	can_edit: false,
	unread: true,
};
