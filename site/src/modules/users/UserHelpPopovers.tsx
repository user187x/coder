import { InfoTooltip } from "#/components/InfoTooltip/InfoTooltip";
import { TooltipMessage, TooltipTitle } from "#/components/Tooltip/Tooltip";

export const RolesHelpPopover: React.FC = () => {
	return (
		<InfoTooltip size="small">
			<TooltipTitle>What is a role?</TooltipTitle>
			<TooltipMessage>
				Coder role-based access control (RBAC) provides fine-grained access
				management.
			</TooltipMessage>
		</InfoTooltip>
	);
};

export const GroupsHelpPopover: React.FC = () => {
	return (
		<InfoTooltip size="small">
			<TooltipTitle>What is a group?</TooltipTitle>
			<TooltipMessage>
				Groups can be used with template RBAC to give groups of users access to
				specific templates.
			</TooltipMessage>
		</InfoTooltip>
	);
};
