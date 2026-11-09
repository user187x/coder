import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	coderScale,
	coderScaleKey,
	updateCoderScale,
} from "#/api/clusterNetwork";
import { Button } from "#/components/Button/Button";

export const CoderReplicas = () => {
	const query = useQuery(coderScale());
	const client = useQueryClient();
	const [selected, setSelected] = useState<number | null>(null);
	const mutation = useMutation(updateCoderScale());
	const current = query.data;
	const desired = selected ?? current?.desired ?? 2;
	// One replica per node that can take one; without a node count, the fixed range of 2 to 10.
	const max = current?.maxReplicas ?? 10;
	const counts = Array.from(
		{ length: Math.max(0, Math.min(max, 10) - 1) },
		(_, index) => index + 2,
	);
	const stranded =
		current?.maxReplicas != null && current.desired > current.maxReplicas;
	return (
		<section
			className="rounded-lg border border-solid border-border p-6 bg-surface-primary"
			aria-labelledby="coder-replicas"
		>
			<h2 id="coder-replicas" className="mt-0 text-base font-semibold">
				Central Coder replicas
			</h2>
			<p className="text-sm text-content-secondary">
				Coder serves workspaces across all nodes. In active/standby mode, extra
				replicas provide failover capacity, not additional request throughput.
				Workspace editors are separate.
			</p>
			{query.isLoading && <p role="status">Loading replicas…</p>}
			{query.error && (
				<p role="alert">
					Replica settings are unavailable.{" "}
					{query.error instanceof Error
						? query.error.message
						: "Try again shortly."}
				</p>
			)}
			{current && (
				<>
					<p role="status">
						{current.ready} ready / {current.desired} requested
					</p>
					<form
						className="flex flex-wrap items-center gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							mutation.mutate(
								{ replicas: desired, resourceVersion: current.resourceVersion },
								{
									onSuccess: (data) => {
										client.setQueryData(coderScaleKey, data);
										setSelected(null);
									},
									onError: () => {
										void client.invalidateQueries({ queryKey: coderScaleKey });
									},
								},
							);
						}}
					>
						<label htmlFor="coder-replica-count">Replicas</label>
						<select
							id="coder-replica-count"
							className="rounded-md border border-solid border-border bg-surface-primary p-2"
							value={desired}
							disabled={current.automated || mutation.isPending}
							onChange={(event) => setSelected(Number(event.target.value))}
						>
							{current.desired === 1 && (
								<option value={1} disabled>
									1 (single replica, no failover)
								</option>
							)}
							{counts.map((count) => (
								<option key={count} value={count}>
									{count}
								</option>
							))}
							{/* What is requested now, though no node can take the extra replicas: shown, not offered. */}
							{current.desired > Math.min(max, 10) && (
								<option value={current.desired} disabled>
									{current.desired} (more than the nodes can run)
								</option>
							)}
						</select>
						<Button
							type="submit"
							variant="outline"
							disabled={
								current.automated ||
								mutation.isPending ||
								query.isError ||
								desired === current.desired ||
								desired > max
							}
						>
							{mutation.isPending ? "Applying…" : "Apply replicas"}
						</Button>
					</form>
					{current.maxReplicas != null && (
						<p className="text-sm">
							{current.maxReplicas}{" "}
							{current.maxReplicas === 1 ? "node can" : "nodes can"} run a Coder
							replica, one each:{" "}
							{current.nodes?.length
								? current.nodes
										.map(
											(node) =>
												`${node.name} (${node.coder ? "running one" : node.fits ? (node.label ? "free, labelled when needed" : "free") : (node.reason ?? "unavailable").toLowerCase()})`,
										)
										.join(", ")
								: "none"}
							.
						</p>
					)}
					{stranded && (
						<p role="alert" className="text-sm text-content-warning">
							{current.desired} replicas are requested but only{" "}
							{current.maxReplicas} can run; the rest stay Pending. Choose{" "}
							{current.maxReplicas} or fewer.
						</p>
					)}
					{current.automated && (
						<p>
							An autoscaler manages this deployment. Adjust its configuration
							instead.
						</p>
					)}
				</>
			)}
			{mutation.error && (
				<p role="alert">
					{mutation.error instanceof Error
						? mutation.error.message
						: "Could not change replicas."}
				</p>
			)}
			{mutation.isSuccess && (
				<p role="status">
					Replica request saved. Readiness updates as pods start or stop.
				</p>
			)}
			<p className="mb-0 text-sm text-content-secondary">
				Each replica requires a separate eligible node. Extra replicas stay
				Pending if none is available. Keep at least two for failover. This
				changes the live deployment; also set coder.coder.replicaCount in your
				Helm values so upgrades retain your choice.
			</p>
		</section>
	);
};
