import { cn } from "cn";
import {
	DatabaseBackupIcon,
	ShieldAlertIcon,
	ShieldCheckIcon,
	ShieldIcon,
	SnowflakeIcon,
	TrashIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type LockdownMode,
	type LockdownSnapshot,
	PlatformAPI,
	type WorkspaceLockdown,
} from "#/api/platform";
import type { Workspace } from "#/api/typesGenerated";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { SidebarIconButton } from "#/components/FullPageLayout/Sidebar";
import { createDayString } from "#/utils/createDayString";

export const lockdownKey = (workspaceId: string) =>
	["platform", "lockdown", workspaceId] as const;

/** The mode the lock is in: complete is both, freeze is complete and everything paused. */
export const modeOf = (lock: WorkspaceLockdown | undefined): LockdownMode => {
	const m = new Set(lock?.modes ?? []);
	return m.has("freeze")
		? "freeze"
		: m.has("network") && m.has("sudo")
			? "complete"
			: m.has("network")
				? "network"
				: m.has("sudo")
					? "sudo"
					: "off";
};

/** The workspace's network is cut (Network, Complete or Freeze). */
export const networkLocked = (lock: WorkspaceLockdown | undefined) =>
	Boolean(lock?.locked && lock.modes.includes("network"));

export const MODE_LABEL: Record<LockdownMode, string> = {
	network: "Network",
	sudo: "Sudo Command",
	complete: "Complete",
	freeze: "Freeze",
	off: "Off",
};

const MODE_HINT: Record<Exclude<LockdownMode, "off">, string> = {
	network:
		"Cut its network: only Coder stays reachable, so its terminal and apps still open for you",
	sudo: "Take sudo away: nobody in it can become root",
	complete: "Both: no network but Coder, no sudo",
	freeze:
		"Complete, and everything in it paused as it is now (no sessions open); its disk is snapshotted",
};

const MODES = ["network", "sudo", "complete", "freeze"] as const;

const useLockdown = (workspaceId: string, enabled = true) =>
	useQuery({
		queryKey: lockdownKey(workspaceId),
		queryFn: () => PlatformAPI.getLockdown(workspaceId),
		refetchInterval: 15_000,
		retry: false,
		enabled,
	});

/** The workspace's lock, for the rest of its page (the network lights); undefined until known. */
export const useWorkspaceLockdown = (workspaceId: string | undefined) =>
	useLockdown(workspaceId ?? "", Boolean(workspaceId)).data;

const SNAPSHOT_STATUS: Record<
	NonNullable<LockdownSnapshot["status"]>,
	string
> = {
	copying: "being taken",
	ready: "ready",
	failed: "failed",
	gone: "gone",
};

/**
 * Workspace page > left sidebar: admins lock any workspace down - Network,
 * Sudo Command, Complete (both) or Freeze - for instance when an agent in it
 * runs away. A running workspace is locked at once, without a restart: its
 * processes keep running, and its terminal and apps still open (they go through
 * Coder), so admins can look at what it is doing; Freeze instead pauses all of
 * it where it is, and snapshots its disk. A stopped one is locked from its next
 * start, and every lock comes back with each start until an admin lifts it.
 * The shield turns red while a lock is on.
 */
