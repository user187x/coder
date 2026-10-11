import { InfoTooltip } from "#/components/InfoTooltip/InfoTooltip";
import { TooltipMessage, TooltipTitle } from "#/components/Tooltip/Tooltip";

export const AuditHelpPopover: React.FC = () => {
	return (
		<InfoTooltip>
			<TooltipTitle>What is an audit log?</TooltipTitle>
			<TooltipMessage>
				An audit log is a record of events and changes made throughout a system.
			</TooltipMessage>
		</InfoTooltip>
	);
};
