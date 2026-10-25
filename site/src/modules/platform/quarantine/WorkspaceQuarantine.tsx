import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	quarantineEnforcement,
	setWorkspaceQuarantine,
	workspaceQuarantine,
} from "#/api/queries/workspaceQuarantine";
import { workspaces as workspaceQuery } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import type { QuarantineEnforcement } from "#/api/workspaceQuarantine";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { WorkspaceQuarantineView } from "./WorkspaceQuarantineView";

const componentKeys = [
	"coder_access",
	"runtime",
	"sessions",
	"tunnels",
	"cloud_drive",
	"network",
] as const;
const labels: Record<keyof QuarantineEnforcement["components"], string> = {
	coder_access: "Coder access",
	runtime: "Workspace runtime",
	sessions: "Workspace sessions",
	tunnels: "Tunnels",
	cloud_drive: "Cloud Drive",
	network: "Network isolation",
};

export const QuarantineEnforcementReport: React.FC<{
	revision: string;
	report?: QuarantineEnforcement;
}> = ({ revision, report }) => {
	if (!report || report.revision !== revision)
		return (
			<p role="status" className="m-0 text-sm text-content-secondary">
				Waiting for enforcement results for the current policy. Isolation is
				unverified.
			</p>
		);
	return (
		<div className="flex flex-col gap-2 text-sm">
			<dl className="m-0 grid gap-2 sm:grid-cols-2">
				{componentKeys.map((key) => (
					<div
						key={key}
						className="rounded border border-solid border-border p-2"
					>
						<dt className="font-medium">{labels[key]}</dt>
						<dd className="m-0 text-content-secondary">
							{report.components[key].state}: {report.components[key].detail}
						</dd>
					</div>
				))}
			</dl>
			{report.limitations.length > 0 && (
				<ul className="m-0 pl-5 text-content-secondary">
					{report.limitations.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			)}
			<p className="m-0 text-xs text-content-secondary">
				Last checked: {report.checked_at}
			</p>
		</div>
	);
};

/** Keeps workspace metadata accessible while quarantine enforcement is pending. */
export const WorkspaceQuarantineControl: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const client = useQueryClient();
	const { user } = useAuthenticated();
	const state = useQuery(
		workspaceQuarantine(workspace.organization_id, workspace.id),
	);
	const report = useQuery({
		...quarantineEnforcement(workspace.organization_id, workspace.id),
		enabled: !!state.data?.enabled,
	});
	const change = useMutation(
		setWorkspaceQuarantine(client, workspace.organization_id, workspace.id),
	);
	const admin = user.roles.some((role) => role.name === "owner");
	if (!admin && !state.data?.enabled) return null;
	return (
		<WorkspaceQuarantineView
			name={`${workspace.owner_name}/${workspace.name}`}
			enabled={state.data?.enabled}
			reason={state.data?.reason}
			canManage={admin}
			loading={state.isLoading}
			busy={change.isPending}
			error={change.error || state.error}
			onRetry={() => {
				void state.refetch();
				void report.refetch();
			}}
			onChange={(enabled, reason, onSuccess) =>
				change.mutate({ enabled, reason }, { onSuccess })
			}
		>
			{state.data?.enabled &&
				(report.error ? (
					<>
						<ErrorAlert error={report.error} />
						<Button
							variant="outline"
							size="sm"
							onClick={() => void report.refetch()}
						>
							Retry enforcement status
						</Button>
						<p className="m-0 text-sm">
							Isolation is unverified while enforcement status is unavailable.
						</p>
					</>
				) : (
					<QuarantineEnforcementReport
						revision={state.data.revision}
						report={state.error ? undefined : report.data}
					/>
				))}
		</WorkspaceQuarantineView>
	);
};

export const WorkspaceQuarantineCard: React.FC = () => {
	const [selected, setSelected] = useState("");
	const workspaces = useQuery(workspaceQuery({ q: "", limit: 0 }));
	const workspace = workspaces.data?.workspaces.find(
		(w) =>
			w.id === selected &&
			!w.is_prebuild &&
			w.latest_build.status !== "deleted",
	);
	return (
		<WorkspaceQuarantineCardView
			workspaces={workspaces.data?.workspaces}
			selected={selected}
			onSelect={setSelected}
			loading={workspaces.isLoading}
			error={workspaces.error}
			onRetry={() => void workspaces.refetch()}
		>
			{workspace && (
				<WorkspaceQuarantineControl key={workspace.id} workspace={workspace} />
			)}
		</WorkspaceQuarantineCardView>
	);
};

export const WorkspaceQuarantineCardView: React.FC<{
	workspaces?: readonly Workspace[];
	selected: string;
	onSelect: (id: string) => void;
	loading?: boolean;
	error?: unknown;
	onRetry: () => void;
	children?: React.ReactNode;
}> = ({
	workspaces,
	selected,
	onSelect,
	loading,
	error,
	onRetry,
	children,
}) => {
	const id = useId();
	const available =
		workspaces?.filter(
			(w) => !w.is_prebuild && w.latest_build.status !== "deleted",
		) ?? [];
	return (
		<section
			aria-label="Workspace quarantine"
			className="rounded-lg border border-solid border-border p-4 flex flex-col gap-4"
		>
			<h2 className="m-0 text-lg">Workspace quarantine</h2>
			<p className="m-0 text-sm text-content-secondary">
				Isolate an individual workspace independently of Global Lock Down. This
				applies to administrators too and retains HOME data.
			</p>
			{loading && <Spinner loading />}
			{error ? (
				<>
					<ErrorAlert error={error} />
					<Button variant="outline" onClick={onRetry}>
						Retry workspace list
					</Button>
				</>
			) : null}
			{workspaces && (
				<>
					<Label htmlFor={id}>Workspace to review</Label>
					<Select value={selected} onValueChange={onSelect}>
						<SelectTrigger id={id}>
							<SelectValue placeholder="Select a workspace" />
						</SelectTrigger>
						<SelectContent>
							{available.map((w) => (
								<SelectItem key={w.id} value={w.id}>
									{w.owner_name}/{w.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{available.length === 0 && (
						<p className="m-0 text-sm">No workspaces are available.</p>
					)}
				</>
			)}
			{children}
		</section>
	);
};
