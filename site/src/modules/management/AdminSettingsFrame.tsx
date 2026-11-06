import { lazy } from "react";
import { Outlet } from "react-router";
import { useAuthenticated } from "#/hooks/useAuthenticated";

const DeploymentSettingsLayout = lazy(
	() => import("./DeploymentSettingsLayout"),
);

/**
 * Frames a page with General's sidebar and breadcrumb for admins (those who
 * may edit the deployment's settings); everyone else sees the page alone.
 */
export const AdminSettingsFrame: React.FC = () => {
	const { permissions } = useAuthenticated();
	return permissions.editDeploymentConfig ? (
		<DeploymentSettingsLayout />
	) : (
		<Outlet />
	);
};
