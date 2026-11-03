import { CircleHelpIcon } from "lucide-react";
import { useQuery } from "react-query";
import { useLocation } from "react-router";
import { clusterMesh } from "#/api/clusterNetwork";
import { networkReport } from "#/api/queries/platform";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { HealthIcon } from "#/pages/HealthPage/Content";
import { networkHealth } from "./networkHealth";

export const NetworkStatusIndicator = () => {
	const { pathname } = useLocation();
	// On Network, let the map's Pause control own polling for these shared queries.
	const onNetworkPage = pathname === "/deployment/network";
	const report = useQuery({
		...networkReport(onNetworkPage),
		staleTime: 5_000,
		retry: false,
	});
	const mesh = useQuery({
		...clusterMesh(onNetworkPage),
		staleTime: 10_000,
	});
	const status = networkHealth(
		report.data,
		mesh.data,
		report.isError || mesh.isError,
	);
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<span
						className="inline-flex shrink-0"
						role="img"
						aria-label={status.label}
					>
						{status.severity ? (
							<HealthIcon size={14} severity={status.severity} />
						) : (
							<CircleHelpIcon className="size-3.5 text-content-secondary" />
						)}
					</span>
				</TooltipTrigger>
				<TooltipContent className="max-w-xs">{status.label}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};
