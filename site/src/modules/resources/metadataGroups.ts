import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";

/**
 * "CPU Usage (Host)" → "CPU Usage": the metric group says it (templates from before the grouping); a load average
 * ("Load Avg", "Load Average") is "Ø Load", as the template names it now.
 */
export const metricName = (m: WorkspaceAgentMetadata) => {
	const name = m.description.display_name.replace(
		/\s*\((host|cluster)\)\s*$/i,
		"",
	);
	return /^load(\s+av(g|erage)\.?)?$/i.test(name) ? "Ø Load" : name;
};

/** The order of the metrics in both groups: CPU, RAM, Disk, Ø Load, then anything else as the template has it. */
const METRIC_ORDER = [/cpu/i, /ram|mem/i, /disk/i, /load/i] as const;
export const metricRank = (m: WorkspaceAgentMetadata) => {
	const text = `${m.description.key} ${m.description.display_name}`;
	const i = METRIC_ORDER.findIndex((re) => re.test(text));
	return i === -1 ? METRIC_ORDER.length : i;
};
export const inMetricOrder = (items: readonly WorkspaceAgentMetadata[]) =>
	[...items].sort((a, b) => metricRank(a) - metricRank(b)); // stable: the rest keep the template's order

export const isHostMetric = (m: WorkspaceAgentMetadata) =>
	/_host$/i.test(m.description.key) ||
	/\((host|cluster)\)\s*$/i.test(m.description.display_name);

type MetricGroup = {
	id: "workspace" | "cluster" | "other";
	title: string;
	hint: string;
	items: WorkspaceAgentMetadata[];
};

/**
 * The agent's metrics in two groups: Cluster (the host's: keys ending in
 * "_host", or names ending "(Host)") and Workspace (the rest), each in the
 * same order: CPU, RAM, Disk, Ø Load. A template with no host metrics keeps
 * the plain row.
 */
export const groupMetadata = (
	metadata: readonly WorkspaceAgentMetadata[],
): MetricGroup[] => {
	const cluster = metadata.filter(isHostMetric);
	const workspace = metadata.filter((m) => !isHostMetric(m));
	if (cluster.length === 0) {
		return [{ id: "other", title: "", hint: "", items: [...metadata] }];
	}
	return [
		...(workspace.length
			? [
					{
						id: "workspace" as const,
						title: "Workspace",
						hint: "This workspace: its own CPU, memory, disk and load",
						items: inMetricOrder(workspace),
					},
				]
			: []),
		{
			id: "cluster" as const,
			title: "Node",
			hint: "Host readings reported by the workspace agent",
			items: inMetricOrder(cluster),
		},
	];
};
