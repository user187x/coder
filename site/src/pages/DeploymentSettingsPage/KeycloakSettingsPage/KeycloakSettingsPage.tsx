import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { pageTitle } from "#/utils/page";
import { KeycloakView } from "./KeycloakView";

/** The Keycloak section of General > Authentication, on a page of its own. */
export const KeycloakSection: React.FC = () => (
	<section>
		<SettingsHeader>
			<SettingsHeaderTitle>Keycloak</SettingsHeaderTitle>
			<SettingsHeaderDescription>
				Keycloak sign-in for Coder: what is configured, what is missing, and one
				click to fix it.
			</SettingsHeaderDescription>
		</SettingsHeader>
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
