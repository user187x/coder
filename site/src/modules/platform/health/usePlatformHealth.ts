import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { health } from "#/api/queries/debug";
import { networkReport } from "#/api/queries/platform";
import { platformHealth } from "./platformHealth";

/** Shared polling for the navbar and the announcement terminal. */
export const usePlatformHealth = (
	canViewHealth: boolean,
	canViewCluster: boolean,
) => {
	const core = useQuery({
		...health(),
		enabled: canViewHealth,
		refetchInterval: 30000,
		staleTime: 15000,
		retry: false,
	});
	const network = useQuery({
		...networkReport(false),
		enabled: canViewCluster,
		refetchInterval: 30000,
		staleTime: 15000,
		retry: false,
	});
	const checks = platformHealth(
		canViewHealth ? core.data : undefined,
		canViewCluster ? network.data : undefined,
	);
	const unavailable: string[] = [];
	if (canViewHealth && core.isError)
		unavailable.push(
			getErrorMessage(core.error, "Coder health checks unavailable."),
		);
	if (canViewCluster && network.isError)
		unavailable.push(
			getErrorMessage(network.error, "Cluster health checks unavailable."),
		);
	if (canViewCluster && network.data) {
		if (network.data.podsAvailable === false)
			unavailable.push("Pod checks unavailable.");
		if (!network.data.services) unavailable.push("Service checks unavailable.");
		if (network.data.servicesError)
			unavailable.push(network.data.servicesError);
	}
	return {
		checks,
		issues: checks.filter(
			(check) => check.severity === "error" || check.severity === "warning",
		),
		unavailable,
		loading:
			(canViewHealth && core.isLoading) ||
			(canViewCluster && network.isLoading),
		time: canViewHealth ? core.data?.time : undefined,
		clusterTime: canViewCluster ? network.data?.generatedAt : undefined,
		version: canViewHealth ? core.data?.coder_version : undefined,
	};
};
