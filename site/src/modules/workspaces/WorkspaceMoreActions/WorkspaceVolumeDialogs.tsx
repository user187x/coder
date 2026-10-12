import { cn } from "cn";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CloudUploadIcon,
	DownloadIcon,
	HardDriveIcon,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { getErrorMessage } from "#/api/errors";
import type { Workspace } from "#/api/typesGenerated";
import {
	type VolumeOp,
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
import { Loader } from "#/components/Loader/Loader";
import { Spinner } from "#/components/Spinner/Spinner";
import { createDayString } from "#/utils/createDayString";

const size = (bytes: number | null) => {
	if (!bytes) {
		return "";
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
	let n = bytes;
	let i = 0;
	while (n >= 1000 && i < units.length - 1) {
		n /= 1000;
		i++;
	}
	return `${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 1 })} ${units[i]}`;
};

const useVolume = (workspace: Workspace, open: boolean) =>
	useQuery({
		queryKey: workspaceVolumeKey(workspace.id),
		queryFn: () => WorkspaceExtrasAPI.volume(workspace.id),
		enabled: open,
		refetchInterval: (q) => (q.state.data?.busy ? 2000 : false),
	});

const OpStatus: React.FC<{ op: VolumeOp }> = ({ op }) => (
	<span
		className={cn(
			"flex items-center gap-1.5 text-sm",
			op.status === "failed" && "text-content-destructive",
		)}
	>
		{op.status === "running" ? (
			<Spinner loading size="sm" />
		) : op.status === "done" ? (
			<CircleCheckIcon className="size-4 shrink-0 text-content-success" />
		) : (
			<CircleAlertIcon className="size-4 shrink-0" />
		)}
		<span className="min-w-0 break-words">
			{op.status === "failed" ? op.error : op.message}
			{op.bytes ? ` · ${size(op.bytes)}` : ""}
		</span>
	</span>
);

type DialogProps = { workspace: Workspace; open: boolean; onClose: () => void };

/**
 * ⋮ › Back up home: the workspace's home volume as a .tar.gz, to S3 (Images ›
 * Settings) or to a file to download. The copy is taken while the workspace
 * runs; files being written at that moment may be caught half-way.
 */
export const BackupHomeDialog: React.FC<DialogProps> = ({
	workspace,
	open,
	onClose,
}) => {
	const queryClient = useQueryClient();
	const query = useVolume(workspace, open);
	const [target, setTarget] = useState<"download" | "s3">("download");
	const start = useMutation({
		mutationFn: () => WorkspaceExtrasAPI.backup(workspace.id, target),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: workspaceVolumeKey(workspace.id),
			}),
	});
	const data = query.data;
	const latest = data?.backups[0];

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Back up the home volume</DialogTitle>
					<DialogDescription>
						Everything in /home/coder of {workspace.name}, as a .tar.gz. It is
						copied while the workspace runs, so stop it first if files are being
						written.
					</DialogDescription>
				</DialogHeader>
				{query.error ? (
					<p role="alert" className="m-0 text-sm text-content-destructive">
						{getErrorMessage(query.error, "The volume could not be read.")}
					</p>
				) : !data ? (
					<Loader />
				) : !data.volume ? (
					<p className="m-0 text-sm text-content-secondary">
						This workspace has no home volume.
					</p>
				) : (
					<div
						className="flex min-w-0 flex-col gap-4"
						data-testid="backup-dialog"
					>
						<p className="m-0 flex items-center gap-2 text-sm text-content-secondary">
							<HardDriveIcon className="size-4" />
							{data.volume.name} · {data.volume.sizeGB} GB ·{" "}
							{data.volume.storageClass || "default storage"}
						</p>
						<div
							role="radiogroup"
							aria-label="Where to"
							className="grid gap-2 sm:grid-cols-2"
						>
							{(
								[
									[
										"download",
										DownloadIcon,
										"Download",
										`A file to download here, kept ${data.keepHours} hours`,
									],
									[
										"s3",
										CloudUploadIcon,
										"S3",
										data.s3
											? "The S3 bucket of Images › Settings"
											: "Not set up (Templates › Images › Settings)",
									],
								] as const
							).map(([value, Icon, title, detail]) => (
								<button
									key={value}
									type="button"
									role="radio"
									aria-checked={target === value}
									disabled={value === "s3" && !data.s3}
									onClick={() => setTarget(value)}
									className={cn(
										"flex cursor-pointer items-start gap-2 rounded-md border border-solid p-3 text-left text-inherit disabled:cursor-not-allowed disabled:opacity-50",
										target === value
											? "border-content-link bg-surface-secondary"
											: "border-border bg-transparent",
									)}
								>
									<Icon className="mt-0.5 size-4 shrink-0" />
									<span className="flex min-w-0 flex-col">
										<span className="text-sm font-semibold">{title}</span>
										<span className="text-xs text-content-secondary">
											{detail}
										</span>
									</span>
								</button>
							))}
						</div>
						{data.backups.length > 0 && (
							<div className="flex flex-col gap-2">
								<span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
									Recent backups
								</span>
								<ul className="m-0 flex list-none flex-col divide-y divide-border rounded-md border border-solid border-border p-0">
									{data.backups.map((b) => (
										<li
											key={b.id}
											className="flex flex-wrap items-center gap-2 px-3 py-2"
										>
											<span className="w-24 shrink-0 text-xs text-content-secondary">
												{createDayString(b.created_at)}
											</span>
											<span className="min-w-0 flex-1">
												<OpStatus op={b} />
												{b.target === "s3" && b.key && (
													<span className="block break-all font-mono text-xs text-content-secondary">
														s3://{b.bucket}/{b.key}
													</span>
												)}
											</span>
											{b.downloadable && (
												<Button asChild size="sm" variant="outline">
													<a
														href={WorkspaceExtrasAPI.downloadUrl(
															workspace.id,
															b.id,
														)}
														download
													>
														<DownloadIcon />
														Download
													</a>
												</Button>
											)}
										</li>
									))}
								</ul>
							</div>
						)}
						{start.error ? (
							<p role="alert" className="m-0 text-sm text-content-destructive">
								{getErrorMessage(start.error, "The backup could not start.")}
							</p>
						) : null}
					</div>
				)}
				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
					<Button
						onClick={() => start.mutate()}
						disabled={!data?.volume || data.busy || start.isPending}
						data-testid="backup-start"
					>
						<Spinner
							loading={
								start.isPending ||
								Boolean(data?.busy && latest?.status === "running")
							}
						/>
						{data?.busy ? "Working…" : "Back up now"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/**
 * ⋮ › Expand disk: a bigger home volume. Where the storage class grows volumes
 * (EBS on EKS), in place, restarting the workspace only if its file system
 * needs it; elsewhere the workspace is stopped, its home copied onto a bigger
 * volume, and started again.
 */
export const ExpandDiskDialog: React.FC<DialogProps> = ({
	workspace,
	open,
	onClose,
}) => {
	const queryClient = useQueryClient();
	const query = useVolume(workspace, open);
	const data = query.data;
	const current = data?.volume?.sizeGB ?? 0;
	const [value, setValue] = useState("");
	const want = Number(value);
	const valid =
		Number.isInteger(want) && want > current && want <= (data?.maxGB ?? 2000);
	const expand = useMutation({
		mutationFn: () => WorkspaceExtrasAPI.expand(workspace.id, want),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: workspaceVolumeKey(workspace.id),
			}),
	});
	const last = data?.disk[0];
	const copy = data?.volume && !data.volume.expandable;

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Expand the home disk</DialogTitle>
					<DialogDescription>
						More room in /home/coder of {workspace.name}. Disks only grow.
					</DialogDescription>
				</DialogHeader>
				{query.error ? (
					<p role="alert" className="m-0 text-sm text-content-destructive">
						{getErrorMessage(query.error, "The volume could not be read.")}
					</p>
				) : !data ? (
					<Loader />
				) : !data.volume ? (
					<p className="m-0 text-sm text-content-secondary">
						This workspace has no home volume.
					</p>
				) : (
					<form
						className="flex min-w-0 flex-col gap-4"
						data-testid="expand-dialog"
						onSubmit={(e) => {
							e.preventDefault();
							if (valid) {
								expand.mutate();
							}
						}}
					>
						<p className="m-0 text-sm">
							Now <strong>{current} GB</strong> (
							{data.volume.storageClass || "default storage"}).
						</p>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="disk-size">New size (GB)</Label>
							<Input
								id="disk-size"
								type="number"
								min={Math.floor(current) + 1}
								max={data.maxGB}
								value={value}
								placeholder={String(Math.ceil(current * 2))}
								onChange={(e) => setValue(e.target.value)}
								className="w-40"
							/>
						</div>
						<p
							className={cn(
								"m-0 rounded-md border border-solid p-3 text-sm",
								copy && data.running
									? "border-border-warning bg-surface-orange text-highlight-orange"
									: "border-border bg-surface-secondary text-content-secondary",
							)}
						>
							{copy
								? `${data.volume.storageClass || "This storage class"} cannot grow volumes, so the home is copied onto a bigger one.${data.running ? " The workspace is stopped while it is copied, then started again: save your work first." : ""}`
								: "The volume grows in place. If its file system needs it, the workspace restarts once."}
						</p>
						{last && (
							<div className="flex flex-col gap-1">
								<span className="text-xs text-content-secondary">
									{last.status === "running"
										? "Now"
										: `Last change, ${createDayString(last.created_at)}`}
									: {last.fromGB} → {last.toGB} GB
								</span>
								<OpStatus op={last} />
							</div>
						)}
						{expand.error ? (
							<p role="alert" className="m-0 text-sm text-content-destructive">
								{getErrorMessage(
									expand.error,
									"The disk could not be expanded.",
								)}
							</p>
						) : null}
						<DialogFooter className="gap-2">
							<Button type="button" variant="outline" onClick={onClose}>
								Close
							</Button>
							<Button
								type="submit"
								disabled={!valid || data.busy || expand.isPending}
								data-testid="expand-start"
							>
								<Spinner loading={expand.isPending || data.busy} />
								{data.busy
									? "Working…"
									: copy && data.running
										? `Stop, expand to ${valid ? want : "…"} GB, start`
										: `Expand to ${valid ? want : "…"} GB`}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
};
