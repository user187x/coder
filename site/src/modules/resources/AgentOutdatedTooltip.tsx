import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import type { WorkspaceAgent } from "#/api/typesGenerated";
import {
	HelpPopover,
	HelpPopoverAction,
	HelpPopoverContent,
	HelpPopoverLinksGroup,
	HelpPopoverText,
	HelpPopoverTitle,
	HelpPopoverTrigger,
} from "#/components/HelpPopover/HelpPopover";
import { agentVersionStatus } from "../../utils/workspace";
import "#/modules/platform/agentOutdated/agentOutdated.css";

type AgentOutdatedTooltipProps = {
	agent: WorkspaceAgent;
	serverVersion: string;
	status: agentVersionStatus;
	/** Why: an older agent (or API), another build of the server's version, or a newer template version. */
	reason?: "agent" | "build" | "template";
	onUpdate: () => void;
};

export const AgentOutdatedTooltip: React.FC<AgentOutdatedTooltipProps> = ({
	agent,
	serverVersion,
	status,
	reason = "agent",
	onUpdate,
}) => {
	const [isOpen, setIsOpen] = useState(false);

	const title =
		reason === "template"
			? "Update Available"
			: status === agentVersionStatus.Outdated
				? "Agent Outdated"
				: "Agent Deprecated";
	const text =
		reason === "template"
			? "The workspace's template has a newer version. Update the workspace to start it on that version."
			: reason === "build"
				? "This agent comes from an earlier build of the Coder server's version: Coder was rebuilt or upgraded while the workspace ran. Update the workspace (or stop and start it) to get the current agent."
				: `${
						status === agentVersionStatus.Outdated
							? "This agent is an older version than the Coder server."
							: "This agent is using a deprecated version of the API."
					} This can happen after you update Coder with running workspaces. To fix this, you can stop and start the workspace.`;

	return (
		<HelpPopover open={isOpen} onOpenChange={setIsOpen}>
			<HelpPopoverTrigger asChild>
				<span role="status" className="cursor-pointer">
					{status === agentVersionStatus.Outdated ? (
						// Platform: the Update pill of workspace-update.html (HTML and CSS, agentOutdated.css), instead of
						// the word.
						<span
							className="agent-update"
							title={`${title}: click for details`}
							data-testid="agent-outdated-update"
						>
							<span className="agent-update-groove" aria-hidden="true">
								<svg className="agent-update-icon" viewBox="0 0 24 24">
									<path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
									<path d="M21 3v5h-5" />
								</svg>
							</span>
							Update
						</span>
					) : (
						"Deprecated"
					)}
				</span>
			</HelpPopoverTrigger>
			<HelpPopoverContent>
				<div className="flex flex-col gap-2">
					<div>
						<HelpPopoverTitle>{title}</HelpPopoverTitle>
						<HelpPopoverText>{text}</HelpPopoverText>
					</div>

					<div className="flex flex-col gap-1">
						<span className="font-semibold text-content-primary">
							Agent version
						</span>
						<span>{agent.version}</span>
					</div>

					<div className="flex flex-col gap-1">
						<span className="font-semibold text-content-primary">
							Server version
						</span>
						<span>{serverVersion}</span>
					</div>

					<HelpPopoverLinksGroup>
						<HelpPopoverAction
							icon={RotateCcwIcon}
							onClick={() => {
								onUpdate();
								setIsOpen(false);
							}}
							ariaLabel="Update workspace"
						>
							Update workspace
						</HelpPopoverAction>
					</HelpPopoverLinksGroup>
				</div>
			</HelpPopoverContent>
		</HelpPopover>
	);
};
