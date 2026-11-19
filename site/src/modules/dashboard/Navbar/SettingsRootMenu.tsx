import {
	ChevronsRightIcon,
	PanelLeftIcon,
	PanelRightDashedIcon,
	PanelRightIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useLocation } from "react-router";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "#/components/ContextMenu/ContextMenu";
import { adminCategory } from "./adminQuickLinks";
import { DefaultViewOption } from "./DefaultViewOption";
import { NavbarMoveMenu } from "./NavbarMoveMenu";
import { navbarSettingsSide } from "./settingsMenuHost";

export function SettingsPlacementOptions() {
	const preferences = useQuery(userUIPreferences());
	const placement = useMutation(updateUserUIPreferences(useQueryClient()));
	const side = navbarSettingsSide(preferences.data);
	const sideOptions = (
		[
			["left", "Left Side", PanelLeftIcon],
			["right", "Right Side", PanelRightIcon],
		] as const
	).map(([position, label, Icon]) => (
		<ContextMenuItem
			key={position}
			disabled={placement.isPending || position === side}
			onSelect={() => placement.mutate({ navbar_settings_side: position })}
		>
			<Icon aria-hidden />
			{label}
		</ContextMenuItem>
	));

	return (
		<>
			{sideOptions}
			<ContextMenuSeparator />
			{(
				[
					["Side Panel", true, false, PanelRightIcon],
					["Side Strip", true, true, PanelRightDashedIcon],
					["Breadcrumb", false, false, ChevronsRightIcon],
				] as const
			).map(([label, docked, compact, Icon]) => (
				<ContextMenuItem
					key={label}
					disabled={
						placement.isPending ||
						(Boolean(preferences.data?.settings_sidebar) === docked &&
							(!docked ||
								Boolean(preferences.data?.settings_sidebar_compact) ===
									compact))
					}
					onSelect={() =>
						placement.mutate({
							settings_sidebar: docked,
							settings_sidebar_compact: compact,
						})
					}
				>
					<Icon aria-hidden />
					{label}
				</ContextMenuItem>
			))}
		</>
	);
}

export function SettingsRootMenu({
	children,
}: {
	children: React.ReactElement;
}) {
	const { pathname } = useLocation();
	const path = adminCategory(pathname)?.path;
	return (
		<NavbarMoveMenu
			label="Settings navigation placement"
			actions={
				<>
					{path && (
						<>
							<DefaultViewOption path={path} context />
							<ContextMenuSeparator />
						</>
					)}
					<SettingsPlacementOptions />
				</>
			}
		>
			{children}
		</NavbarMoveMenu>
	);
}
