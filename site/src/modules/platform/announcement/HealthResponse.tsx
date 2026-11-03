import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { workspaces } from "#/api/queries/workspaces";
import { Button } from "#/components/Button/Button";
import { useAuthContext } from "#/contexts/auth/AuthProvider";
import { usePlatformHealth } from "#/modules/platform/health/usePlatformHealth";
import { findUnhealthyWorkspaces } from "#/modules/platform/workspaceHealth/workspaceHealth";

/** Read-only health of the deployment and workspaces visible to the signed-in user. */
export const HealthResponse = () => {
	const { user, permissions } = useAuthContext();
	const canViewHealth = Boolean(user && permissions?.viewDebugInfo);
	const canViewCluster = Boolean(user && permissions?.editDeploymentConfig);
	const report = usePlatformHealth(canViewHealth, canViewCluster);
	const list = useQuery({
		...workspaces({ q: "", limit: 1000 }),
		enabled: Boolean(user),
		refetchInterval: 30000,
		retry: false,
	});
	const data = user ? list.data : undefined;
	const broken = findUnhealthyWorkspaces(data?.workspaces ?? []);
	const failed = broken.filter((w) =>
		w.problems.some((p) => p.kind === "failed"),
	).length;
	const partial = Boolean(data && data.count > data.workspaces.length);
	const unavailable = [...report.unavailable];
	if (list.isError)
		unavailable.push(
			getErrorMessage(list.error, "Workspace checks unavailable."),
		);
	if (report.checks.some((check) => check.severity === "unknown"))
		unavailable.push("Some service endpoints could not be checked.");
	const loading = report.loading || list.isLoading;
	const tone =
		report.issues.some((check) => check.severity === "error") || failed
			? "error"
			: report.issues.length ||
					broken.length ||
					partial ||
					unavailable.length ||
					loading
				? "warning"
				: "ok";
	const status =
		report.issues.length || broken.length
			? "Needs attention"
			: unavailable.length || partial
				? "Incomplete assessment"
				: loading
					? "Checking"
					: "Healthy within your access";
	if (!user)
		return <div className="banner-scroll-out">Sign in to check health.</div>;
	return (
		<div
			role="region"
			className="banner-scroll-out whitespace-normal"
			aria-label="Coder health report"
		>
			<strong>
				CODER HEALTH: <span data-terminal-tone={tone}>{status}</span>
			</strong>
			{report.version && <div>Coder {report.version}</div>}
			{loading && <div>Checking services and workspaces...</div>}
			{!canViewHealth && <div>Deployment checks require health access.</div>}
			{!canViewCluster && (
				<div>Cluster services and pods require administrator access.</div>
			)}
			{report.time && <div>Component report: {report.time}</div>}
			{report.clusterTime && <div>Cluster report: {report.clusterTime}</div>}
			{unavailable.map((message) => (
				<div key={message}>
					<span data-terminal-tone="error">[UNAVAILABLE]</span> {message}
					{report.checks.length > 0 ? " Last known readings retained." : ""}
				</div>
			))}
			{data && (
				<div>
					Workspaces: {data.workspaces.length} checked of {data.count}{" "}
					accessible, {broken.length} broken ({failed} failed builds,{" "}
					{broken.length - failed} unhealthy).
					{partial ? " Counts cover only the first 1,000 workspaces." : ""}
				</div>
			)}
			{report.checks.map((check) => (
				<div key={check.name}>
					<span data-terminal-tone={check.severity}>
						[{check.severity.toUpperCase()}]
					</span>{" "}
					{check.name}
					{check.detail ? `: ${check.detail}` : ""}
				</div>
			))}
			{broken.map((workspace) => (
				<div key={workspace.id}>
					<span data-terminal-tone={workspace.severity}>
						[{workspace.severity.toUpperCase()}]
					</span>{" "}
					{workspace.owner}/{workspace.name}:{" "}
					{workspace.problems.map((p) => p.text).join("; ")}
				</div>
			))}
			{list.isError && (
				<Button size="sm" variant="outline" onClick={() => void list.refetch()}>
					Retry workspace checks
				</Button>
			)}
		</div>
	);
};
