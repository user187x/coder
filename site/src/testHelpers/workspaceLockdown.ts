import type { WorkspaceLockdown } from "#/api/platform";

export const MockWorkspaceLockdown: WorkspaceLockdown = {
	locked: false,
	modes: [],
	by: null,
	at: null,
	running: true,
	inForce: false,
	canChange: false,
};
