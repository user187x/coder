import { cn } from "cn";
import { useEffect } from "react";
import { useLocation } from "react-router";
import AccessURLPage from "./AccessURLPage";
import DatabasePage from "./DatabasePage";
import DERPPage from "./DERPPage";
import { HEALTH_CARD_IDS, type HealthCardId } from "./healthSections";
import ProvisionerDaemonsPage from "./ProvisionerDaemonsPage";
import WebsocketPage from "./WebsocketPage";
import WorkspaceHealthPage from "./WorkspaceHealthPage";
import WorkspaceProxyPage from "./WorkspaceProxyPage";

/** What each of Health's cards (HEALTH_CARD_IDS, in that order) shows. */
const SECTIONS: Record<HealthCardId, React.FC> = {
	"workspace-health": WorkspaceHealthPage,
	"provisioner-daemons": ProvisionerDaemonsPage,
	"access-url": AccessURLPage,
	database: DatabasePage,
	derp: DERPPage,
	websocket: WebsocketPage,
	"workspace-proxy": WorkspaceProxyPage,
};

/**
 * Admin Controls > Health: every part of the deployment's health on one page,
 * each on its own card under the overall health (HealthLayout). A link to a
 * part (/health#derp, or its former page) scrolls to its card.
 */
const HealthOverviewPage: React.FC = () => {
	const { hash } = useLocation();
	useEffect(() => {
		const id = hash.replace(/^#/, "");
		if (id) {
			document
				.getElementById(id)
				?.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	}, [hash]);

	return (
		<div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
			{HEALTH_CARD_IDS.map((id) => {
				const Section = SECTIONS[id];
				return (
					<section
						key={id}
						id={id}
						data-testid="health-card"
						className={cn(
							"min-w-0 scroll-mt-4 rounded-lg border border-solid border-border bg-surface-primary/50 p-4",
							(id === "workspace-health" ||
								id === "provisioner-daemons" ||
								id === "derp") &&
								"xl:col-span-2",
						)}
					>
						<Section />
					</section>
				);
			})}
		</div>
	);
};

export default HealthOverviewPage;
