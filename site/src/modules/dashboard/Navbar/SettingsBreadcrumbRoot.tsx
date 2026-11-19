import {
	BreadcrumbItem,
	BreadcrumbLink,
} from "#/components/Breadcrumb/Breadcrumb";
import { useOptionalAuthContext } from "#/contexts/auth/AuthProvider";
import { AdminCategoryMenu } from "#/modules/management/AdminCategoryMenu";
import { useSettingsDefaultView } from "#/modules/management/settingsDefaultView";
import { defaultHomePresentation } from "./adminQuickLinks";
import { settingsMenuSlot, useSettingsMenuPresent } from "./settingsMenuHost";

export const SettingsBreadcrumbRoot = () => {
	const settingsMenu = useSettingsMenuPresent();
	const authenticated = Boolean(useOptionalAuthContext()?.permissions);
	const { path } = useSettingsDefaultView(!authenticated);
	const { label, icon: Icon } = defaultHomePresentation(path);

	return settingsMenu ? (
		<BreadcrumbItem ref={settingsMenuSlot} />
	) : (
		<BreadcrumbItem>
			{authenticated ? (
				<AdminCategoryMenu fallbackPath="/deployment" />
			) : (
				<BreadcrumbLink to={path ?? "/deployment"} end>
					<Icon aria-hidden className="size-4 shrink-0" />
					{label}
				</BreadcrumbLink>
			)}
		</BreadcrumbItem>
	);
};
