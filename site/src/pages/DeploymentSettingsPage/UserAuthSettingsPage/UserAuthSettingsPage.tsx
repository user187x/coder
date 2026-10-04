import { useDeploymentConfig } from "#/modules/management/DeploymentConfigProvider";
import { pageTitle } from "#/utils/page";
import { KeycloakSection } from "../KeycloakSettingsPage/KeycloakSettingsPage";
import { UserAuthSettingsPageView } from "./UserAuthSettingsPageView";

/**
 * General > Authentication: Keycloak sign-in (discovery, checks, fixes), then
 * Coder's own user authentication settings.
 */
const UserAuthSettingsPage: React.FC = () => {
	const { deploymentConfig } = useDeploymentConfig();

	return (
		<>
			<title>{pageTitle("Authentication Settings")}</title>

			<div className="flex flex-col gap-12">
				<KeycloakSection />
				<UserAuthSettingsPageView options={deploymentConfig.options} />
			</div>
		</>
	);
};

export default UserAuthSettingsPage;
