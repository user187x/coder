import { cn } from "cn";
import { LockIcon, ShieldAlertIcon, UnlockIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useLocation } from "react-router";
import {
	globalLockdown,
	setGlobalLockdown,
} from "#/api/queries/globalLockdown";
import type { GlobalLockdownState } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Avatar } from "#/components/Avatar/Avatar";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import "./globalLockdown.css";
import { GlobalWorkspaceActions } from "./GlobalWorkspaceActions";

/** A non-dismissible emergency announcement with reduced-motion support. */
export const GlobalLockdownNotice: React.FC = () => (
	<div role="status" className="global-lockdown-notice">
		<span className="global-lockdown-message">
			<ShieldAlertIcon aria-hidden className="size-4" />
			<span className="global-lockdown-label">System Lockdown Enabled</span>
		</span>
	</div>
);

/** Unmounts workspace content so its sockets close while chat stays available. */
export const GlobalLockdownGate: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const { data } = useQuery(globalLockdown());
	const { pathname } = useLocation();
	const workspacePage =
		pathname === "/workspaces" ||
		pathname.startsWith("/workspaces/") ||
		pathname.startsWith("/@");
	if (!data?.enabled || data.admin || !workspacePage) {
		return children;
	}
	return (
		<section
			aria-label="Workspace access locked"
			className="relative m-6 flex min-h-80 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-solid border-border bg-surface-secondary p-8 text-center text-content-secondary"
		>
			<LockIcon aria-hidden className="size-20 opacity-20" />
			<h1 className="m-0 text-xl font-semibold text-content-primary">
				Workspace access is locked
			</h1>
			<p className="m-0 max-w-lg">
				An administrator has enabled Global Lock Down. Your workspaces keep
				running. Chat and announcements remain available until an administrator
				lifts the lock.
			</p>
		</section>
	);
};

/** Owner controls backed by the deployment's shared lockdown state. */
export const GlobalLockdownCard: React.FC = () => {
	const queryClient = useQueryClient();
	const state = useQuery(globalLockdown());
	const change = useMutation(setGlobalLockdown(queryClient));
	return (
		<GlobalLockdownCardView
			state={state.data}
			workspaceActions={
				<GlobalWorkspaceActions
					disabled={state.isLoading || !state.data?.admin || change.isPending}
				/>
			}
			loading={state.isLoading}
			error={change.error || state.error}
			busy={change.isPending}
			onChange={(enabled, confirmation, onSuccess) =>
				change.mutate({ enabled, confirmation }, { onSuccess })
			}
		/>
	);
};

type GlobalLockdownCardViewProps = {
	workspaceActions?: React.ReactNode;
	state?: GlobalLockdownState;
	loading?: boolean;
	error?: unknown;
	busy?: boolean;
	onChange: (
		enabled: boolean,
		confirmation: string,
		onSuccess: () => void,
	) => void;
};

