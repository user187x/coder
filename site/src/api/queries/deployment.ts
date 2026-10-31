import { API } from "#/api/api";
import { disabledRefetchOptions } from "./util";

export const deploymentConfigQueryKey = ["deployment", "config"];

export const deploymentConfig = () => {
	return {
		queryKey: deploymentConfigQueryKey,
		queryFn: API.getDeploymentConfig,
		staleTime: Number.POSITIVE_INFINITY,
	};
};

export const deploymentStatsQueryKey = ["deployment", "stats"];

export const deploymentStats = () => {
	return {
		queryKey: deploymentStatsQueryKey,
		queryFn: API.getDeploymentStats,
	};
};

export const deploymentSSHConfig = () => {
	return {
		...disabledRefetchOptions,
		queryKey: ["deployment", "sshConfig"],
		queryFn: API.getDeploymentSSHConfig,
	};
};

export const deploymentIdpSyncFieldValues = (field: string) => {
	return {
		queryKey: ["deployment", "idpSync", "fieldValues", field],
		queryFn: () => API.getDeploymentIdpSyncFieldValues(field),
	};
};
