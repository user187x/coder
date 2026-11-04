import { pageTitle } from "#/utils/page";
import { PersistenceView } from "./PersistenceView";

const PersistenceSettingsPage: React.FC = () => (
	<>
		<title>{pageTitle("Persistence")}</title>
		<section>
			<h1 className="sr-only">Persistence</h1>
			<PersistenceView />
		</section>
	</>
);

export default PersistenceSettingsPage;
