import { useQuery } from "react-query";
import { buildInfo } from "#/api/queries/buildInfo";
import type { WorkspaceAgent } from "#/api/typesGenerated";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { agentVersionStatus, getDisplayVersionStatus } from "#/utils/workspace";
import { AgentOutdatedTooltip } from "./AgentOutdatedTooltip";

type AgentVersionProps = {
	agent: WorkspaceAgent;
	onUpdate: () => void;
	/** The workspace's template has a newer version (Workspace.outdated). */
	workspaceOutdated?: boolean;
};

/**
 * The agent card's Update pill, when the workspace should be updated: its
 * agent is older than the server (or of an older API), or comes from another
 * build of the same version (a rebuilt release: only the build metadata
 * differs, which semver ignores), or its template has a newer version.
 */
export const AgentVersion: React.FC<AgentVersionProps> = ({
	agent,
	onUpdate,
	workspaceOutdated = false,
}) => {
	const { metadata } = useEmbeddedMetadata();
	const { data: build } = useQuery(buildInfo(metadata["build-info"]));
	const serverVersion = build?.version ?? "";
	const apiServerVersion = build?.agent_api_version ?? "";

	const { status } = getDisplayVersionStatus(
		agent.version,
		serverVersion,
		agent.api_version,
		apiServerVersion,
	);

	const otherBuild =
		Boolean(agent.version && serverVersion) && agent.version !== serverVersion;
	const reason =
		status !== agentVersionStatus.Updated
			? "agent"
			: otherBuild
				? "build"
				: workspaceOutdated
					? "template"
					: null;
	if (!reason) {
		return null;
	}

	return (
		<AgentOutdatedTooltip
			agent={agent}
			serverVersion={serverVersion}
			status={
				status === agentVersionStatus.Updated
					? agentVersionStatus.Outdated
					: status
			}
			reason={reason}
			onUpdate={onUpdate}
		/>
	);
};
