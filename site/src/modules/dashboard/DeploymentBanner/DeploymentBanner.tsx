import { useQuery } from "react-query";
import { health } from "#/api/queries/debug";
import { deploymentStats } from "#/api/queries/deployment";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { DeploymentBannerView } from "./DeploymentBannerView";

export function DeploymentBanner() {
	const { permissions } = useAuthenticated();
	const enabled =
		!isEmbeddedFrame() &&
		permissions.viewDeploymentConfig &&
		permissions.viewDeploymentStats;
	const { data: stats, refetch } = useQuery({ ...deploymentStats(), enabled });
	const { data: report } = useQuery({ ...health(), enabled });
	if (!enabled || !stats) return null;
	return (
		<DeploymentBannerView stats={stats} health={report} fetchStats={refetch} />
	);
}
