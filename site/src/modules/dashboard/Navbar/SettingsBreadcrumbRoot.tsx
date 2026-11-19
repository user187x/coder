import { MenuIcon } from "lucide-react";
import {
	BreadcrumbItem,
	BreadcrumbLink,
} from "#/components/Breadcrumb/Breadcrumb";
import { useOptionalAuthContext } from "#/contexts/auth/AuthProvider";
import { useSettingsDefaultView } from "#/modules/management/settingsDefaultView";
import { defaultHomeLabel } from "./adminQuickLinks";
import { SettingsRootMenu } from "./SettingsRootMenu";
import { settingsMenuSlot, useSettingsMenuPresent } from "./settingsMenuHost";

export const SettingsBreadcrumbRoot = ({
	fallbackPath = "/deployment",
}: {
	fallbackPath?: string;
}) => {
	const settingsMenu = useSettingsMenuPresent();
	const authenticated = Boolean(useOptionalAuthContext()?.permissions);
	const { path } = useSettingsDefaultView(!authenticated);

	if (settingsMenu) {
		return (
			<BreadcrumbItem
				ref={settingsMenuSlot}
				className="settings-breadcrumb-root"
			/>
		);
	}

	const root = (
		<BreadcrumbItem className="settings-breadcrumb-root">
			<BreadcrumbLink
				to={path ?? fallbackPath}
				end
				aria-label={defaultHomeLabel(path)}
			>
				<MenuIcon aria-hidden className="size-4 shrink-0" />
			</BreadcrumbLink>
		</BreadcrumbItem>
	);
	return authenticated ? <SettingsRootMenu>{root}</SettingsRootMenu> : root;
};
