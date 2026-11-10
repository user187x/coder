import { Navigate } from "react-router";
import { PageLoader } from "#/components/Loader/Loader";
import { useSettingsDefaultView } from "./settingsDefaultView";

/**
 * Where "/" lands (signing in lands there): the user's Default View, a quick link's "Set Default View", else the
 * Dashboard.
 */
export const DefaultViewRedirect: React.FC = () => {
	const view = useSettingsDefaultView();
	if (view.loading) return <PageLoader />;
	return <Navigate to={view.path ?? "/dashboard"} replace />;
};
