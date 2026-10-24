import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useDeploymentConfig } from "#/modules/management/DeploymentConfigProvider";
import { CertificateOverview } from "#/modules/platform/CertificateOverview";
import { GlobalLockdownCard } from "#/modules/platform/globalLockdown/GlobalLockdown";
import { pageTitle } from "#/utils/page";
import { SecuritySettingsPageView } from "./SecuritySettingsPageView";

const SecuritySettingsPage: React.FC = () => {
	const { deploymentConfig } = useDeploymentConfig();
	const { permissions, user } = useAuthenticated();

	return (
		<>
			<title>{pageTitle("Security Settings")}</title>

			<SecuritySettingsPageView
				options={deploymentConfig.options}
				lockdown={
					user.roles.some((role) => role.name === "owner") ? (
						<GlobalLockdownCard />
					) : undefined
				}
				certificates={
					permissions.editDeploymentConfig ? <CertificateOverview /> : undefined
				}
			/>
		</>
	);
};

export default SecuritySettingsPage;
