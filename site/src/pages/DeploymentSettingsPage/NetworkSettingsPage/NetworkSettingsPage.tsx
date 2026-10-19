import { useQuery } from "react-query";
import {
	availableExperiments,
	experiments,
	isKnownExperiment,
} from "#/api/queries/experiments";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { useDeploymentConfig } from "#/modules/management/DeploymentConfigProvider";
import { pageTitle } from "#/utils/page";
import { ClusterMap } from "./ClusterMap";
import { NetworkSettingsPageView } from "./NetworkSettingsPageView";

/**
 * General > Network: a live map of the cluster Coder runs on, then Coder's
 * own network settings - led by what Overview showed before it went (the
 * Access URL, the Wildcard Access URL and the experiments).
 */
const NetworkSettingsPage: React.FC = () => {
	const { deploymentConfig } = useDeploymentConfig();
	const safeExperimentsQuery = useQuery(availableExperiments());
	const { user } = useAuthenticated();
	const { metadata } = useEmbeddedMetadata();
	const enabledExperimentsQuery = useQuery(experiments(user.id, metadata));
	const safeExperiments = safeExperimentsQuery.data?.safe ?? [];
	const invalidExperiments =
		enabledExperimentsQuery.data?.filter((exp) => !isKnownExperiment(exp)) ??
		[];

	return (
		<>
			<title>{pageTitle("Network Settings")}</title>

			<div className="flex flex-col gap-12">
				<ClusterMap />
				<NetworkSettingsPageView
					options={deploymentConfig.options}
					safeExperiments={safeExperiments}
					invalidExperiments={invalidExperiments}
				/>
			</div>
		</>
	);
};

export default NetworkSettingsPage;
