import { InfoTooltip } from "#/components/InfoTooltip/InfoTooltip";
import { TooltipMessage, TooltipTitle } from "#/components/Tooltip/Tooltip";

export const WorkspaceHelpPopover: React.FC = () => {
	return (
		<InfoTooltip>
			<TooltipTitle>What is a workspace?</TooltipTitle>
			<TooltipMessage>
				A workspace is your development environment in the cloud. It includes
				the infrastructure and tools you need to work on your project.
			</TooltipMessage>
		</InfoTooltip>
	);
};
