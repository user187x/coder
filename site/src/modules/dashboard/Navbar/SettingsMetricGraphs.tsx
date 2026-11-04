import { ChartNoAxesCombinedIcon } from "lucide-react";
import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	clusterUsage,
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { ClusterGauge } from "#/modules/platform/ClusterGauge";
import { CompactClusterGraphs } from "./CompactClusterGraphs";
import { SettingsTrayHandle } from "./SettingsTrayHandle";

/** Chat temporarily occupies the graph area without changing the user's saved layout. */
export const SettingsMetricGraphs: React.FC<{
	anchor?: React.Ref<HTMLDivElement>;
	chatExpanded: boolean;
	compact?: boolean;
}> = ({ anchor, chatExpanded, compact = false }) => {
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
	if (compact) {
		const label = expanded ? "Hide metric graphs" : "Show metric graphs";
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-1">
				<DropdownMenuItem
					aria-label={label}
					title={label}
					aria-expanded={expanded}
					aria-controls={id}
					disabled={save.isPending || !preferences.isSuccess}
					className="justify-center"
					onSelect={(event) => {
						event.preventDefault();
						change(!expanded, locked);
					}}
				>
					<ChartNoAxesCombinedIcon aria-hidden />
				</DropdownMenuItem>
				<div id={id} hidden={!expanded} className="min-h-0 flex-1">
					{expanded && <CompactClusterGraphs data={cluster.data} />}
				</div>
			</div>
		);
	}
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
