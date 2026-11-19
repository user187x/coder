import { ChartNoAxesCombinedIcon, GaugeIcon } from "lucide-react";
import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	clusterUsage,
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { ClusterGauge } from "#/modules/platform/ClusterGauge";
import { CompactClusterGraphs } from "./CompactClusterGraphs";

/** Chat temporarily occupies the graph area without changing the user's saved layout. */
export const SettingsMetricGraphs: React.FC<{
	anchor?: React.Ref<HTMLDivElement>;
	chatExpanded: boolean;
	compact?: boolean;
	canViewHud?: boolean;
	latency?: React.ReactNode;
}> = ({
	anchor,
	chatExpanded,
	compact = false,
	canViewHud = false,
	latency,
}) => {
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
		refetchInterval:
			(!compact || expanded) && !chatExpanded ? usage.refetchInterval : false,
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
		const toggle = (
			<DropdownMenuItem
				aria-label={label}
				title={label}
				aria-expanded={expanded}
				aria-controls={id}
				disabled={save.isPending || !preferences.isSuccess}
				className="mx-auto size-8 shrink-0 justify-center rounded-full border border-solid border-border bg-surface-secondary p-0"
				onSelect={(event) => {
					event.preventDefault();
					change(!expanded, locked);
				}}
			>
				<ChartNoAxesCombinedIcon aria-hidden />
			</DropdownMenuItem>
		);
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-1">
				{canViewHud ? (
					<ContextMenu>
						<ContextMenuTrigger asChild>{toggle}</ContextMenuTrigger>
						<ContextMenuContent className="z-[2147483647]">
							<ContextMenuItem asChild>
								<Link to="/hud">
									<GaugeIcon aria-hidden />
									Show HUD
								</Link>
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				) : (
					toggle
				)}
				<div id={id} hidden={!expanded} className="min-h-0 flex-1">
					{expanded && <CompactClusterGraphs data={cluster.data} />}
				</div>
			</div>
		);
	}
	return (
		<div ref={anchor} data-settings-metrics className="flex min-h-min flex-col">
			<ClusterGauge
				data={cluster.data}
				latency={latency}
				className="m-0 flex flex-auto flex-col justify-between gap-2"
			/>
		</div>
	);
};
