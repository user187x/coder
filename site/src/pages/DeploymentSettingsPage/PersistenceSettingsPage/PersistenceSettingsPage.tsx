import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { pageTitle } from "#/utils/page";
import { PersistenceView } from "./PersistenceView";

const PersistenceSettingsPage: React.FC = () => (
	<>
		<title>{pageTitle("Persistence")}</title>
		<section>
			<SettingsHeader>
				<SettingsHeaderTitle>Persistence</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Where Coder's data lives and how it is protected: the database, its
					replicas and storage, and backups. Set up and grow a CloudNativePG
					cluster from here.
				</SettingsHeaderDescription>
			</SettingsHeader>
			<PersistenceView />
		</section>
	</>
);

export default PersistenceSettingsPage;
