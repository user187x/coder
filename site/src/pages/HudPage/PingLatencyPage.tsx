import { ArrowLeftIcon, GaugeIcon } from "lucide-react";
import { useQuery } from "react-query";
import { Link } from "react-router";
import { coderHeartbeat } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import { Margins } from "#/components/Margins/Margins";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { HudHeartbeat } from "#/modules/dashboard/Navbar/HudHeartbeat";
import { pageTitle } from "#/utils/page";
import { ServiceLatencies, WorkspaceLatencies } from "./LatencyConnections";

/** The browser's measured round-trip time to Coder. */
const PingLatencyPage = () => {
	const { permissions } = useAuthenticated();
	const allowed = Boolean(permissions.viewDeploymentConfig);
	const heartbeat = useQuery({ ...coderHeartbeat(), enabled: allowed });

	if (!allowed) {
		return (
			<p className="px-6 py-10 text-content-secondary">
				Ping and latency is for administrators.
			</p>
		);
	}

	return (
		<Margins className="flex grow flex-col gap-4 py-6">
			<title>{pageTitle("Ping and Latency")}</title>
			<header className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="m-0 flex items-center gap-2 text-xl font-semibold">
					<GaugeIcon aria-hidden className="size-5" />
					Ping and Latency
				</h1>
				<Button asChild variant="outline" size="sm">
					<Link to="/hud">
						<ArrowLeftIcon aria-hidden />
						HUD
					</Link>
				</Button>
			</header>
			<section aria-label="Browser to Coder" className="dashboard-panel">
				<div className="rounded-xl border border-solid border-border bg-surface-primary p-4">
					<h2 className="mt-0 mb-1 text-base font-semibold">
						Browser to Coder
					</h2>
					<p className="mt-0 mb-3 text-sm text-content-secondary">
						HTTPS round-trip time from this browser, sampled every five seconds.
					</p>
					<HudHeartbeat
						latency={heartbeat.isError ? undefined : heartbeat.data?.latency}
						previous={heartbeat.data?.previous}
						failed={heartbeat.isError}
						updatedAt={heartbeat.dataUpdatedAt}
					/>
				</div>
			</section>
			<ServiceLatencies />
			<WorkspaceLatencies />
		</Margins>
	);
};

export default PingLatencyPage;
