import { useDeploymentConfig } from "#/modules/management/DeploymentConfigProvider";
import { pageTitle } from "#/utils/page";
import { ObservabilitySettingsPageView } from "./ObservabilitySettingsPageView";

const ObservabilitySettingsPage: React.FC = () => {
	const { deploymentConfig } = useDeploymentConfig();

	return (
		<>
			<title>{pageTitle("Observability Settings")}</title>

			<ObservabilitySettingsPageView options={deploymentConfig.options} />
		</>
	);
};

export default ObservabilitySettingsPage;
