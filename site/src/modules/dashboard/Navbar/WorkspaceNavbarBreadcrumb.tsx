import { MonitorIcon } from "lucide-react";
import { useQuery } from "react-query";
import { userUIPreferences } from "#/api/queries/platform";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
} from "#/components/Breadcrumb/Breadcrumb";
import { NavbarStart } from "./NavbarAction";
import {
	settingsMenuSlot,
	useRegisterPageSettingsBreadcrumb,
	useSettingsMenuPresent,
} from "./settingsMenuHost";

/**
 * A workspace's page, with the admin settings navigation in the navbar: the navbar's Settings chevron group reads
 * Settings > Workspaces > the workspace, the Settings chevron opening the Settings menu as on every page and
 * Workspaces going back to the list.
 */
export const WorkspaceNavbarBreadcrumb: React.FC<{ workspaceName: string }> = ({
	workspaceName,
}) => {
	const preferences = useQuery(userUIPreferences());
	// The Settings menu is there to open from the chevron only while the navigation is in the navbar and undocked.
	const settingsMenu = useSettingsMenuPresent();
	const shown = Boolean(preferences.data?.admin_nav_in_navbar) && settingsMenu;
	useRegisterPageSettingsBreadcrumb(shown);
	if (!shown) return null;
	return (
		<NavbarStart>
			<Breadcrumb
				variant="connected"
				aria-label="Workspace breadcrumb"
				className="deployment-breadcrumb admin-navbar-breadcrumb"
			>
				<BreadcrumbList>
					<BreadcrumbItem ref={settingsMenuSlot} />
					<BreadcrumbItem>
						<BreadcrumbLink to="/workspaces" end>
							<MonitorIcon aria-hidden className="size-4 shrink-0" />
							Workspaces
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbItem>
						<BreadcrumbPage title={workspaceName}>
							<span className="truncate">{workspaceName}</span>
						</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
		</NavbarStart>
	);
};
