import type { ScreenShareSession } from "#/api/screenShare";
import type { Workspace } from "#/api/typesGenerated";
import {
	MockOrganization,
	MockUserMember,
	MockUserOwner,
	MockWorkspace,
	MockWorkspaceAgent,
	MockWorkspaceApp,
	MockWorkspaceResource,
} from "./entities";
export const MockScreenShare: ScreenShareSession = {
	id: "89599c39-9701-4724-bf90-3a64f65f6d91",
	organization_id: MockOrganization.id,
	sharer: MockUserOwner.id,
	viewer: MockUserMember.id,
	sharer_name: MockUserOwner.username,
	viewer_name: MockUserMember.username,
	admin_viewer: false,
	workspace_id: null,
	label: "Workspace desktop",
	status: "requested",
	offer: null,
	answer: null,
	expires_at: "2026-10-30T08:00:00Z",
};

export const MockSupportBrowserWorkspace: Workspace = {
	...MockWorkspace,
	id: "ws-1",
	name: "dev",
	owner_name: "TestUser2",
	latest_build: {
		...MockWorkspace.latest_build,
		status: "running",
		resources: [
			{
				...MockWorkspaceResource,
				agents: [
					{
						...MockWorkspaceAgent,
						status: "connected",
						apps: [
							{
								...MockWorkspaceApp,
								slug: "neko-browser",
								display_name: "Browser",
							},
						],
					},
				],
			},
		],
	},
};
