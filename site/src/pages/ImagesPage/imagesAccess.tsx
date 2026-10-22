import { Navigate, Outlet } from "react-router";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import type { Permissions } from "#/modules/permissions";

/** Platform: the Images view is the admins' alone (those who may change the deployment's settings). */
export const canSeeImages = (permissions: Permissions) =>
	Boolean(permissions.editDeploymentConfig);

/** Platform: /images and its pages, for admins; anyone else goes to their workspaces. */
export const RequireImagesAccess: React.FC = () => {
	const { permissions } = useAuthenticated();
	return canSeeImages(permissions) ? (
		<Outlet />
	) : (
		<Navigate to="/workspaces" replace />
	);
};
