import { MenuIcon } from "lucide-react";
import {
	BreadcrumbItem,
	BreadcrumbLink,
} from "#/components/Breadcrumb/Breadcrumb";
import { useOptionalAuthContext } from "#/contexts/auth/AuthProvider";
import { useSettingsDefaultView } from "#/modules/management/settingsDefaultView";
import { SettingsRootMenu } from "./SettingsRootMenu";

export const SettingsBreadcrumbRoot = ({
	fallbackPath = "/dashboard",
}: {
	fallbackPath?: string;
}) => {
	const authenticated = Boolean(useOptionalAuthContext()?.permissions);
	const { path } = useSettingsDefaultView();

	const root = (
		<BreadcrumbItem className="settings-breadcrumb-root">
			<BreadcrumbLink
				to={path ?? fallbackPath}
				end
				aria-label="Home"
				title="Go to your default view"
			>
				<MenuIcon aria-hidden className="size-4 shrink-0" />
			</BreadcrumbLink>
		</BreadcrumbItem>
	);
	return authenticated ? <SettingsRootMenu>{root}</SettingsRootMenu> : root;
};
