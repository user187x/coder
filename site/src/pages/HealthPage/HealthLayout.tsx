import { RotateCcwIcon } from "lucide-react";
import { Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Outlet } from "react-router";
import { health, refreshHealth } from "#/api/queries/debug";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { createDayString } from "#/utils/createDayString";
import { pageTitle } from "#/utils/page";
import { HealthIcon } from "./Content";
import { HEALTH_SECTIONS } from "./healthSections";

/**
 * Admin > General > Health, right-hand side: the deployment's overall health
 * with a refresh button, then the section chosen in General's sidebar. The
 * report is passed to the section pages as the outlet context.
 */
export const HealthLayout: React.FC = () => {
	const queryClient = useQueryClient();
	const {
		data: healthStatus,
		isLoading,
		error,
	} = useQuery({
		...health(),
		refetchInterval: 30_000,
	});
	const { mutate: forceRefresh, isPending: isRefreshing } = useMutation(
		refreshHealth(queryClient),
	);

	if (isLoading) {
		return <Loader />;
	}

	if (error || !healthStatus) {
		return <ErrorAlert error={error} />;
	}

	const degraded = HEALTH_SECTIONS.some(
		({ key }) => (healthStatus[key].warnings?.length ?? 0) > 0,
	);

	return (
		<>
			<title>{pageTitle("Health")}</title>
			<div className="flex flex-col gap-6">
				<section
					aria-label="Deployment health"
					className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-solid border-border px-5 py-4 text-sm"
				>
					<div className="flex items-center gap-3">
						<HealthIcon size={28} severity={healthStatus.severity} />
						<div>
							<div className="font-medium">
								{healthStatus.healthy ? "Healthy" : "Unhealthy"}
							</div>
							<div className="text-content-secondary">
								{healthStatus.healthy
									? degraded
										? "All systems operational, but performance might be degraded"
										: "All systems operational"
									: "Some issues have been detected"}
							</div>
						</div>
					</div>
					<div className="flex flex-col">
						<span className="font-medium">Last check</span>
						<span data-pixel="ignore" className="text-content-secondary">
							{createDayString(healthStatus.time)}
						</span>
					</div>
					<div className="flex flex-col">
						<span className="font-medium">Version</span>
						<span data-pixel="ignore" className="text-content-secondary">
							{healthStatus.coder_version}
						</span>
					</div>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								className="ml-auto"
								size="icon-lg"
								variant="subtle"
								aria-label="Refresh health checks"
								disabled={isRefreshing}
								data-testid="healthcheck-refresh-button"
								onClick={() => {
									forceRefresh();
								}}
							>
								{isRefreshing ? (
									<Spinner size="sm" loading />
								) : (
									<RotateCcwIcon className="size-5" />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">Refresh health checks</TooltipContent>
					</Tooltip>
				</section>
				<div className="min-w-0">
					<Suspense fallback={<Loader />}>
						<Outlet context={healthStatus} />
					</Suspense>
				</div>
			</div>
		</>
	);
};
