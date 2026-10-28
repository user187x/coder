import { Navigate } from "react-router";

type RequirePermissionProps = {
	children?: React.ReactNode;
	isFeatureVisible: boolean;
};

/**
 * Wraps routes that are available based on RBAC or licensing.
 */
export const RequirePermission: React.FC<RequirePermissionProps> = ({
	children,
	isFeatureVisible,
}) => {
	if (!isFeatureVisible) {
		return <Navigate to="/workspaces" replace />;
	}

	return children;
};
