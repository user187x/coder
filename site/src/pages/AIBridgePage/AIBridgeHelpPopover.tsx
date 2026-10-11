import { InfoTooltip } from "#/components/InfoTooltip/InfoTooltip";
import { TooltipMessage, TooltipTitle } from "#/components/Tooltip/Tooltip";

export const AIBridgeHelpPopover: React.FC = () => {
	return (
		<InfoTooltip>
			<TooltipTitle>What is AI Gateway?</TooltipTitle>
			<TooltipMessage>
				AI Gateway is a smart gateway for AI that provides centralized
				management, auditing, and attribution for LLM usage.
			</TooltipMessage>
		</InfoTooltip>
	);
};
