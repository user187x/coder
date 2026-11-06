import {
	BoxIcon,
	ClockIcon,
	CpuIcon,
	GitCommitHorizontalIcon,
	LayersIcon,
	NetworkIcon,
} from "lucide-react";
import { useInfiniteQuery, useQuery } from "react-query";
import { Link } from "react-router";
import { infiniteWorkspaceBuilds } from "#/api/queries/workspaceBuilds";
import { workspaceInfrastructureMetrics } from "#/api/queries/workspaceMetrics";
import type { Workspace } from "#/api/typesGenerated";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { formatStarted } from "#/modules/platform/workspaceUptime/workspaceUptime";
import { nodeBadgeStyle } from "#/pages/DeploymentSettingsPage/NetworkSettingsPage/clusterFormat";
import { ImageVersionBadge, imageVersion } from "#/pages/ImagesPage/badges";

const timestamp = (value?: string | null) =>
	value ? formatStarted(new Date(value)) : "Not recorded";

export function BuildRunDetails({ workspace }: { workspace: Workspace }) {
	const build = workspace.latest_build;
	const { permissions } = useAuthenticated();
	const runtime = useQuery(
		workspaceInfrastructureMetrics(workspace.organization_id, workspace.id),
	);
	const history = useInfiniteQuery(
		infiniteWorkspaceBuilds(workspace.id, { limit: 10 }),
	);
	return (
		<section
			className="space-y-2 border-0 border-b border-solid border-border px-4 py-3"
			aria-label="Workspace run details"
		>
			<div className="flex flex-wrap items-center gap-1.5">
				<h3 className="m-0 mr-1 text-sm font-semibold">
					Build #{build.build_number}
				</h3>
				<Badge size="xs">{build.transition}</Badge>
				<Badge variant="outline" size="xs">
					<GitCommitHorizontalIcon aria-hidden />
					{build.template_version_name}
				</Badge>
			</div>
			<p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
				<span className="inline-flex items-center gap-1">
					<ClockIcon aria-hidden className="size-3" />
					Started {timestamp(build.job.started_at)}
				</span>
				<span>Finished {timestamp(build.job.completed_at)}</span>
			</p>
			{build.resources
				.flatMap((resource) => resource.agents ?? [])
				.map((agent) => (
					<p
						className="m-0 flex flex-wrap items-center gap-1.5 text-xs"
						key={agent.id}
					>
						<Badge size="xs" variant="info">
							<CpuIcon aria-hidden />
							Agent {agent.name}
						</Badge>
						{agent.version ? (
							<ImageVersionBadge version={agent.version} />
						) : (
							<span>Version unavailable</span>
						)}
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
						className="grid min-w-0 gap-1.5 rounded-lg border border-solid border-border bg-surface-secondary p-2 text-xs break-words"
					>
						<div className="flex flex-wrap items-center gap-1.5">
							<Badge size="xs">
								<BoxIcon aria-hidden />
								Pod
							</Badge>{" "}
							<b>{pod.name}</b> <IPAddressBadge address={pod.ip} /> Started{" "}
							{timestamp(pod.startedAt)}
						</div>
						<div className="flex flex-wrap items-center gap-1.5">
							{pod.node ? (
								<Badge
									size="sm"
									className="rounded-full"
									style={nodeBadgeStyle(pod.node)}
									asChild={permissions.viewDeploymentConfig}
								>
									{permissions.viewDeploymentConfig ? (
										<Link
											to={`/deployment/network?node=${encodeURIComponent(pod.node)}`}
										>
											<NetworkIcon aria-hidden />
											{pod.node}
										</Link>
									) : (
										<span>
											<NetworkIcon aria-hidden />
											{pod.node}
										</span>
									)}
								</Badge>
							) : (
								<span>Node unassigned</span>
							)}
							<IPAddressBadge address={pod.nodeIP} />
						</div>
						{pod.containers.map((container) => (
							<div
								key={container.name}
								className="flex flex-wrap items-center gap-1.5"
							>
								<Badge size="xs" variant="outline">
									<LayersIcon aria-hidden />
									{container.name}
								</Badge>{" "}
								<code className="break-all">{container.image}</code>
								<ImageVersionBadge version={imageVersion(container.image)} />
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

function IPAddressBadge({ address }: { address?: string | null }) {
	if (!address) return <span>IP unavailable</span>;
	let hash = 0;
	for (const character of address)
		hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
	return (
		<Badge
			variant="outline"
			size="sm"
			className="rounded-none border-dashed font-mono"
			style={{ borderColor: `hsl(${hash % 360} 55% 55%)` }}
			title={`IP address ${address}`}
		>
			<NetworkIcon aria-hidden />
			{address}
		</Badge>
	);
}
