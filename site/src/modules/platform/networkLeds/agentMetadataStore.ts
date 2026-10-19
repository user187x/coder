import { useSyncExternalStore } from "react";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";

/**
 * The latest agent metadata, by agent id, for the parts of the workspace page
 * outside the metrics section (the network lights in the agent's header). The
 * metrics section (AgentMetadata) owns the stream and publishes each update
 * here, so the page keeps one connection per agent.
 */
const latest = new Map<string, readonly WorkspaceAgentMetadata[]>();
const listeners = new Map<string, Set<() => void>>();

export const publishAgentMetadata = (
	agentId: string,
	metadata: readonly WorkspaceAgentMetadata[],
) => {
	latest.set(agentId, metadata);
	for (const listener of listeners.get(agentId) ?? []) {
		listener();
	}
};

/** The workspace's network traffic (template metadata whose key ends in "net_io"): not a metric display. */
export const isNetworkMetadata = (m: WorkspaceAgentMetadata) =>
	/(^|_)net_io$/.test(m.description.key);

/** Whether the Cloud Drive is attached in the workspace (key ending in "cloud_drive"): the Workspaces page reads it
 * through the platform service; not a metric display either. */
export const isCloudDriveMetadata = (m: WorkspaceAgentMetadata) =>
	/(^|_)cloud_drive$/.test(m.description.key);

/** The agent's network traffic reading as it comes in, or undefined (none yet, or a template without one). */
export const useAgentNetworkMetadata = (
	agentId: string,
): WorkspaceAgentMetadata | undefined =>
	useSyncExternalStore(
		(onChange) => {
			const set = listeners.get(agentId) ?? new Set();
			set.add(onChange);
			listeners.set(agentId, set);
			return () => {
				set.delete(onChange);
			};
		},
		() => latest.get(agentId)?.find(isNetworkMetadata),
	);
