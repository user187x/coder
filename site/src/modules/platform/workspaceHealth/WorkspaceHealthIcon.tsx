import { cn } from "cn";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useUnhealthyWorkspaces } from "./workspaceHealth";

/**
 * Beside "Workspace Health" in the Health panel: a blue check when nothing
 * needs attention, otherwise an alert in the warning or error colour.
 */
export const WorkspaceHealthIcon: React.FC = () => {
	const { unhealthy } = useUnhealthyWorkspaces();

	if (!unhealthy) {
		return <span aria-hidden className="size-4 shrink-0" />;
	}
	if (!unhealthy.length) {
		return (
			<CircleCheckIcon
				role="img"
				aria-label="All workspaces healthy"
				className="size-4 shrink-0 text-content-link"
			/>
		);
	}
	const label = `${unhealthy.length} ${unhealthy.length === 1 ? "workspace needs" : "workspaces need"} attention`;
	return (
		<TriangleAlertIcon
			role="img"
			aria-label={label}
			className={cn(
				"size-4 shrink-0",
				unhealthy.some((w) => w.severity === "error")
					? "text-content-destructive"
					: "text-content-warning",
			)}
		/>
	);
};
