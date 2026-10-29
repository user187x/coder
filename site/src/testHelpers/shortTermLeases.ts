import type { ShortTermLease } from "#/api/typesGenerated";
import {
	MockOrganization,
	MockTemplate,
	MockUserMember,
	MockWorkspace,
} from "./entities";
export const MockBrowserTemplate = {
	...MockTemplate,
	name: "browser",
	organization_id: MockOrganization.id,
};
export const MockShortTermLease: ShortTermLease = {
	user_id: MockUserMember.id,
	organization_id: MockOrganization.id,
	workspace_id: MockWorkspace.id,
	issued_at: "2026-10-29T12:00:00Z",
	expires_at: "2099-10-29T12:15:00Z",
	revoked_at: null,
	extension_requested_at: null,
	token_id: "example",
};
