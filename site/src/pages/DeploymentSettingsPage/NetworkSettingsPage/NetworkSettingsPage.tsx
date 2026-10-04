import { useDeploymentConfig } from "#/modules/management/DeploymentConfigProvider";
import { pageTitle } from "#/utils/page";
import { ClusterMap } from "./ClusterMap";
import { NetworkSettingsPageView } from "./NetworkSettingsPageView";

/**
 * General > Network: a live map of the cluster Coder runs on, then Coder's
 * own network settings.
 */
const NetworkSettingsPage: React.FC = () => {
	const { deploymentConfig } = useDeploymentConfig();

	return (
		<>
			<title>{pageTitle("Network Settings")}</title>

			<div className="flex flex-col gap-12">
				<ClusterMap />
				<NetworkSettingsPageView options={deploymentConfig.options} />
			</div>
		</>
	);
};

export default NetworkSettingsPage;
