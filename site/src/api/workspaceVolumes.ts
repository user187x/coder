/**
 * @file Workspace extras served by the platform service (workspacevolumes.py):
 * a workspace's own icon, backups of its home volume, restoring one, and growing its disk.
 */
import { platformRequest } from "./platform";

const { get, post, upload, base } = platformRequest;
const enc = encodeURIComponent;

export type VolumeOp = {
	id: number;
	kind: "backup" | "disk" | "restore";
	target: "download" | "s3" | "upload" | null;
	status: "running" | "done" | "failed";
	message: string | null;
	error: string | null;
	bytes: number | null;
	bucket: string | null;
	key: string | null;
	/** A disk change (online, copy, vm-block) or a restore (new, replace). */
	mode: "online" | "copy" | "vm-block" | "new" | "replace" | null;
	/** owner/workspace: for a restore, the one restored into. */
	label: string | null;
	by: string | null;
	created_at: string;
	finished_at: string | null;
	fromGB: number | null;
	toGB: number | null;
	downloadable: boolean;
};

export type WorkspaceVolume = {
	volume: {
		name: string;
		sizeGB: number;
		requestedGB: number;
		storageClass: string;
		/** The storage class grows volumes in place (no copy, no stop). */
		expandable: boolean;
		phase: string;
		conditions: string[];
		runtime?: "vm";
		offlineExpansion?: boolean;
	} | null;
	running: boolean;
	busy: boolean;
	backups: VolumeOp[];
	disk: VolumeOp[];
	restores: VolumeOp[];
	s3: boolean;
	keepHours: number;
	maxGB: number;
};

/** What a backup was taken from (its first entry); none in a backup from before. */
export type BackupMeta = {
	version: number;
	workspace: string;
	owner: string;
	template: { id: string; name: string; displayName: string };
	templateVersionId: string;
	parameters: { name: string; value: string }[];
	homeGB: number | null;
	takenAt: string;
};

export type RestoreMode = "new" | "replace";

/** What a restore would do, and the user quota's answer - asked before anything is downloaded or created. */
export type RestorePlan = {
	mode: RestoreMode;
	meta: BackupMeta | null;
	/** Where the template and parameters come from: the backup, or (a backup without them) this workspace. */
	source: "backup" | "this workspace";
	template?: { id: string; name: string };
	quota: { allowed: boolean; message: string };
};

export type S3Backup = {
	key: string;
	workspace: string;
	bytes: number;
	modified: string;
};

/** The first bytes of a backup: enough for what it was taken from. */
export const BACKUP_HEAD_BYTES = 256 * 1024;

const restoreQuery = (mode: RestoreMode, name: string) =>
	`mode=${enc(mode)}&name=${enc(name)}`;

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
	/** The S3 backups of the workspace's owner's workspaces (null: no S3). */
	restoreSources: (workspaceId: string) =>
		get<{ s3: S3Backup[] | null }>(
			`${base}/api/workspace-volumes/${enc(workspaceId)}/restore`,
		),
	inspectS3: (
		workspaceId: string,
		key: string,
		mode: RestoreMode,
		name: string,
	) =>
		post<RestorePlan>(
			`${base}/api/workspace-volumes/${enc(workspaceId)}/restore/inspect`,
			{ key, mode, name },
		),
	/** Only the file's first bytes are sent: the rest waits for the quota's yes. */
	inspectFile: (
		workspaceId: string,
		file: Blob,
		mode: RestoreMode,
		name: string,
	) =>
		upload<RestorePlan>(
			`${base}/api/workspace-volumes/${enc(workspaceId)}/restore/inspect?${restoreQuery(mode, name)}`,
			file.slice(0, BACKUP_HEAD_BYTES),
		),
	restoreS3: (
		workspaceId: string,
		key: string,
		mode: RestoreMode,
		name: string,
	) =>
		post<{ restore: number }>(
			`${base}/api/workspace-volumes/${enc(workspaceId)}/restore`,
			{ key, mode, name },
		),
	restoreFile: (
		workspaceId: string,
		file: Blob,
		mode: RestoreMode,
		name: string,
		onProgress?: (fraction: number) => void,
	) =>
		upload<{ restore: number }>(
			`${base}/api/workspace-volumes/${enc(workspaceId)}/restore?${restoreQuery(mode, name)}`,
			file,
			onProgress,
		),
	expand: (workspaceId: string, size: number) =>
		post<{ disk: number }>(
			`${base}/api/workspace-volumes/${enc(workspaceId)}/expand`,
			{ size },
		),
};

export const workspaceIconsKey = ["platform", "workspace-icons"] as const;
export const workspaceVolumeKey = (id: string) =>
	["platform", "workspace-volumes", id] as const;
