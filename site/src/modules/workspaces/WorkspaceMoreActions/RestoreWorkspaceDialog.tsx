import { cn } from "cn";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CloudDownloadIcon,
	CopyPlusIcon,
	HardDriveUploadIcon,
	ReplaceIcon,
	UploadIcon,
} from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link } from "react-router";
import { getErrorMessage } from "#/api/errors";
import type { Workspace } from "#/api/typesGenerated";
import {
	type BackupMeta,
	type RestoreMode,
	type RestorePlan,
	WorkspaceExtrasAPI,
	workspaceVolumeKey,
} from "#/api/workspaceVolumes";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";
import { createDayString } from "#/utils/createDayString";
import { useWorkspaceVolume } from "./WorkspaceVolumeDialogs";

/** Coder's workspace names: letters, digits and dashes, up to 32, no dash at either end. */
export const WORKSPACE_NAME_RE =
	/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,30}[a-zA-Z0-9])?$/;

/** A name for the restored workspace: "<name>-restored", cut to fit. */
export const restoredName = (name: string) =>
	`${name.slice(0, 32 - "-restored".length).replace(/-+$/, "")}-restored`;

const size = (bytes: number) => {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let n = bytes;
	let i = 0;
	while (n >= 1000 && i < units.length - 1) {
		n /= 1000;
		i++;
	}
	return `${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 1 })} ${units[i]}`;
};

/** The parameters worth showing of a backup: CPU, memory and disk. */
const resources = (meta: BackupMeta) =>
	meta.parameters
		.filter((p) => /^(cpu|memory)$|disk/i.test(p.name))
		.map((p) => `${p.name} ${p.value}`)
		.join(" · ");

type Source = "file" | "s3";

const Choice: FC<{
	selected: boolean;
	disabled?: boolean;
	onSelect: () => void;
	icon: FC<{ className?: string }>;
	title: string;
	detail: string;
	testId: string;
}> = ({ selected, disabled, onSelect, icon: Icon, title, detail, testId }) => (
	<button
		type="button"
		role="radio"
		aria-checked={selected}
		disabled={disabled}
		onClick={onSelect}
		data-testid={testId}
		className={cn(
			"flex cursor-pointer items-start gap-2 rounded-md border border-solid p-3 text-left text-inherit disabled:cursor-not-allowed disabled:opacity-50",
			selected
				? "border-content-link bg-surface-secondary"
				: "border-border bg-transparent",
		)}
	>
		<Icon className="mt-0.5 size-4 shrink-0" />
		<span className="flex min-w-0 flex-col">
			<span className="text-sm font-semibold">{title}</span>
			<span className="text-xs text-content-secondary">{detail}</span>
		</span>
	</button>
);

/** What the chosen backup holds and the quota's answer, as asked before anything is sent. */
const PlanSummary: FC<{ plan: RestorePlan; workspace: Workspace }> = ({
	plan,
	workspace,
}) => (
	<div className="flex flex-col gap-2" data-testid="restore-plan">
		<p className="m-0 rounded-md border border-solid border-border bg-surface-secondary p-3 text-sm">
			{plan.meta ? (
				<>
					Taken from <strong>{plan.meta.workspace}</strong> (
					{plan.meta.template.displayName}),{" "}
					{createDayString(plan.meta.takenAt)}
					{resources(plan.meta) && (
						<span className="block text-xs text-content-secondary">
							{resources(plan.meta)}
						</span>
					)}
				</>
			) : (
				<>
					A backup from before backups said what they were taken from: a new
					workspace gets {workspace.name}&apos;s template and parameters.
				</>
			)}
		</p>
		<p
			className={cn(
				"m-0 flex items-start gap-1.5 text-sm",
				plan.quota.allowed
					? "text-content-success"
					: "text-content-destructive",
			)}
			data-testid="restore-quota"
			data-allowed={plan.quota.allowed}
		>
			{plan.quota.allowed ? (
				<CircleCheckIcon className="mt-0.5 size-4 shrink-0" />
			) : (
				<CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
			)}
			<span className="min-w-0 break-words">
				{plan.quota.allowed
					? plan.mode === "new"
						? `Within your quota${plan.template ? `: a new ${plan.template.name} workspace` : ""}.`
						: plan.quota.message
					: plan.quota.message}
			</span>
		</p>
	</div>
);

/**
 * ⋮ › Restore workspace: a home backup (a file, or one in S3) restored into a
 * new workspace made as the backup's (its template and parameters), or over
 * this workspace's home. What the backup was taken from is read from its first
 * bytes and the user quota asked before anything is uploaded, downloaded or
 * created.
 */
