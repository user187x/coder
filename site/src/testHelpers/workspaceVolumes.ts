import type { VolumeOp, WorkspaceVolume } from "#/api/workspaceVolumes";

export const MockWorkspaceVolume = {
	volume: {
		name: "fixture-home",
		sizeGB: 20,
		requestedGB: 20,
		storageClass: "local-path",
		expandable: false,
		phase: "Bound",
		conditions: [],
	},
	running: false,
	busy: false,
	backups: [],
	disk: [],
	restores: [],
	s3: true,
	keepHours: 24,
	maxGB: 2000,
} satisfies WorkspaceVolume;
export const MockVMWorkspaceVolume = {
	...MockWorkspaceVolume,
	volume: {
		...MockWorkspaceVolume.volume,
		runtime: "vm" as const,
		offlineExpansion: true,
	},
} satisfies WorkspaceVolume;
export const MockVMVolumeOperation: VolumeOp = {
	id: 1,
	kind: "disk",
	target: null,
	status: "running",
	message: "Growing the retained VM disk offline",
	error: null,
	bytes: null,
	bucket: null,
	key: null,
	mode: "vm-block",
	label: "admin/fixture",
	by: "admin",
	created_at: "2026-10-24T12:00:00Z",
	finished_at: null,
	fromGB: 20,
	toGB: 40,
	downloadable: false,
};
