import { PowerIcon, ZapIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "react-query";
import type { WorkspacePowerOperation } from "#/api/platform";
import {
	runWorkspacePower,
	type WorkspacePowerResult,
	workspacePowerHistory,
} from "#/api/queries/workspacePower";
import { workspaces as workspaceQuery } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";

type Action = WorkspacePowerOperation["action"];
const titles: Record<Action, string> = {
	shutdown: "Shut Down",
	terminate: "Terminate",
};

export const GlobalWorkspaceActions: React.FC<{ disabled?: boolean }> = ({
	disabled = false,
}) => {
	const client = useQueryClient();
	const workspaces = useQuery({
		...workspaceQuery({ q: "", limit: 0 }),
		enabled: !disabled,
	});
	const organizations = [
		...new Set(workspaces.data?.workspaces.map((w) => w.organization_id) ?? []),
	];
	const history = useQueries({
		queries: organizations.map(workspacePowerHistory),
	});
	const run = useMutation(runWorkspacePower(client));
	return (
		<GlobalWorkspaceActionsView
			workspaces={workspaces.data?.workspaces ?? []}
			operations={history.flatMap((q) => q.data?.operations ?? [])}
			loading={workspaces.isLoading || history.some((q) => q.isLoading)}
			disabled={disabled}
			busy={run.isPending}
			error={
				workspaces.error || history.find((q) => q.error)?.error || run.error
			}
			failures={run.data?.errors}
			onRun={(action, targets) => run.mutate({ action, targets })}
			onRefresh={() => {
				void workspaces.refetch();
				for (const q of history) void q.refetch();
			}}
		/>
	);
};

type Props = {
	workspaces: readonly Workspace[];
	operations?: readonly WorkspacePowerOperation[];
	loading?: boolean;
	disabled?: boolean;
	busy?: boolean;
	error?: unknown;
	failures?: WorkspacePowerResult["errors"];
	onRun: (action: Action, targets: readonly Workspace[]) => void;
	onRefresh?: () => void;
};

/** Reviews a fixed target snapshot before requesting deployment-wide workspace power actions. */
export const GlobalWorkspaceActionsView: React.FC<Props> = ({
	workspaces,
	operations = [],
	loading = false,
	disabled = false,
	busy = false,
	error,
	failures = [],
	onRun,
	onRefresh,
}) => {
	const [action, setAction] = useState<Action>();
	const [review, setReview] = useState<readonly Workspace[]>([]);
	const [confirmation, setConfirmation] = useState("");
	const confirmationId = useId();
	const trigger = useRef<HTMLButtonElement | null>(null);
	const running = busy || operations.some((op) => op.status === "running");
	const targets = workspaces.filter(
		(w) => !w.is_prebuild && w.latest_build.status !== "deleted",
	);
	const open = (selected: Action, button: HTMLButtonElement) => {
		trigger.current = button;
		setReview(
			[...targets].sort((a, b) =>
				`${a.owner_name}/${a.name}`.localeCompare(
					`${b.owner_name}/${b.name}`,
					"en",
				),
			),
		);
		setConfirmation("");
		setAction(selected);
	};
	const reviewOrganizations = new Map<string, number>();
	for (const workspace of review)
		reviewOrganizations.set(
			workspace.organization_id,
			(reviewOrganizations.get(workspace.organization_id) ?? 0) + 1,
		);
	const close = () => {
		setAction(undefined);
		setConfirmation("");
	};
	return (
		<div className="flex max-w-sm flex-col items-stretch gap-2">
			<Button
				variant="outline"
				disabled={
					disabled ||
					loading ||
					running ||
					targets.length === 0 ||
					Boolean(error)
				}
				onClick={(e) => open("shutdown", e.currentTarget)}
			>
				<PowerIcon aria-hidden />
				Shut Down
			</Button>
			<Button
				variant="destructive"
				disabled={
					disabled ||
					loading ||
					running ||
					targets.length === 0 ||
					Boolean(error)
				}
				onClick={(e) => open("terminate", e.currentTarget)}
			>
				<ZapIcon aria-hidden />
				Terminate
			</Button>
			<p className="m-0 text-xs text-content-secondary">
				Power actions include administrator workspaces.
			</p>
			{loading && (
				<p role="status" className="m-0 text-xs text-content-secondary">
					Loading workspace targets…
				</p>
			)}
			{!loading && !error && targets.length === 0 && (
				<p className="m-0 text-xs text-content-secondary">
					No workspaces to stop.
				</p>
			)}
			{busy && (
				<p role="status" className="m-0 flex items-center gap-2 text-xs">
					<Spinner loading />
					Processing reviewed workspaces…
				</p>
			)}
			{error ? (
				<>
					<ErrorAlert error={error} />
					{onRefresh && (
						<Button variant="outline" size="sm" onClick={onRefresh}>
							Refresh workspace targets
						</Button>
					)}
				</>
			) : null}
			{failures.map((f) => (
				<p
					role="alert"
					key={`${f.organization_id}:${f.workspace_ids.join(",")}`}
					className="m-0 text-xs text-content-destructive"
				>
					{f.workspace_ids.length} workspace requests failed: {f.message}
				</p>
			))}
			{operations.length > 0 && (
				<details
					className="mt-2 text-xs"
					open={
						running ||
						operations.some(
							(op) => op.status === "partial" || op.status === "interrupted",
						)
					}
				>
					<summary className="cursor-pointer font-medium">
						Workspace power operations
					</summary>
					<div className="mt-2 max-h-80 space-y-3 overflow-y-auto">
						{[...operations]
							.sort((a, b) => b.created_at - a.created_at)
							.map((op) => (
								<section
									key={op.id}
									aria-label={`${titles[op.action]} operation`}
									className="rounded border border-solid border-border p-2"
								>
									<p role="status" className="m-0 font-medium">
										{titles[op.action]}: {op.completed}/{op.total} processed ·{" "}
										{op.status === "running"
											? "In progress"
											: op.status === "partial"
												? "Finished with failures"
												: op.status === "interrupted"
													? "Interrupted"
													: "Completed"}
									</p>
									<ul className="mb-0 mt-2 space-y-1 pl-4">
										{op.workspaces.map((w) => (
											<li
												key={w.id}
												className={
													w.status === "error" || w.status === "unsupported"
														? "text-content-destructive"
														: "text-content-secondary"
												}
											>
												{w.owner_name}/{w.name}:{" "}
												{w.error ??
													(w.status === "stopped"
														? "Coder stopped"
														: w.status === "skipped"
															? "Already stopped"
															: w.status)}
												{w.force_requested && " · force-stop requested"}
												{w.runtime_objects_removed === true &&
													" · Kubernetes removal confirmed"}
											</li>
										))}
									</ul>
								</section>
							))}
					</div>
				</details>
			)}
			<ConfirmDialog
				open={Boolean(action)}
				onClose={close}
				onCloseAutoFocus={(e) => {
					e.preventDefault();
					trigger.current?.focus();
				}}
				title={
					action ? `${titles[action]} all workspaces` : "Workspace power action"
				}
				confirmText={action ? titles[action] : "Confirm"}
				type="delete"
				hideCancel={false}
				disabled={
					!action || confirmation !== action || review.length === 0 || running
				}
				onConfirm={() => {
					if (action) {
						onRun(action, review);
						close();
					}
				}}
				description={
					<div className="flex flex-col gap-3">
						<p className="m-0">
							This affects {review.length} workspaces across all users,
							including administrators.
						</p>
						<p className="m-0">
							{action === "terminate"
								? "Force-stop workspace runtimes and stop their Coder builds. Active sessions and unsaved work may be lost. Workspace records and persistent storage are retained."
								: "Gracefully stop workspaces through Coder. Active workspace sessions will disconnect. Workspace records and persistent storage are retained."}
						</p>
						<p className="m-0">
							{reviewOrganizations.size} organizations ·{" "}
							{review.filter((w) => w.latest_build.status === "stopped").length}{" "}
							already stopped.
						</p>
						<details>
							<summary className="cursor-pointer font-medium">
								Review affected workspaces
							</summary>
							<ul className="my-2 max-h-48 overflow-y-auto pl-5">
								{review.map((w) => (
									<li key={w.id}>
										{w.owner_name}/{w.name} ({w.latest_build.status})
									</li>
								))}
							</ul>
						</details>
						{[...reviewOrganizations.values()].some((count) => count > 100) && (
							<p className="m-0">
								Large organizations are processed in batches. Keep this page
								open until all reviewed requests finish.
							</p>
						)}
						<Label htmlFor={confirmationId}>
							Type {action ?? "the action"} to confirm
						</Label>
						<Input
							id={confirmationId}
							value={confirmation}
							onChange={(e) => setConfirmation(e.target.value)}
							autoComplete="off"
						/>
					</div>
				}
			/>
		</div>
	);
};
