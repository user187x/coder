import { InfoTooltip } from "#/components/InfoTooltip/InfoTooltip";
import { TooltipMessage, TooltipTitle } from "#/components/Tooltip/Tooltip";

export const ConnectionLogHelpPopover: React.FC = () => {
	return (
		<InfoTooltip>
			<TooltipTitle>Why are some events missing?</TooltipTitle>
			<TooltipMessage>
				The connection log is a best-effort log of workspace access. Some events
				are reported by workspace agents, and receipt of these events by the
				server is not guaranteed.
			</TooltipMessage>
		</InfoTooltip>
	);
};