/** Disconnections stay amber until server sessions and agent policies confirm. */
export const GlobalLockdownCardView: React.FC<GlobalLockdownCardViewProps> = ({
	state,
	workspaceActions,
	loading = false,
	error,
	busy = false,
	onChange,
}) => {
	const [open, setOpen] = useState(false);
	const [confirmation, setConfirmation] = useState("");
	const confirmationId = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const close = () => {
		if (!busy) {
			setOpen(false);
			setConfirmation("");
		}
	};
	const users = state?.users ?? [];
	return (
		<section
			aria-label="Global Lock Down"
			className="overflow-hidden rounded-2xl border border-solid border-border bg-surface-secondary"
		>
			<div className="global-lockdown-stripe h-3" aria-hidden />
			<div className="flex flex-col gap-5 p-6">
				<div className="flex flex-col items-start justify-between gap-4 lg:flex-row">
					<div className="min-w-0 max-w-xl flex-1">
						<h2 className="m-0 flex items-center gap-2 text-lg font-semibold">
							<ShieldAlertIcon aria-hidden className="size-5" />
							Global Lock Down
						</h2>
						<p className="mb-0 mt-2 text-sm text-content-secondary">
							Disconnect non-admin workspace sessions and block workspace
							access. Workspaces keep running, and chat stays available.
						</p>
					</div>
					<div className="flex shrink-0 flex-col items-stretch gap-2 self-end lg:self-auto">
						<Button
							ref={trigger}
							variant={state?.enabled ? "outline" : "destructive"}
							disabled={loading || !state || busy}
							onClick={() => {
								setConfirmation("");
								setOpen(true);
							}}
						>
							{state?.enabled ? (
								<UnlockIcon aria-hidden />
							) : (
								<LockIcon aria-hidden />
							)}
							{state?.enabled ? "Lift lock" : "Lock"}
						</Button>
						{workspaceActions}
					</div>
				</div>
				{error ? <ErrorAlert error={error} /> : null}
				{loading ? (
					<div role="status" className="flex items-center gap-2 text-sm">
						<Spinner loading /> Loading user connections
					</div>
				) : state ? (
					<details open>
						<summary className="cursor-pointer text-sm font-medium">
							Users ({users.length}) ·{" "}
							{users.filter((user) => user.connected).length} connected
						</summary>
						{users.length === 0 ? (
							<p className="mb-0 text-sm text-content-secondary">No users.</p>
						) : (
							<ul
								aria-label="User connection status"
								className="mb-0 mt-4 grid list-none grid-cols-[repeat(auto-fill,2.5rem)] gap-3 p-0"
							>
								{users.map((user) => {
									const status = user.admin
										? "admin access preserved"
										: state.enabled
											? user.disconnected
												? "disconnected"
												: "disconnecting"
											: user.connected
												? "connected"
												: "offline";
									return (
										<li key={user.id}>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="subtle"
														size="icon"
														aria-label={`${user.username}: ${status}`}
														className="relative flex size-10 items-center justify-center rounded-full p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-content-link"
													>
														<Avatar
															fallback={user.username}
															src={user.avatar_url}
															className="size-10 rounded-full"
														/>
														<span
															aria-hidden
															className={cn(
																"absolute -bottom-0.5 -left-0.5 size-3 rounded-full border-2 border-solid border-surface-secondary",
																status === "disconnected"
																	? "bg-content-destructive"
																	: status === "disconnecting"
																		? "bg-content-warning"
																		: user.connected
																			? "bg-content-success"
																			: "bg-content-secondary/40",
															)}
														/>
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													{user.username}: {status}
												</TooltipContent>
											</Tooltip>
										</li>
									);
								})}
							</ul>
						)}
					</details>
				) : null}
				{state &&
					(state.enabled ||
						state.agents?.some(
							(agent) => agent.state === "update_required",
						)) && (
						<div className="space-y-3 text-sm text-content-secondary">
							<p role="status" className="m-0">
								{!state.enabled
									? "Update outdated workspace agents before using Global Lock Down."
									: state.confirmed
										? "All non-admin workspace sessions are confirmed disconnected."
										: "Disconnection is not yet confirmed across all Coder replicas and workspace agents."}
							</p>
							{state.agents_pending > 0 && (
								<>
									<p className="m-0">
										{state.agents_pending} of {state.agents_total} workspace
										agents have not confirmed the current policy.
										{state.enabled &&
											" New workspace connections are blocked; existing direct connections remain unconfirmed until the agents acknowledge enforcement."}
									</p>
									<ul
										aria-label="Workspace agent enforcement"
										className="m-0 pl-5"
									>
										{state.agents
											?.filter((agent) => agent.state !== "confirmed")
											.map((agent) => (
												<li key={agent.id}>
													{agent.name || agent.id}:{" "}
													{agent.state === "update_required"
														? "Agent update required"
														: "Waiting for enforcement"}
												</li>
											))}
									</ul>
								</>
							)}
						</div>
					)}
			</div>
			<div className="global-lockdown-stripe h-3" aria-hidden />
			<ConfirmDialog
				open={open}
				onClose={close}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					trigger.current?.focus();
				}}
				title={
					state?.enabled ? "Lift Global Lock Down" : "Lock workspace access"
				}
				confirmText={state?.enabled ? "Lift lock" : "Lock"}
				type={state?.enabled ? "info" : "delete"}
				hideCancel={false}
				confirmLoading={busy}
				disabled={!state?.enabled && confirmation !== "agree"}
				onConfirm={() =>
					onChange(!state?.enabled, confirmation, () => {
						setOpen(false);
						setConfirmation("");
					})
				}
				description={
					<div className="flex flex-col gap-4">
						<p className="m-0">
							{state?.enabled
								? "Non-admin users will be able to reconnect to their workspaces."
								: "All non-admin users will lose workspace access and their active workspace sessions will disconnect. Their workspaces will keep running. Admin access, chat and announcements will remain available."}
						</p>
						{!state?.enabled && (
							<div className="flex flex-col gap-2">
								<Label htmlFor={confirmationId}>Type agree to confirm</Label>
								<Input
									id={confirmationId}
									value={confirmation}
									onChange={(event) => setConfirmation(event.target.value)}
									autoComplete="off"
									disabled={busy}
								/>
							</div>
						)}
						{error ? <ErrorAlert error={error} /> : null}
					</div>
				}
			/>
		</section>
	);
};
