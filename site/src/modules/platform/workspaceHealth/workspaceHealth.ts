import { useQuery } from "react-query";
import { workspaces } from "#/api/queries/workspaces";
import type { Workspace, WorkspaceStatus } from "#/api/typesGenerated";

type WorkspaceProblem = {
	kind: "failed" | "unhealthy";
	text: string;
};

export type UnhealthyWorkspace = {
	id: string;
	owner: string;
	name: string;
	template: string;
	status: WorkspaceStatus;
	updatedAt: string;
	problems: WorkspaceProblem[];
	severity: "error" | "warning";
};

const FAILED_LIFECYCLES = new Set([
	"start_error",
	"start_timeout",
	"shutdown_error",
]);

/**
 * The workspaces that need attention: their latest build failed, or they run
 * with agents that are unhealthy, disconnected or failed to start. Failed
 * builds first, then by owner.
 */
export const findUnhealthyWorkspaces = (
	list: readonly Workspace[],
): UnhealthyWorkspace[] => {
	const out: UnhealthyWorkspace[] = [];
	for (const w of list) {
		const build = w.latest_build;
		const problems: WorkspaceProblem[] = [];
		if (build.status === "failed" || build.job.status === "failed") {
			problems.push({ kind: "failed", text: `${build.transition} failed` });
		}
		if (build.status === "running") {
			const agents = build.resources.flatMap((r) => r.agents ?? []);
			for (const agent of agents) {
				if (!agent.health.healthy) {
					problems.push({
						kind: "unhealthy",
						text: `agent ${agent.name}: ${agent.health.reason || "unhealthy"}`,
					});
				} else if (
					agent.status !== "connected" &&
					agent.status !== "connecting"
				) {
					problems.push({
						kind: "unhealthy",
						text: `agent ${agent.name}: ${agent.status}`,
					});
				}
				if (FAILED_LIFECYCLES.has(agent.lifecycle_state)) {
					problems.push({
						kind: "unhealthy",
						text: `agent ${agent.name}: ${agent.lifecycle_state.replace("_", " ")}`,
					});
				}
			}
			if (!w.health.healthy && !problems.length) {
				problems.push({ kind: "unhealthy", text: "unhealthy" });
			}
		}
		if (problems.length) {
			out.push({
				id: w.id,
				owner: w.owner_name,
				name: w.name,
				template: w.template_display_name || w.template_name,
				status: build.status,
				updatedAt: build.updated_at,
				problems,
				severity: problems.some((p) => p.kind === "failed")
					? "error"
					: "warning",
			});
		}
	}
	return out.sort((a, b) =>
		a.severity === b.severity
			? a.owner.localeCompare(b.owner)
			: a.severity === "error"
				? -1
				: 1,
	);
};

const CHECK_EVERY_MS = 30_000;

/** Re-checked every 30 seconds while shown. */
export const useUnhealthyWorkspaces = () => {
	const query = useQuery({
		...workspaces({ q: "", limit: 1000 }),
		refetchInterval: CHECK_EVERY_MS,
	});
	return {
		...query,
		unhealthy: query.data
			? findUnhealthyWorkspaces(query.data.workspaces)
			: undefined,
	};
};
