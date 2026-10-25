import { PowerIcon, RotateCcwIcon, ZapIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "react-query";
import { restartAccountWorkspaces } from "#/api/queries/accountWorkspaceActions";
import {
	runWorkspacePower,
	workspacePowerHistory,
} from "#/api/queries/workspacePower";
import type { Workspace } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";

type Action = "stop" | "restart" | "terminate";
const labels: Record<Action, string> = {
	stop: "Stop",
	restart: "Restart",
	terminate: "Terminate",
};

export const AccountWorkspaceActions: React.FC<{
	targets: readonly Workspace[];
	onClear?: () => void;
	compact?: boolean;
}> = ({ targets, onClear, compact = false }) => {
	const client = useQueryClient();
	const power = useMutation(runWorkspacePower(client));
	const restart = useMutation(restartAccountWorkspaces(client));
	const [action, setAction] = useState<Action>();
	const [review, setReview] = useState<readonly Workspace[]>([]);
	const [confirmation, setConfirmation] = useState("");
	const inputId = useId();
	const trigger = useRef<HTMLButtonElement | null>(null);
	const orgs = [...new Set(targets.map((w) => w.organization_id))];
	const histories = useQueries({ queries: orgs.map(workspacePowerHistory) });
	const ids = new Set(targets.map((w) => w.id));
	const operations = histories
		.flatMap((q) => q.data?.operations ?? [])
		.filter((op) => op.workspaces.some((w) => ids.has(w.id)))
		.toSorted((a, b) => b.created_at - a.created_at)
		.slice(0, 3);
	const busy =
		power.isPending ||
		restart.isPending ||
		operations.some((op) => op.status === "running");
	const regular = targets.filter(
		(w) => !w.is_prebuild && w.latest_build.status !== "deleted",
	);
	const open = (next: Action, button: HTMLButtonElement) => {
		trigger.current = button;
		setReview([...regular]);
		setAction(next);
		setConfirmation("");
	};
	const targetLabel = compact
		? (targets[0]?.name ?? "workspace")
		: "selected workspaces";
	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				{!compact && (
					<span className="text-sm font-medium">
						{regular.length} selected workspaces
					</span>
				)}
				<Button
					size="sm"
					variant="outline"
					aria-label={`Stop ${targetLabel}`}
					disabled={busy || regular.length === 0}
					onClick={(e) => open("stop", e.currentTarget)}
				>
					<PowerIcon aria-hidden />
					Stop
				</Button>
				<Button
					size="sm"
					variant="outline"
					aria-label={`Restart ${targetLabel}`}
					disabled={
						busy ||
						regular.length === 0 ||
						regular.some((w) =>
							[
								"pending",
								"starting",
								"stopping",
								"canceling",
								"deleting",
							].includes(w.latest_build.status),
						)
					}
					onClick={(e) => open("restart", e.currentTarget)}
				>
					<RotateCcwIcon aria-hidden />
					Restart
				</Button>
				<Button
					size="sm"
					variant="destructive"
					aria-label={`Terminate ${targetLabel}`}
					disabled={busy || regular.length === 0}
					onClick={(e) => open("terminate", e.currentTarget)}
				>
					<ZapIcon aria-hidden />
					Terminate
				</Button>
				{onClear && (
					<Button size="sm" variant="subtle" disabled={busy} onClick={onClear}>
						Clear workspace selection
					</Button>
				)}
				{busy && <Spinner loading />}
			</div>
			{histories.some((history) => history.isLoading) && (
				<WorkspacePowerHistoryFeedback loading />
			)}
			{histories.map(
				(history, index) =>
					history.isError && (
						<WorkspacePowerHistoryFeedback
							key={orgs[index]}
							error={history.error}
							retrying={history.isFetching}
							onRetry={() => void history.refetch()}
						/>
					),
			)}
			{power.data?.errors.map((e) => (
				<p
					role="alert"
					key={e.organization_id}
					className="m-0 text-xs text-content-destructive"
				>
					{e.workspace_ids.length} workspace requests failed: {e.message}
				</p>
			))}
			{restart.data && (
				<ul aria-label="Workspace restart results" className="m-0 pl-4 text-xs">
					{restart.data.map((w) => (
						<li
							key={w.id}
							className={
								w.error ? "text-content-destructive" : "text-content-secondary"
							}
						>
							{w.name}: {w.error ?? "Restart completed"}
						</li>
					))}
				</ul>
			)}
			{operations.length > 0 && (
				<details
					open={
						busy ||
						operations.some(
							(op) => op.status === "partial" || op.status === "interrupted",
						)
					}
					className="text-xs"
				>
					<summary className="cursor-pointer">Workspace power results</summary>
					{operations.map((op) => (
						<div key={op.id} className="mt-2">
							<p role="status" className="m-0">
								{op.completed}/{op.total} processed · {op.status}
							</p>
							<ul className="mb-0 mt-1 pl-4">
								{op.workspaces
									.filter((w) => ids.has(w.id))
									.map((w) => (
										<li
											key={w.id}
											className={
												w.error
													? "text-content-destructive"
													: "text-content-secondary"
											}
										>
											{w.owner_name}/{w.name}: {w.error ?? w.status}
											{w.force_requested && " · force-stop requested"}
											{w.runtime_objects_removed === true &&
												" · Kubernetes removal confirmed"}
										</li>
									))}
							</ul>
						</div>
					))}
				</details>
			)}
			<ConfirmDialog
				open={Boolean(action)}
				onClose={() => setAction(undefined)}
				onCloseAutoFocus={(e) => {
					e.preventDefault();
					trigger.current?.focus();
				}}
				title={
					action
						? `${labels[action]} ${review.length} workspace${review.length === 1 ? "" : "s"}`
						: "Workspace action"
				}
				confirmText={action ? labels[action] : "Confirm"}
				type={action === "restart" ? "info" : "delete"}
				hideCancel={false}
				disabled={!action || confirmation !== action}
				onConfirm={() => {
					if (action === "restart") restart.mutate(review);
					else if (action)
						power.mutate({
							action: action === "stop" ? "shutdown" : "terminate",
							targets: review,
						});
					setAction(undefined);
				}}
				description={
					<div className="flex flex-col gap-3">
						<p className="m-0">
							{action === "terminate"
								? "Force-stop the selected workspace runtimes. Workspace records and persistent storage are retained."
								: action === "restart"
									? "Stop and start each selected workspace using its current template version. Existing workspace sessions will disconnect."
									: "Gracefully stop each selected workspace. Workspace records and persistent storage are retained."}
						</p>
						<ul className="my-0 max-h-48 overflow-y-auto pl-5">
							{review.map((w) => (
								<li key={w.id}>
									{w.owner_name}/{w.name} ({w.latest_build.status})
								</li>
							))}
						</ul>
						<Label htmlFor={inputId}>Type {action} to confirm</Label>
						<Input
							id={inputId}
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

export const WorkspacePowerHistoryFeedback: React.FC<{
	loading?: boolean;
	error?: unknown;
	retrying?: boolean;
	onRetry?: () => void;
}> = ({ loading, error, retrying, onRetry }) => (
	<div className="flex flex-col gap-2">
		{loading && (
			<span
				role="status"
				className="inline-flex items-center gap-2 text-xs text-content-secondary"
			>
				<Spinner loading />
				Loading workspace power history…
			</span>
		)}
		{error !== undefined && <ErrorAlert error={error} />}
		{onRetry && (
			<Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
				Retry workspace power history
			</Button>
		)}
	</div>
);
