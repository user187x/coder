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
	onUpdate: () => void;
};

export const AgentOutdatedTooltip: React.FC<AgentOutdatedTooltipProps> = ({
	agent,
	serverVersion,
	status,
	onUpdate,
}) => {
	const [isOpen, setIsOpen] = useState(false);

	const title =
		status === agentVersionStatus.Outdated
			? "Agent Outdated"
			: "Agent Deprecated";
	const opener =
		status === agentVersionStatus.Outdated
			? "This agent is an older version than the Coder server."
			: "This agent is using a deprecated version of the API.";
	const text = `${opener} This can happen after you update Coder with running workspaces. To fix this, you can stop and start the workspace.`;

	return (
		<HelpPopover open={isOpen} onOpenChange={setIsOpen}>
			<HelpPopoverTrigger asChild>
				<span role="status" className="cursor-pointer">
					{status === agentVersionStatus.Outdated ? (
						// Platform: the update badge instead of the word. static/agent-outdated.png holds both
						// variants side by side: the filled gear (light theme) on the left, the outlined one
						// (dark theme) on the right; each theme shows its half.
						<span
							className="agent-outdated-glow"
							title="Agent outdated: click for details"
						>
							<img
								src="/agent-outdated.png"
								alt="Outdated"
								className="block size-6 shrink-0 object-cover object-left dark:hidden"
							/>
							<img
								src="/agent-outdated.png"
								alt="Outdated"
								className="hidden size-6 shrink-0 object-cover object-right dark:block"
							/>
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
