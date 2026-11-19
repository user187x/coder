import { MenuIcon } from "lucide-react";
import {
	BreadcrumbItem,
	BreadcrumbLink,
} from "#/components/Breadcrumb/Breadcrumb";
import { useOptionalAuthContext } from "#/contexts/auth/AuthProvider";
import { AdminCategoryMenu } from "#/modules/management/AdminCategoryMenu";
import { useSettingsDefaultView } from "#/modules/management/settingsDefaultView";
import { defaultHomeLabel } from "./adminQuickLinks";
import { settingsMenuSlot, useSettingsMenuPresent } from "./settingsMenuHost";

export const SettingsBreadcrumbRoot = () => {
	const settingsMenu = useSettingsMenuPresent();
	const authenticated = Boolean(useOptionalAuthContext()?.permissions);
	const { path } = useSettingsDefaultView(!authenticated);

	return settingsMenu ? (
		<BreadcrumbItem ref={settingsMenuSlot} />
	) : (
		<BreadcrumbItem>
			{authenticated ? (
				<AdminCategoryMenu fallbackPath="/deployment" />
			) : (
				<BreadcrumbLink
					to={path ?? "/deployment"}
					end
					aria-label={defaultHomeLabel(path)}
				>
					<MenuIcon aria-hidden className="size-4 shrink-0" />
				</BreadcrumbLink>
			)}
		</BreadcrumbItem>
	);
};
