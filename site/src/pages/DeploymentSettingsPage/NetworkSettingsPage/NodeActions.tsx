import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	clusterNetworkKey,
	type NodeConfiguration,
	networkNodeConfiguration,
	updateNetworkNode,
} from "#/api/clusterNetwork";
import { maintainClusterNode, nodeOperator } from "#/api/nodeProvisioning";
import { networkReportKey } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import { useDashboard } from "#/modules/dashboard/useDashboard";

export type NodeAction =
	| "edit-node"
	| "taint-node"
	| "cordon-node"
	| "restart-node"
	| "drain-node";
export const nodeActionTitles: Record<NodeAction, string> = {
	"edit-node": "Edit node",
	"taint-node": "Taint node",
	"cordon-node": "Cordon or uncordon node",
	"restart-node": "Restart node",
	"drain-node": "Drain node",
};
const selectClass =
	"h-9 rounded-md border border-solid border-border bg-surface-primary px-2 text-sm text-content-primary";

export const NodeActions: React.FC<{ name: string; action: NodeAction }> = ({
	name,
	action,
}) => {
	const query = useQuery(networkNodeConfiguration(name));
	return (
		<>
			{query.error && <ErrorAlert error={query.error} />}
			{query.isLoading && <Loader />}
			{query.data &&
				(action === "restart-node" || action === "drain-node" ? (
					<NodeMaintenance node={query.data} action={action} />
				) : (
					<NodeEditor
						node={query.data}
						action={action}
						onRefresh={async () => (await query.refetch()).data}
					/>
				))}
		</>
	);
};

const textMap = (value: string): Record<string, string> => {
	const parsed: unknown = JSON.parse(value);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("Enter a JSON object with text keys and values.");
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(parsed)) {
		if (typeof item !== "string")
			throw new Error("Each label and annotation value must be text.");
		result[key] = item;
	}
	return result;
};

const NodeEditor: React.FC<{
	node: NodeConfiguration;
	action: NodeAction;
	onRefresh: () => Promise<NodeConfiguration | undefined>;
}> = ({ node, action, onRefresh }) => {
	const [base, setBase] = useState(node);
	const [labels, setLabels] = useState(JSON.stringify(node.labels, null, 2));
	const [annotations, setAnnotations] = useState(
		JSON.stringify(node.annotations, null, 2),
	);
	const [taints, setTaints] = useState(node.taints);
	const [confirmation, setConfirmation] = useState("");
	const [parseError, setParseError] = useState<Error>();
	const request = useMutation(updateNetworkNode(useQueryClient()));
	const id = useId();
	const refresh = async () => {
		const node = await onRefresh();
		if (!node) return;
		setBase(node);
		setLabels(JSON.stringify(node.labels, null, 2));
		setAnnotations(JSON.stringify(node.annotations, null, 2));
		setTaints(node.taints);
		setConfirmation("");
		setParseError(undefined);
		request.reset();
	};
	return (
		<div className="flex flex-col gap-4 overflow-auto text-sm">
			<p className="m-0 text-content-secondary">
				Changes apply to {base.name}. Refresh settings before retrying a
				concurrent change.
			</p>
			{action === "edit-node" && (
				<>
					<label className="flex flex-col gap-2">
						Labels
						<textarea
							className="min-h-36 rounded-md border border-solid border-border bg-surface-secondary p-3 font-mono text-xs"
							value={labels}
							onChange={(e) => setLabels(e.target.value)}
						/>
					</label>
					<label className="flex flex-col gap-2">
						Annotations
						<textarea
							className="min-h-36 rounded-md border border-solid border-border bg-surface-secondary p-3 font-mono text-xs"
							value={annotations}
							onChange={(e) => setAnnotations(e.target.value)}
						/>
					</label>
				</>
			)}
			{action === "cordon-node" && (
				<p>
					{base.unschedulable
						? "Uncordon allows new pods to be scheduled here."
						: "Cordon prevents new pods from scheduling here. Existing pods keep running."}
				</p>
			)}
			{action === "taint-node" && (
				<>
					<p className="m-0">
						NoSchedule blocks new pods without a matching toleration.
						PreferNoSchedule is a preference. NoExecute also evicts existing
						pods without a matching toleration.
					</p>
					{taints.map((taint, index) => (
						<div
							key={`${index}-${taint.timeAdded ?? ""}`}
							className="flex flex-col gap-2 rounded-md border border-solid border-border p-3"
						>
							<label htmlFor={`${id}-key-${index}`}>
								Key
								<Input
									id={`${id}-key-${index}`}
									value={taint.key}
									onChange={(e) =>
										setTaints((items) =>
											items.map((t, i) =>
												i === index ? { ...t, key: e.target.value } : t,
											),
										)
									}
								/>
							</label>
							<label htmlFor={`${id}-value-${index}`}>
								Value
								<Input
									id={`${id}-value-${index}`}
									value={taint.value ?? ""}
									onChange={(e) =>
										setTaints((items) =>
											items.map((t, i) =>
												i === index ? { ...t, value: e.target.value } : t,
											),
										)
									}
								/>
							</label>
							<label className="flex flex-col gap-1">
								Effect
								<select
									className={selectClass}
									value={taint.effect}
									onChange={(e) => {
										const effect = e.target.value;
										if (
											effect === "NoSchedule" ||
											effect === "PreferNoSchedule" ||
											effect === "NoExecute"
										)
											setTaints((items) =>
												items.map((t, i) =>
													i === index ? { ...t, effect } : t,
												),
											);
									}}
								>
									{["NoSchedule", "PreferNoSchedule", "NoExecute"].map(
										(effect) => (
											<option key={effect}>{effect}</option>
										),
									)}
								</select>
							</label>
							<Button
								variant="outline"
								onClick={() =>
									setTaints((items) => items.filter((_, i) => i !== index))
								}
							>
								Remove taint
							</Button>
						</div>
					))}
					<Button
						variant="outline"
						onClick={() =>
							setTaints((items) => [
								...items,
								{ key: "", value: "", effect: "NoSchedule" },
							])
						}
					>
						Add taint
					</Button>
				</>
			)}
			<Label htmlFor={id}>Type the node name to confirm</Label>
			<Input
				id={id}
				value={confirmation}
				onChange={(e) => setConfirmation(e.target.value)}
				autoComplete="off"
			/>
			{(parseError || request.error) && (
				<ErrorAlert error={parseError || request.error} />
			)}
			{request.isSuccess && <p role="status">Node settings saved.</p>}
			<div className="flex gap-2">
				<Button
					variant="outline"
					disabled={request.isPending}
					onClick={refresh}
				>
					Refresh settings
				</Button>
				<Button
					disabled={
						confirmation !== base.name || request.isPending || request.isSuccess
					}
					onClick={() => {
						try {
							const changes =
								action === "taint-node"
									? { taints }
									: action === "cordon-node"
										? { unschedulable: !base.unschedulable }
										: {
												labels: textMap(labels),
												annotations: textMap(annotations),
											};
							setParseError(undefined);
							request.mutate({
								name: base.name,
								uid: base.uid,
								resourceVersion: base.resourceVersion,
								changes,
							});
						} catch (error) {
							setParseError(
								error instanceof Error
									? error
									: new Error("Invalid node settings."),
							);
						}
					}}
				>
					{action === "cordon-node"
						? base.unschedulable
							? "Uncordon node"
							: "Cordon node"
						: "Save node settings"}
				</Button>
			</div>
		</div>
	);
};

