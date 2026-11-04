import { useInfiniteQuery, useQuery } from "react-query";
import { infiniteWorkspaceBuilds } from "#/api/queries/workspaceBuilds";
import { workspaceInfrastructureMetrics } from "#/api/queries/workspaceMetrics";
import type { Workspace } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { formatStarted } from "#/modules/platform/workspaceUptime/workspaceUptime";

const timestamp = (value?: string | null) =>
	value ? formatStarted(new Date(value)) : "Not recorded";

export function BuildRunDetails({ workspace }: { workspace: Workspace }) {
	const build = workspace.latest_build;
	const runtime = useQuery(
		workspaceInfrastructureMetrics(workspace.organization_id, workspace.id),
	);
	const history = useInfiniteQuery(
		infiniteWorkspaceBuilds(workspace.id, { limit: 10 }),
	);
	return (
		<section
			className="space-y-3 border-0 border-b border-solid border-border p-4"
			aria-label="Workspace run details"
		>
			<h3 className="m-0 text-sm font-semibold">
				Build #{build.build_number} · {build.transition} ·{" "}
				{build.template_version_name}
			</h3>
			<p className="m-0 text-xs">
				Build started {timestamp(build.job.started_at)} · Finished{" "}
				{timestamp(build.job.completed_at)}
			</p>
			{build.resources
				.flatMap((resource) => resource.agents ?? [])
				.map((agent) => (
					<p className="m-0 text-xs" key={agent.id}>
						Agent {agent.name} · {agent.version || "Version unavailable"} ·
						Started {timestamp(agent.started_at)}
					</p>
				))}
			{runtime.isLoading ? (
				<p>Checking placement…</p>
			) : runtime.data?.infrastructureRestricted ? (
				<p>Cluster placement details are restricted.</p>
			) : runtime.data?.pods?.length ? (
				runtime.data.pods.map((pod) => (
					<div
						key={pod.name}
						className="rounded border border-solid border-border p-2 text-xs break-words"
					>
						<div>
							Pod <b>{pod.name}</b> · IP {pod.ip || "Unassigned"} · Started{" "}
							{timestamp(pod.startedAt)}
						</div>
						<div>
							Node {pod.node || "Unassigned"} · IP {pod.nodeIP || "Unavailable"}
						</div>
						{pod.containers.map((container) => (
							<div key={container.name}>
								{container.name} · <code>{container.image}</code>
							</div>
						))}
					</div>
				))
			) : (
				<p>Current pod placement unavailable.</p>
			)}
			<details>
				<summary className="cursor-pointer">Start and stop history</summary>
				{history.isLoading && <p>Loading build history…</p>}
				{history.isError && <p>Build history unavailable.</p>}
				{history.data?.pages.flat().map((item) => (
					<div key={item.id} className="mt-1 text-xs">
						#{item.build_number} · {item.transition} · {item.job.status} ·
						Started {timestamp(item.job.started_at)} · Finished{" "}
						{timestamp(item.job.completed_at)}
					</div>
				))}
				{history.hasNextPage && (
					<Button
						size="sm"
						variant="outline"
						disabled={history.isFetchingNextPage}
						onClick={() => void history.fetchNextPage()}
					>
						Earlier builds
					</Button>
				)}
			</details>
		</section>
	);
}
