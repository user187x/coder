import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { AISettingsTree } from "./AISettingsTree";
import { DeploymentSidebarView } from "./DeploymentSidebarView";

/**
 * A sidebar for deployment settings.
 */
export const DeploymentSidebar: React.FC = () => {
	const { permissions } = useAuthenticated();
	const { buildInfo } = useDashboard();

	return (
		<DeploymentSidebarView
			permissions={permissions}
			buildInfo={buildInfo}
			aiSettings={<AISettingsTree />}
		/>
	);
};
