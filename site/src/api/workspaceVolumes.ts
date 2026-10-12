/**
 * @file Workspace extras served by the platform service (workspacevolumes.py):
 * a workspace's own icon, backups of its home volume and growing its disk.
 */
import { platformRequest } from "./platform";

const { get, post, base } = platformRequest;
const enc = encodeURIComponent;

export type VolumeOp = {
	id: number;
	kind: "backup" | "disk";
	target: "download" | "s3" | null;
	status: "running" | "done" | "failed";
	message: string | null;
	error: string | null;
	bytes: number | null;
	bucket: string | null;
	key: string | null;
	mode: "online" | "copy" | null;
	by: string | null;
	created_at: string;
	finished_at: string | null;
	fromGi: number | null;
	toGi: number | null;
	downloadable: boolean;
};

export type WorkspaceVolume = {
	volume: {
		name: string;
		sizeGi: number;
		requestedGi: number;
		storageClass: string;
		/** The storage class grows volumes in place (no copy, no stop). */
		expandable: boolean;
		phase: string;
		conditions: string[];
	} | null;
	running: boolean;
	busy: boolean;
	backups: VolumeOp[];
	disk: VolumeOp[];
	s3: boolean;
	keepHours: number;
	maxGi: number;
};

export const WorkspaceExtrasAPI = {
	icons: () =>
		get<{ icons: Record<string, string> }>(`${base}/api/workspace-icons`),
	setIcon: (workspaceId: string, icon: string) =>
		post<{ icon: string }>(`${base}/api/workspace-icons/${enc(workspaceId)}`, {
			icon,
		}),
	volume: (workspaceId: string) =>
		get<WorkspaceVolume>(`${base}/api/workspace-volumes/${enc(workspaceId)}`),
	backup: (workspaceId: string, target: "download" | "s3") =>
		post<{ backup: number }>(
			`${base}/api/workspace-volumes/${enc(workspaceId)}/backup`,
			{ target },
		),
	downloadUrl: (workspaceId: string, backupId: number) =>
		`${base}/api/workspace-volumes/${enc(workspaceId)}/backups/${backupId}/download`,
	expand: (workspaceId: string, size: number) =>
		post<{ disk: number }>(
			`${base}/api/workspace-volumes/${enc(workspaceId)}/expand`,
			{ size },
		),
};

export const workspaceIconsKey = ["platform", "workspace-icons"] as const;
export const workspaceVolumeKey = (id: string) =>
	["platform", "workspace-volumes", id] as const;
