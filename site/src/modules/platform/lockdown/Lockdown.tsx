import { cn } from "cn";
import { ShieldAlertIcon, ShieldCheckIcon, ShieldIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type LockdownMode,
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

/** The mode the lock is in: complete is both. */
export const modeOf = (lock: WorkspaceLockdown | undefined): LockdownMode => {
	const m = new Set(lock?.modes ?? []);
	return m.has("network") && m.has("sudo")
		? "complete"
		: m.has("network")
			? "network"
			: m.has("sudo")
				? "sudo"
				: "off";
};

export const MODE_LABEL: Record<LockdownMode, string> = {
	network: "Network",
	sudo: "Sudo Command",
	complete: "Complete",
	off: "Off",
};

const MODE_HINT: Record<Exclude<LockdownMode, "off">, string> = {
	network:
		"Cut its network: only Coder stays reachable, so its terminal and apps still open for you",
	sudo: "Take sudo away: nobody in it can become root",
	complete: "Both: no network but Coder, no sudo",
};

const useLockdown = (workspace: Workspace) =>
	useQuery({
		queryKey: lockdownKey(workspace.id),
		queryFn: () => PlatformAPI.getLockdown(workspace.id),
		refetchInterval: 15_000,
		retry: false,
	});

/**
 * Workspace page > left sidebar: admins lock any workspace down - Network,
 * Sudo Command, or Complete (both) - for instance when an agent in it runs
 * away. A running workspace is locked at once, without a restart: its processes
 * keep running, and its terminal and apps still open (they go through Coder),
 * so admins can look at what it is doing. A stopped one is locked from its next
 * start. The shield turns red while a lock is on.
 */
export const LockdownButton: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const queryClient = useQueryClient();
	const query = useLockdown(workspace);
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
	if (!query.data?.canChange) {
		return null;
	}
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
				{(["network", "sudo", "complete"] as const).map((mode) => (
					<DropdownMenuItem
						key={mode}
						disabled={set.isPending || current === mode}
						onSelect={() => set.mutate(mode)}
						data-testid={`lockdown-${mode}`}
						className="items-start"
					>
						<ShieldAlertIcon className="mt-0.5 text-content-destructive" />
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
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

/**
 * The workspace page's notice while a lock is on, for everyone who can see the
 * workspace (its owner too, who otherwise would not know why the network or
 * sudo stopped working): what is locked, by whom, since when, and whether it
 * is in force in the running workspace.
 */
export const LockdownBanner: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const query = useLockdown(workspace);
	const lock = query.data;
	if (!lock?.locked) {
		return null;
	}
	const mode = modeOf(lock);
	const parts = [
		lock.modes.includes("network") && "no network but Coder",
		lock.modes.includes("sudo") && "no sudo",
	].filter(Boolean);
	const status = !lock.running
		? "From the workspace's next start."
		: lock.inForce
			? "In force in the running workspace."
			: "Being applied to the running workspace…";
	return (
		<div
			role="alert"
			data-testid="workspace-lockdown-banner"
			className={cn(
				"flex items-start gap-3 rounded-lg border border-solid px-4 py-3 text-sm",
				"border-border-destructive bg-surface-destructive/40 text-content-primary",
			)}
		>
			<ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-content-destructive" />
			<div className="flex flex-col gap-0.5">
				<span className="font-semibold">
					Locked down: {MODE_LABEL[mode]} ({parts.join(", ")})
				</span>
				<span className="text-content-secondary">
					{lock.by ? `By ${lock.by}` : "By an admin"}
					{lock.at ? ` ${createDayString(lock.at)}` : ""}. {status} Its
					processes keep running; an admin lifts it.
				</span>
			</div>
		</div>
	);
};
