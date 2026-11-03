import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	clusterUsage,
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { ClusterGauge } from "#/modules/platform/ClusterGauge";
import { SettingsTrayHandle } from "./SettingsTrayHandle";

/** Chat temporarily occupies the graph area without changing the user's saved layout. */
export const SettingsMetricGraphs: React.FC<{
	anchor?: React.Ref<HTMLDivElement>;
	chatExpanded: boolean;
}> = ({ anchor, chatExpanded }) => {
	const id = useId();
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const { expanded, locked } = preferences.data?.settings_metrics ?? {
		expanded: true,
		locked: false,
	};
	const usage = clusterUsage();
	const cluster = useQuery({
		...usage,
		enabled: !chatExpanded,
		refetchInterval: expanded && !chatExpanded ? usage.refetchInterval : false,
	});
	const save = useMutation({
		...updateUserUIPreferences(client),
		onError: (err) =>
			toast.error(getErrorMessage(err, "Could not save the graph preference.")),
	});
	if (chatExpanded || !cluster.data) return null;
	const change = (visible: boolean, lock: boolean) =>
		save.mutate({ settings_metrics: { expanded: visible, locked: lock } });
	return (
		<div ref={anchor} data-settings-metrics>
			<div id={id} hidden={!expanded}>
				{expanded && <ClusterGauge data={cluster.data} />}
			</div>
			<div className="settings-metrics-handle">
				<SettingsTrayHandle
					label="Metric graphs"
					horizontal
					expanded={expanded}
					locked={locked}
					busy={save.isPending || !preferences.isSuccess}
					controls={id}
					toggle={() => change(!expanded, locked)}
					lock={(open) => change(open ?? expanded, open !== null)}
				/>
			</div>
		</div>
	);
};
