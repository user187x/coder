import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { Link } from "react-router";
import { clusterMesh } from "#/api/clusterNetwork";
import { workspaces } from "#/api/queries/workspaces";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import { PaginationWidgetBase } from "#/components/PaginationWidget/PaginationWidgetBase";
import { HudHeartbeat } from "#/modules/dashboard/Navbar/HudHeartbeat";
import { workspaceLatency } from "#/modules/platform/workspaceLatency/WorkspacesLatencyMenu";
import { WorkspaceStatusIndicator } from "#/modules/workspaces/WorkspaceStatusIndicator/WorkspaceStatusIndicator";

const cardClass =
	"min-w-0 rounded-xl border border-solid border-border bg-surface-primary p-4";
const gridClass = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";

function formatLatency(milliseconds: number | null | undefined) {
	return typeof milliseconds === "number" && Number.isFinite(milliseconds)
		? `${milliseconds.toLocaleString("en-US", { maximumFractionDigits: 2 })} ms`
		: undefined;
}

export function ServiceLatencies() {
	const query = useQuery(clusterMesh(false));
	const labels = new Map(
		query.data?.nodes.map((node) => [node.id, node.label]),
	);
	const links =
		query.data?.edges.filter((edge) => edge.kind !== "control") ?? [];

	return (
		<section aria-label="Service connections" className="dashboard-panel">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
				<h2 className="m-0 text-base font-semibold">Service connections</h2>
				{query.data && (
					<time
						className="text-xs text-content-secondary"
						dateTime={query.data.generatedAt}
					>
						Updated{" "}
						{new Date(query.data.generatedAt).toLocaleTimeString("en-US")}
					</time>
				)}
			</div>
			{query.isLoading && <Loader />}
			{query.error && <ErrorAlert error={query.error} />}
			{query.isSuccess && links.length === 0 && (
				<p className="m-0 text-sm text-content-secondary">
					No service connections reported.
				</p>
			)}
			<div className={gridClass}>
				{links.map((edge) => {
					const latency = formatLatency(edge.ms);
					return (
						<article key={edge.id} className={cardClass}>
							<div className="mb-2 flex items-start justify-between gap-3">
								<div className="min-w-0">
									<h3 className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
										{labels.get(edge.from) ?? edge.from}
										<ArrowRightIcon
											aria-hidden
											className="size-3 shrink-0 text-content-secondary"
										/>
										<span className="sr-only">to</span>
										{labels.get(edge.to) ?? edge.to}
									</h3>
									<p className="mb-0 mt-2 font-mono text-base tabular-nums">
										{latency ?? (edge.error ? "Unavailable" : "Not measured")}
									</p>
								</div>
								<div className="w-[clamp(3rem,34%,8rem)] shrink-0 rounded-lg border border-solid border-border/70 bg-surface-secondary/50 p-1">
									<HudHeartbeat
										compact
										latency={latency ? (edge.ms ?? undefined) : undefined}
										failed={Boolean(edge.error)}
										updatedAt={query.dataUpdatedAt}
									/>
								</div>
							</div>
							<p className="m-0 break-words text-xs text-content-secondary">
								{edge.error ?? edge.note ?? edge.method}
							</p>
							{edge.samples.length > 0 && (
								<details className="mt-3 text-xs">
									<summary className="cursor-pointer text-content-link">
										Measurements
									</summary>
									<ul className="my-2 list-none space-y-2 p-0">
										{edge.samples.map((sample) => (
											<li
												key={`${sample.target}:${sample.method}`}
												className="break-words"
											>
												{sample.target}{" "}
												<span className="text-content-secondary">
													{formatLatency(sample.ms) ??
														sample.error ??
														"Not measured"}
												</span>
											</li>
										))}
									</ul>
								</details>
							)}
						</article>
					);
				})}
			</div>
		</section>
	);
}

export const workspaceLatencyPageSize = 24;

export function WorkspaceLatencies() {
	const [page, setPage] = useState(1);
	const query = useQuery({
		...workspaces({
			limit: workspaceLatencyPageSize,
			offset: (page - 1) * workspaceLatencyPageSize,
		}),
		refetchInterval: 10_000,
	});

	return (
		<section aria-label="Workspace latency" className="dashboard-panel">
			<h2 className="mt-0 mb-2 text-base font-semibold">Workspace latency</h2>
			<p className="mt-0 mb-4 text-sm text-content-secondary">
				The lowest round-trip time each running workspace’s agents reported to a
				relay.
			</p>
			{query.isLoading && <Loader />}
			{query.error && <ErrorAlert error={query.error} />}
			{query.data?.workspaces.length === 0 && (
				<p className="m-0 text-sm text-content-secondary">
					No workspaces on this page.
				</p>
			)}
			<div className={gridClass}>
				{query.data?.workspaces.map((workspace) => {
					const latency =
						workspace.latest_build.status === "running"
							? formatLatency(workspaceLatency(workspace))
							: undefined;
					return (
						<article key={workspace.id} className={cardClass}>
							<h3 className="m-0 break-words text-sm font-medium">
								<Link
									className="text-content-link"
									to={`/@${encodeURIComponent(workspace.owner_name)}/${encodeURIComponent(workspace.name)}`}
								>
									{workspace.name}
								</Link>
							</h3>
							<p className="mt-1 mb-3 break-words text-xs text-content-secondary">
								{workspace.owner_name}
							</p>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<WorkspaceStatusIndicator workspace={workspace} />
								<span className="font-mono text-sm tabular-nums">
									{latency ?? "No measurement"}
								</span>
							</div>
						</article>
					);
				})}
			</div>
			{query.data && (
				<div className="mt-3">
					<PaginationWidgetBase
						currentPage={page}
						pageSize={workspaceLatencyPageSize}
						totalRecords={query.data.count}
						onPageChange={setPage}
					/>
				</div>
			)}
		</section>
	);
}
