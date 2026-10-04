import { useDeploymentConfig } from "#/modules/management/DeploymentConfigProvider";
import { pageTitle } from "#/utils/page";
import { SecuritySettingsPageView } from "./SecuritySettingsPageView";

const SecuritySettingsPage: React.FC = () => {
	const { deploymentConfig } = useDeploymentConfig();

	return (
		<>
			<title>{pageTitle("Security Settings")}</title>

			<SecuritySettingsPageView options={deploymentConfig.options} />
		</>
	);
};

export default SecuritySettingsPage;
