import { pageTitle } from "#/utils/page";
import { KeycloakView } from "./KeycloakView";

/** The Keycloak section of General > Authentication, on a page of its own. */
export const KeycloakSection: React.FC = () => (
	<section>
		<h1 className="sr-only">Keycloak</h1>
		<KeycloakView />
	</section>
);

const KeycloakSettingsPage: React.FC = () => (
	<>
		<title>{pageTitle("Keycloak")}</title>
		<KeycloakSection />
	</>
);

export default KeycloakSettingsPage;
