import { useFeatureVisibility } from "#/modules/dashboard/useFeatureVisibility";
import { useDeploymentConfig } from "#/modules/management/DeploymentConfigProvider";
import { pageTitle } from "#/utils/page";
import { ExternalAuthSettingsPageView } from "./ExternalAuthSettingsPageView";

const ExternalAuthSettingsPage: React.FC = () => {
	const { deploymentConfig } = useDeploymentConfig();
	const { multiple_external_auth: isEntitled } = useFeatureVisibility();

	return (
		<>
			<title>{pageTitle("External Authentication Settings")}</title>

			<ExternalAuthSettingsPageView
				config={deploymentConfig.config}
				isEntitled={isEntitled}
			/>
		</>
	);
};

export default ExternalAuthSettingsPage;
