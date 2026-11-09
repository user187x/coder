import type { BannerFields } from "#/api/platform";
import { useAuthContext } from "#/contexts/auth/AuthProvider";

/**
 * Whether this user may pull down the whole message (the panel and the right-click reader): the announcement lets
 * people, and, when it keeps that to admins (pulldownAdminsOnly), the user is one (can edit the deployment).
 */
export const usePulldownAllowed = (banner: BannerFields): boolean => {
	const { user, permissions } = useAuthContext();
	if (banner.pulldown === false) {
		return false;
	}
	return (
		banner.pulldownAdminsOnly !== true ||
		Boolean(user && permissions?.editDeploymentConfig)
	);
};
