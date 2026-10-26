import type { WorkspaceNote } from "#/api/platform";
import { MockWorkspace } from "./entities";

export const MockWorkspaceNote: WorkspaceNote = {
	id: "n1",
	workspaceId: MockWorkspace.id,
	text: "Push your branch before Friday",
	color: "yellow",
	x: 0.5,
	y: 0.2,
	tilt: 3,
	author: "admin",
	createdAt: "2026-10-11T00:00:00Z",
	updatedAt: "2026-10-11T00:00:00Z",
	dismissedAt: null,
};
