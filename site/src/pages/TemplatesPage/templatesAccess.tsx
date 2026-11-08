import { Navigate, Outlet } from "react-router";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { canSeeTemplates } from "#/modules/permissions/templates";

/**
 * Platform: the Templates pages for those who make or change templates; anyone else goes to `fallback` (the
 * template's New workspace page, or their workspaces), so a template is reached only by creating a workspace.
 */
export const RequireTemplatesAccess: React.FC<{ fallback: string }> = ({
	fallback,
}) => {
	const { permissions } = useAuthenticated();
	return canSeeTemplates(permissions) ? (
		<Outlet />
	) : (
		<Navigate to={fallback} replace />
	);
};
