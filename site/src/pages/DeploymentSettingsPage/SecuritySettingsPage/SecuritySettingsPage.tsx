import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useDeploymentConfig } from "#/modules/management/DeploymentConfigProvider";
import { CertificateOverview } from "#/modules/platform/CertificateOverview";
import { pageTitle } from "#/utils/page";
import { SecuritySettingsPageView } from "./SecuritySettingsPageView";

const SecuritySettingsPage: React.FC = () => {
	const { deploymentConfig } = useDeploymentConfig();
	const { permissions } = useAuthenticated();

	return (
		<>
			<title>{pageTitle("Security Settings")}</title>

			<SecuritySettingsPageView
				options={deploymentConfig.options}
				certificates={
					permissions.editDeploymentConfig ? <CertificateOverview /> : undefined
				}
			/>
		</>
	);
};

export default SecuritySettingsPage;