export const LockdownButton: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const queryClient = useQueryClient();
	const query = useLockdown(workspace.id);
	const set = useMutation({
		mutationFn: (mode: LockdownMode) =>
			PlatformAPI.setLockdown(workspace.id, mode),
		onSuccess: (res, mode) => {
			queryClient.setQueryData(lockdownKey(workspace.id), res);
			if (res.error) {
				toast.error(`Lock Down saved, but not in force yet: ${res.error}`);
				return;
			}
			const what =
				mode === "off"
					? "Lock Down lifted"
					: `Locked down (${MODE_LABEL[mode]})`;
			toast.success(
				`${what}: ${res.applied === "now" ? "in force now, in the running workspace." : "from its next start."}`,
			);
		},
		onError: (e) => toast.error(getErrorMessage(e, "Lock Down not changed.")),
	});
	const removeSnapshot = useMutation({
		mutationFn: () => PlatformAPI.deleteLockdownSnapshot(workspace.id),
		onSuccess: (res) => {
			queryClient.setQueryData(lockdownKey(workspace.id), res);
			toast.success("Snapshot deleted.");
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "The snapshot was not deleted.")),
	});
	if (!query.data?.canChange) {
		return null;
	}
	const snapshot = query.data.snapshot;
	const current = modeOf(query.data);
	const locked = current !== "off";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarIconButton
					isActive={false}
					title={
						locked
							? `Locked down: ${MODE_LABEL[current]}`
							: `Lock ${workspace.owner_name}'s workspace down`
					}
					data-testid="workspace-lockdown"
					data-mode={current}
				>
					{locked ? (
						<ShieldAlertIcon className="size-icon-sm text-content-destructive" />
					) : (
						<ShieldIcon className="size-icon-sm" />
					)}
					<span className="sr-only">Lock Down</span>
				</SidebarIconButton>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="right" align="start" className="w-80">
				<DropdownMenuLabel>
					Lock Down {workspace.owner_name}/{workspace.name}
				</DropdownMenuLabel>
				{MODES.map((mode) => (
					<DropdownMenuItem
						key={mode}
						disabled={set.isPending || current === mode}
						onSelect={() => set.mutate(mode)}
						data-testid={`lockdown-${mode}`}
						className="items-start"
					>
						{mode === "freeze" ? (
							<SnowflakeIcon className="mt-0.5 text-content-link" />
						) : (
							<ShieldAlertIcon className="mt-0.5 text-content-destructive" />
						)}
						<span className="flex flex-col">
							<span className="font-medium">
								{MODE_LABEL[mode]}
								{current === mode && " (on)"}
							</span>
							<span className="text-xs text-content-secondary">
								{MODE_HINT[mode]}
							</span>
						</span>
					</DropdownMenuItem>
				))}
				{locked && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={set.isPending}
							onSelect={() => set.mutate("off")}
							data-testid="lockdown-off"
						>
							<ShieldCheckIcon />
							Lift Lock Down
						</DropdownMenuItem>
					</>
				)}
				{snapshot && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel
							className="flex items-start gap-2 font-normal"
							data-testid="lockdown-snapshot"
						>
							<DatabaseBackupIcon className="mt-0.5 size-icon-sm shrink-0" />
							<span className="flex min-w-0 flex-col text-xs">
								<span className="font-medium text-content-primary">
									Snapshot{" "}
									{snapshot.status ? SNAPSHOT_STATUS[snapshot.status] : ""}
								</span>
								<span className="break-all text-content-secondary">
									{snapshot.error ??
										`${snapshot.kind === "VolumeSnapshot" ? "VolumeSnapshot" : "Volume"} ${snapshot.name}, of ${snapshot.claim}`}
								</span>
								<span className="text-content-secondary">
									{createDayString(snapshot.at)}
									{snapshot.processes > 0 &&
										` · ${snapshot.processes} processes paused`}
								</span>
							</span>
						</DropdownMenuLabel>
						<DropdownMenuItem
							disabled={removeSnapshot.isPending}
							onSelect={() => removeSnapshot.mutate()}
							data-testid="lockdown-snapshot-delete"
						>
							<TrashIcon />
							Delete snapshot
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

/**
 * The workspace page's notice while a lock is on, for everyone who can see the
 * workspace (its owner too, who otherwise would not know why the network or
 * sudo stopped working): what is locked, by whom, since when, and whether it
 * is in force in the running workspace. Centred, between two shields.
 */
export const LockdownBanner: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const query = useLockdown(workspace.id);
	const lock = query.data;
	if (!lock?.locked) {
		return null;
	}
	const mode = modeOf(lock);
	const parts = [
		lock.modes.includes("freeze") && "everything paused",
		lock.modes.includes("network") && "no network but Coder",
		lock.modes.includes("sudo") && "no sudo",
	].filter(Boolean);
	const status = !lock.running
		? "From the workspace's next start."
		: lock.inForce
			? "In force in the running workspace."
			: "Being applied to the running workspace…";
	const shield = (
		<ShieldAlertIcon
			className="size-6 shrink-0 text-content-destructive"
			aria-hidden
			data-testid="workspace-lockdown-shield"
		/>
	);
	return (
		<div
			role="alert"
			data-testid="workspace-lockdown-banner"
			data-mode={mode}
			className={cn(
				"flex items-center justify-center gap-4 rounded-lg border border-solid px-4 py-3 text-center text-sm",
				"border-border-destructive bg-surface-destructive/40 text-content-primary",
			)}
		>
			{shield}
			<div className="flex flex-col items-center gap-0.5">
				<span className="font-semibold">
					Locked down: {MODE_LABEL[mode]} ({parts.join(", ")})
				</span>
				<span className="text-content-secondary">
					{lock.by ? `By ${lock.by}` : "By an admin"}
					{lock.at ? ` ${createDayString(lock.at)}` : ""}. {status}{" "}
					{mode === "freeze"
						? "Nothing in it runs and no session opens until an admin lifts it; it stays frozen through restarts."
						: "Its processes keep running; it stays locked through restarts, until an admin lifts it."}
				</span>
			</div>
			{shield}
		</div>
	);
};
