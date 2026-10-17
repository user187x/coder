import type { WorkspaceBuild } from "#/api/typesGenerated";
import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";

type WorkspaceBuildFailedAlertProps = {
	build: WorkspaceBuild;
};

export const WorkspaceBuildFailedAlert: React.FC<
	WorkspaceBuildFailedAlertProps
> = ({ build }) => {
	return (
		<Alert severity="error" prominent>
			<AlertTitle>Workspace build failed</AlertTitle>
			<AlertDescription>{build.job.error}</AlertDescription>
		</Alert>
	);
};