export const RestoreWorkspaceDialog: FC<{
	workspace: Workspace;
	open: boolean;
	onClose: () => void;
}> = ({ workspace, open, onClose }) => {
	const queryClient = useQueryClient();
	const volume = useWorkspaceVolume(workspace, open);
	const sources = useQuery({
		queryKey: [...workspaceVolumeKey(workspace.id), "restore-sources"],
		queryFn: () => WorkspaceExtrasAPI.restoreSources(workspace.id),
		enabled: open,
	});
	const [source, setSource] = useState<Source>("file");
	const [file, setFile] = useState<File | null>(null);
	const [key, setKey] = useState("");
	const [mode, setMode] = useState<RestoreMode>("new");
	const [name, setName] = useState(restoredName(workspace.name));
	const [nameTouched, setNameTouched] = useState(false);
	const [checkedName, setCheckedName] = useState(name);
	const [progress, setProgress] = useState<number | null>(null);

	// the quota is asked once typing stops
	useEffect(() => {
		const t = setTimeout(() => setCheckedName(name), 400);
		return () => clearTimeout(t);
	}, [name]);

	const chosen = source === "file" ? Boolean(file) : Boolean(key);
	const nameOk = mode === "replace" || WORKSPACE_NAME_RE.test(checkedName);
	const plan = useQuery({
		queryKey: [
			...workspaceVolumeKey(workspace.id),
			"restore-plan",
			source,
			file ? `${file.name}:${file.size}:${file.lastModified}` : key,
			mode,
			mode === "new" ? checkedName : "",
		],
		queryFn: () =>
			source === "file" && file
				? WorkspaceExtrasAPI.inspectFile(workspace.id, file, mode, checkedName)
				: WorkspaceExtrasAPI.inspectS3(workspace.id, key, mode, checkedName),
		enabled: open && chosen && nameOk && name === checkedName,
		retry: false,
	});

	// the backup's own workspace name, once known, unless one was typed
	const metaName = plan.data?.meta?.workspace;
	useEffect(() => {
		if (metaName && !nameTouched) {
			setName(restoredName(metaName));
		}
	}, [metaName, nameTouched]);

	const start = useMutation({
		mutationFn: () => {
			setProgress(source === "file" ? 0 : null);
			return source === "file" && file
				? WorkspaceExtrasAPI.restoreFile(
						workspace.id,
						file,
						mode,
						name,
						setProgress,
					)
				: WorkspaceExtrasAPI.restoreS3(workspace.id, key, mode, name);
		},
		onSettled: () => {
			setProgress(null);
			return queryClient.invalidateQueries({
				queryKey: workspaceVolumeKey(workspace.id),
			});
		},
	});

	const busy = Boolean(volume.data?.busy);
	const last = volume.data?.restores?.[0];
	const s3 = sources.data?.s3;
	const ready =
		chosen &&
		nameOk &&
		plan.data?.quota.allowed === true &&
		!plan.isFetching &&
		!busy &&
		!start.isPending;

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Restore a workspace</DialogTitle>
					<DialogDescription>
						From a home backup (⋮ › Back up home): into a new workspace made as
						the backup&apos;s, or over {workspace.name}&apos;s home. Your quota
						is checked before anything is uploaded or created.
					</DialogDescription>
				</DialogHeader>
				<div
					className="flex min-w-0 flex-col gap-4"
					data-testid="restore-dialog"
				>
					<div
						role="radiogroup"
						aria-label="The backup"
						className="grid gap-2 sm:grid-cols-2"
					>
						<Choice
							selected={source === "file"}
							onSelect={() => setSource("file")}
							icon={UploadIcon}
							title="A backup file"
							detail="A .tar.gz from Back up home › Download"
							testId="restore-source-file"
						/>
						<Choice
							selected={source === "s3"}
							disabled={s3 === null || s3?.length === 0}
							onSelect={() => setSource("s3")}
							icon={CloudDownloadIcon}
							title="S3"
							detail={
								s3 === null
									? "Not set up (Templates › Images › Settings)"
									: s3?.length === 0
										? "No backups of your workspaces there"
										: "A backup of your workspaces in S3"
							}
							testId="restore-source-s3"
						/>
					</div>

					{source === "file" ? (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="restore-file">Backup file</Label>
							<Input
								id="restore-file"
								type="file"
								accept=".gz,.tgz,application/gzip"
								onChange={(e) => setFile(e.target.files?.[0] ?? null)}
								data-testid="restore-file"
							/>
							{file && (
								<span className="text-xs text-content-secondary">
									{file.name} · {size(file.size)}
								</span>
							)}
						</div>
					) : (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="restore-key">Backup</Label>
							<select
								id="restore-key"
								value={key}
								onChange={(e) => setKey(e.target.value)}
								data-testid="restore-key"
								className="h-9 rounded-md border border-solid border-border bg-surface-primary px-2 text-sm text-content-primary"
							>
								<option value="">Choose a backup…</option>
								{s3?.map((b) => (
									<option key={b.key} value={b.key}>
										{b.workspace} · {createDayString(b.modified)} ·{" "}
										{size(b.bytes)}
									</option>
								))}
							</select>
						</div>
					)}

					<div
						role="radiogroup"
						aria-label="Restore into"
						className="grid gap-2 sm:grid-cols-2"
					>
						<Choice
							selected={mode === "new"}
							onSelect={() => setMode("new")}
							icon={CopyPlusIcon}
							title="A new workspace"
							detail="Made as the backup's, then its home restored"
							testId="restore-mode-new"
						/>
						<Choice
							selected={mode === "replace"}
							onSelect={() => setMode("replace")}
							icon={ReplaceIcon}
							title={`Over ${workspace.name}`}
							detail="Its home replaced; stopped and started again"
							testId="restore-mode-replace"
						/>
					</div>

					{mode === "new" ? (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="restore-name">Name</Label>
							<Input
								id="restore-name"
								value={name}
								maxLength={32}
								onChange={(e) => {
									setNameTouched(true);
									setName(e.target.value);
								}}
								className="w-72"
								data-testid="restore-name"
							/>
							{!WORKSPACE_NAME_RE.test(name) && (
								<span className="text-xs text-content-destructive">
									Letters, digits and dashes, up to 32, no dash at either end.
								</span>
							)}
						</div>
					) : (
						<p className="m-0 rounded-md border border-solid border-border-warning bg-surface-orange p-3 text-sm text-highlight-orange">
							Everything now in /home/coder of {workspace.name} is replaced by
							the backup&apos;s. The workspace is stopped while it is restored.
						</p>
					)}

					{plan.isFetching ? (
						<span className="flex items-center gap-2 text-sm text-content-secondary">
							<Spinner loading size="sm" /> Reading the backup and asking your
							quota…
						</span>
					) : plan.error ? (
						<p role="alert" className="m-0 text-sm text-content-destructive">
							{getErrorMessage(plan.error, "The backup could not be read.")}
						</p>
					) : plan.data ? (
						<PlanSummary plan={plan.data} workspace={workspace} />
					) : null}

					{progress !== null && (
						<div className="flex items-center gap-2 text-sm">
							<HardDriveUploadIcon className="size-4" />
							<span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-quaternary">
								<span
									className="absolute inset-y-0 left-0 rounded-full bg-content-link"
									style={{ width: `${Math.round(progress * 100)}%` }}
								/>
							</span>
							<span className="w-10 text-right">
								{Math.round(progress * 100)}%
							</span>
						</div>
					)}

					{last && (
						<div className="flex flex-col gap-1" data-testid="restore-status">
							<span className="text-xs text-content-secondary">
								{last.status === "running"
									? "Now"
									: `Last restore, ${createDayString(last.created_at)}`}
							</span>
							<span
								className={cn(
									"flex items-center gap-1.5 text-sm",
									last.status === "failed" && "text-content-destructive",
								)}
							>
								{last.status === "running" ? (
									<Spinner loading size="sm" />
								) : last.status === "done" ? (
									<CircleCheckIcon className="size-4 shrink-0 text-content-success" />
								) : (
									<CircleAlertIcon className="size-4 shrink-0" />
								)}
								<span className="min-w-0 break-words">
									{last.status === "failed" ? last.error : last.message}
								</span>
							</span>
							{last.status === "done" && last.mode === "new" && last.label && (
								<Link
									to={`/@${last.label}`}
									className="text-sm text-content-link"
								>
									Open {last.label.split("/")[1]}
								</Link>
							)}
						</div>
					)}

					{start.error ? (
						<p role="alert" className="m-0 text-sm text-content-destructive">
							{getErrorMessage(start.error, "The restore could not start.")}
						</p>
					) : null}
				</div>
				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
					<Button
						onClick={() => start.mutate()}
						disabled={!ready}
						data-testid="restore-start"
					>
						<Spinner loading={start.isPending || busy} />
						{busy
							? "Working…"
							: mode === "new"
								? "Create and restore"
								: `Restore over ${workspace.name}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