const NodeMaintenance: React.FC<{
	node: NodeConfiguration;
	action: "restart-node" | "drain-node";
}> = ({ node, action }) => {
	const { organizations } = useDashboard();
	const [org, setOrg] = useState("");
	const organization =
		org ||
		organizations.find((o) => o.is_default)?.id ||
		organizations[0]?.id ||
		"";
	const [picked, setPicked] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const client = useQueryClient();
	const query = useQuery({
		...nodeOperator(organization),
		enabled: Boolean(organization),
	});
	const request = useMutation({
		...maintainClusterNode(organization),
		onSettled: () =>
			Promise.all([
				client.invalidateQueries({
					queryKey: nodeOperator(organization).queryKey,
				}),
				client.invalidateQueries({ queryKey: clusterNetworkKey }),
				client.invalidateQueries({ queryKey: networkReportKey }),
			]),
	});
	const profiles = query.data?.profiles.filter((p) => p.restart) ?? [];
	const profile = profiles.find((p) => p.id === picked) ?? profiles[0];
	const operation = query.data?.operation;
	const busy =
		operation?.phase === "queued" || operation?.phase === "provisioning";
	const id = useId();
	return (
		<div className="flex flex-col gap-4 text-sm">
			<p className="m-0">
				{action === "drain-node"
					? "Drain cordons the node and evicts its workloads using disruption budgets. DaemonSets stay. Pods with local temporary storage or unmanaged pods can block the drain. The node stays cordoned until you uncordon it."
					: "Restart the node through its enrolled host provider. Workspaces and services on this node will lose their connections until it returns. Drain first when workloads need to move away."}
			</p>
			{organizations.length > 1 && (
				<label className="flex flex-col gap-1">
					Organization
					<select
						className={selectClass}
						value={organization}
						onChange={(e) => {
							setOrg(e.target.value);
							setPicked("");
							request.reset();
						}}
					>
						{organizations.map((o) => (
							<option key={o.id} value={o.id}>
								{o.display_name || o.name}
							</option>
						))}
					</select>
				</label>
			)}
			{query.isLoading && <Loader />}
			{query.error && <ErrorAlert error={query.error} />}
			{query.data && (!query.data.online || !query.data.maintenance) && (
				<p role="status">
					Connect an up-to-date host node operator for this organization to
					enable maintenance.
				</p>
			)}
			{action === "restart-node" && (
				<label className="flex flex-col gap-1">
					Node provider
					<select
						className={selectClass}
						value={profile?.id ?? ""}
						onChange={(e) => setPicked(e.target.value)}
						disabled={busy || request.isPending}
					>
						{!profiles.length && (
							<option value="">No restart provider available</option>
						)}
						{profiles.map((p) => (
							<option key={p.id} value={p.id}>
								{p.label}
							</option>
						))}
					</select>
				</label>
			)}
			<Label htmlFor={id}>Type the node name to confirm</Label>
			<Input
				id={id}
				value={confirmation}
				onChange={(e) => setConfirmation(e.target.value)}
				autoComplete="off"
			/>
			{request.error && <ErrorAlert error={request.error} />}
			{operation && (
				<p
					role="status"
					className="rounded-md border border-solid border-border p-3"
				>
					<strong>{operation.phase}</strong> · {operation.message}
				</p>
			)}
			<Button
				variant="destructive"
				disabled={
					!query.data?.online ||
					!query.data?.maintenance ||
					query.isError ||
					busy ||
					request.isPending ||
					confirmation !== node.name ||
					(action === "restart-node" && !profile)
				}
				onClick={() =>
					request.mutate({
						id: crypto.randomUUID(),
						previous: operation?.id ?? null,
						profile: action === "restart-node" ? (profile?.id ?? "") : "",
						action,
						node: node.name,
						uid: node.uid,
						confirmation,
					})
				}
			>
				{nodeActionTitles[action]}
			</Button>
		</div>
	);
};
