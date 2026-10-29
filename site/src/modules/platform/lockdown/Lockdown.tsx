import { cn } from "cn";
import {
	DatabaseBackupIcon,
	PlugIcon,
	ShieldAlertIcon,
	ShieldBanIcon,
	ShieldCheckIcon,
	ShieldIcon,
	SnowflakeIcon,
	TrashIcon,
	UnplugIcon,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type LockdownMode,
	type LockdownSnapshot,
	PlatformAPI,
	type WorkspaceLockdown,
} from "#/api/platform";
import { lockdownRootKey } from "#/api/queries/platform";
import type { Workspace } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Dialog, DialogContent, DialogTitle } from "#/components/Dialog/Dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { Spinner } from "#/components/Spinner/Spinner";
import { createDayString } from "#/utils/createDayString";
import { WorkspaceQuarantineControl } from "../quarantine/WorkspaceQuarantine";
import { SandboxControl } from "../sandbox/SandboxControl";
import { SudoLockIcon } from "./SudoLockIcon";

export const lockdownKey = (workspaceId: string) =>
	[...lockdownRootKey, workspaceId] as const;

/** The mode the lock is in: complete is both, freeze is complete and everything paused. */
export const modeOf = (
	lock: Pick<WorkspaceLockdown, "modes"> | undefined,
): LockdownMode => {
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

/** What each lock is called (the toasts, the notice, the badge's title). */
export const MODE_LABEL: Record<LockdownMode, string> = {
	network: "Network Disconnected",
	sudo: "Privilege Escalation Disabled",
	complete: "Locked Down",
	freeze: "Frozen",
	off: "Off",
};

/** The badge's word while a lock is on (short: it sits between a workspace's name and its template). */
const BADGE_LABEL: Record<LockdownMode, string> = {
	network: "Network",
	sudo: "Privilege",
	complete: "Locked",
	freeze: "Frozen",
	off: "Off",
};

/** The lock that cuts the network, takes sudo away, both, or neither. */
const lockFor = (network: boolean, sudo: boolean): LockdownMode =>
	network && sudo ? "complete" : network ? "network" : sudo ? "sudo" : "off";

type MenuItemSpec = {
	key: "network" | "sudo" | "complete" | "freeze";
	/** The item's lock is on now: its words undo it, and it is red (green while off). */
	isOn: (current: LockdownMode) => boolean;
	/** The lock after the item is chosen. */
	next: (current: LockdownMode) => LockdownMode;
	label: { off: string; on: string };
	hint: { off: string; on: string };
	icon: (on: boolean) => React.ReactNode;
};

const cutsNetwork = (m: LockdownMode) =>
	m === "network" || m === "complete" || m === "freeze";
const takesSudo = (m: LockdownMode) =>
	m === "sudo" || m === "complete" || m === "freeze";

/**
 * The menu: each item turns one lock on or off and says which, red while its lock is on (the network disconnected,
 * privilege escalation disabled, the workspace locked down or frozen) and green while it is off. Network and
 * Privilege Escalation go together as Lock Down; while frozen, only Unfreeze.
 */
const MENU: readonly MenuItemSpec[] = [
	{
		key: "network",
		isOn: cutsNetwork,
		next: (m) => lockFor(!cutsNetwork(m), takesSudo(m)),
		label: { off: "Disconnect Network", on: "Reconnect Network" },
		hint: {
			off: "Cut its network: only Coder stays reachable, so its terminal and apps still open for you",
			on: "Give it its network back",
		},
		icon: (on) =>
			on ? (
				<PlugIcon data-testid="lockdown-icon-network" />
			) : (
				<UnplugIcon data-testid="lockdown-icon-network" />
			),
	},
	{
		key: "sudo",
		isOn: takesSudo,
		next: (m) => lockFor(cutsNetwork(m), !takesSudo(m)),
		label: {
			off: "Disable Privilege Escalation",
			on: "Enable Privilege Escalation",
		},
		hint: {
			off: "Take sudo away: nobody in it can become root",
			on: "Let sudo work in it again",
		},
		icon: () => <SudoLockIcon data-testid="lockdown-icon-sudo" />,
	},
	{
		key: "complete",
		isOn: (m) => m === "complete" || m === "freeze",
		next: (m) => (m === "complete" ? "off" : "complete"),
		label: { off: "Lock Down", on: "Unlock" },
		hint: {
			off: "Both: no network but Coder, no privilege escalation",
			on: "Lift the lock: its network and sudo back",
		},
		icon: (on) => (on ? <ShieldCheckIcon /> : <ShieldAlertIcon />),
	},
	{
		key: "freeze",
		isOn: (m) => m === "freeze",
		next: (m) => (m === "freeze" ? "off" : "freeze"),
		label: { off: "Freeze", on: "Unfreeze" },
		hint: {
			off: "Locked down, and everything in it paused as it is now (no sessions open); its disk is snapshotted",
			on: "Resume everything in it and lift the lock",
		},
		icon: () => <SnowflakeIcon />,
	},
];

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

/** The workspaces locked now (admins): {workspace id: its modes}, for the Workspaces list's badges. */
export const locksKey = ["platform", "lockdown", "all"] as const;
export const useAllLockdowns = () =>
	useQuery({
		queryKey: locksKey,
		queryFn: PlatformAPI.getAllLockdowns,
		refetchInterval: 15_000,
		retry: false,
	});

/**
 * The Lock Down badge, for admins: a small shield next to a workspace (in the
 * Workspaces list, between its name and its template; on its page, right of
 * Open Ports), red with the mode while a lock is on. Its menu locks the
 * workspace down - its network, privilege escalation, both or Freeze - for
 * instance when an agent in it runs away, or lifts the lock. A running
 * workspace is locked at once, without a restart: its processes keep running,
 * and its terminal and apps still open (they go through Coder), so admins can
 * look at what it is doing; Freeze instead pauses all of it where it is, and
 * snapshots its disk. A stopped one is locked from its next start, and every
 * lock comes back with each start until an admin lifts it. `modes` (the list's
 * one request for every workspace) shows the badge before the workspace's own
 * state comes in; that is asked for once the badge is on a page or its menu
 * opens.
 */
export const LockdownBadge: React.FC<{
	workspace: Workspace;
	/** The modes already known (the Workspaces list): no request of its own until the menu opens. */
	modes?: WorkspaceLockdown["modes"];
	className?: string;
	goldIcon?: boolean;
	panel?: boolean;
}> = ({ workspace, modes, className, goldIcon = false, panel = false }) => {
	const [open, setOpen] = useState(false);
	const [quarantineOpen, setQuarantineOpen] = useState(false);
	const [sandboxOpen, setSandboxOpen] = useState(false);
	const queryClient = useQueryClient();
	const query = useLockdown(workspace.id, modes === undefined || open);
	const set = useMutation({
		mutationFn: (mode: LockdownMode) =>
			PlatformAPI.setLockdown(workspace.id, mode),
		onSuccess: (res, mode) => {
			queryClient.setQueryData(lockdownKey(workspace.id), res);
			void queryClient.invalidateQueries({ queryKey: locksKey });
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
	if (panel && query.isLoading) return <Spinner loading />;
	if (panel && query.error)
		return (
			<div className="flex flex-col gap-3">
				<ErrorAlert error={query.error} />
				<Button variant="outline" onClick={() => void query.refetch()}>
					Retry Lock Down status
				</Button>
			</div>
		);
	// Admins only: the list's badges come only for them; a page's waits for the workspace's state.
	if (modes === undefined && !query.data?.canChange) {
		return panel ? (
			<p>Lock Down controls are not available for this workspace.</p>
		) : null;
	}
	const current = modeOf(query.data ?? { modes: modes ?? [] });
	const locked = current !== "off";
	const snapshot = query.data?.snapshot;
	// In a clickable row: the badge's clicks and keys stay with it.
	const keep = (e: React.SyntheticEvent) => e.stopPropagation();
	const ControlItem = panel ? Button : DropdownMenuItem;
	const ControlLabel = panel ? "div" : DropdownMenuLabel;
	const ControlSeparator = panel ? "hr" : DropdownMenuSeparator;
	const controls = (
		<>
			<ControlLabel>
				Lock Down {workspace.owner_name}/{workspace.name}
			</ControlLabel>
			<ControlItem
				className={panel ? "text-content-primary" : undefined}
				onClick={panel ? () => setQuarantineOpen(true) : undefined}
				onSelect={panel ? undefined : () => setQuarantineOpen(true)}
			>
				<ShieldBanIcon aria-hidden />
				Quarantine
			</ControlItem>
			<ControlItem
				onClick={panel ? () => setSandboxOpen(true) : undefined}
				onSelect={panel ? undefined : () => setSandboxOpen(true)}
			>
				<ShieldIcon aria-hidden />
				Sandbox
			</ControlItem>
			<ControlSeparator />
			{MENU.map((item) => {
				const on = item.isOn(current);
				return (
					<ControlItem
						key={item.key}
						disabled={
							set.isPending ||
							Boolean(query.data?.sandbox_group) ||
							(current === "freeze" && item.key !== "freeze")
						}
						onClick={panel ? () => set.mutate(item.next(current)) : undefined}
						onSelect={panel ? undefined : () => set.mutate(item.next(current))}
						data-testid={`lockdown-${item.key}`}
						data-on={on}
						className={cn(
							"items-start [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
							on ? "text-content-destructive" : "text-content-success",
						)}
					>
						{item.icon(on)}
						<span className="flex flex-col">
							<span className="font-medium">
								{on ? item.label.on : item.label.off}
							</span>
							<span className="text-xs text-content-secondary">
								{on ? item.hint.on : item.hint.off}
							</span>
						</span>
					</ControlItem>
				);
			})}
			{snapshot && (
				<>
					<ControlSeparator />
					<ControlLabel
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
					</ControlLabel>
					<ControlItem
						disabled={removeSnapshot.isPending}
						className={panel ? "text-content-primary" : undefined}
						onClick={panel ? () => removeSnapshot.mutate() : undefined}
						onSelect={panel ? undefined : () => removeSnapshot.mutate()}
						data-testid="lockdown-snapshot-delete"
					>
						<TrashIcon />
						Delete snapshot
					</ControlItem>
				</>
			)}
		</>
	);
	return (
		<>
			<DropdownMenu open={open} onOpenChange={setOpen}>
				{!panel && (
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							onClick={keep}
							onKeyDown={keep}
							title={
								locked
									? `Locked down: ${MODE_LABEL[current]}`
									: `Lock ${workspace.owner_name}'s workspace down`
							}
							aria-label={
								locked
									? `Lock Down: ${MODE_LABEL[current]}`
									: `Lock Down ${workspace.owner_name}/${workspace.name}`
							}
							data-testid="workspace-lockdown"
							data-mode={current}
							className={cn(
								"inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-solid px-1.5 text-xs font-medium transition-colors",
								locked
									? "border-border-destructive bg-surface-destructive/50 text-content-destructive hover:bg-surface-destructive"
									: "border-border bg-transparent text-content-secondary opacity-70 hover:text-content-primary hover:opacity-100",
								goldIcon && "border-border",
								className,
							)}
						>
							{locked ? (
								<ShieldAlertIcon
									aria-hidden
									className={cn("size-3.5", goldIcon && "text-[#d4af37]")}
								/>
							) : (
								<ShieldIcon
									aria-hidden
									className={cn("size-3.5", goldIcon && "text-[#d4af37]")}
								/>
							)}
							{locked && (
								<span className="pr-0.5">
									{query.data?.sandbox_group ? "Sandbox" : BADGE_LABEL[current]}
								</span>
							)}
						</button>
					</DropdownMenuTrigger>
				)}
				{panel ? (
					<div className="flex flex-col gap-2 [&_button]:h-auto [&_button]:justify-start [&_button]:whitespace-normal [&_button]:py-3 [&_button]:bg-surface-secondary [&_button]:border [&_button]:border-solid [&_button]:border-border [&_button]:text-left">
						{controls}
					</div>
				) : (
					<DropdownMenuContent
						align="end"
						className="w-80"
						onClick={keep}
						onKeyDown={keep}
					>
						{controls}
					</DropdownMenuContent>
				)}
			</DropdownMenu>
			<Dialog open={sandboxOpen} onOpenChange={setSandboxOpen}>
				<DialogContent
					className="z-[95] max-h-[85vh] overflow-y-auto"
					overlayClassName="z-[95]"
				>
					<DialogTitle>Sandbox</DialogTitle>
					<SandboxControl workspace={workspace} />
				</DialogContent>
			</Dialog>
			<Dialog open={quarantineOpen} onOpenChange={setQuarantineOpen}>
				<DialogContent
					className="z-[95] max-h-[85vh] overflow-y-auto"
					overlayClassName="z-[95]"
				>
					<DialogTitle>Workspace quarantine</DialogTitle>
					<WorkspaceQuarantineControl workspace={workspace} />
				</DialogContent>
			</Dialog>
		</>
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
		lock.modes.includes("sudo") && "no privilege escalation",
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
					{mode === "complete"
						? "Locked down"
						: `Locked down: ${MODE_LABEL[mode]}`}{" "}
					({parts.join(", ")})
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
