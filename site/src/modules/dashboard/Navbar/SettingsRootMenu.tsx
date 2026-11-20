import {
	ChevronsRightIcon,
	PanelLeftIcon,
	PanelRightDashedIcon,
	PanelRightIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useLocation } from "react-router";
import {
	navbarAppearance,
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "#/components/ContextMenu/ContextMenu";
import {
	moveSavedSettingsToEdge,
	SETTINGS_ITEM,
} from "#/modules/platform/navbarOrder/navbarOrder";
import { adminCategory } from "./adminQuickLinks";
import { DefaultViewOption } from "./DefaultViewOption";
import { NavbarMoveMenu } from "./NavbarMoveMenu";
import { navbarSettingsSide } from "./settingsMenuHost";

export function SettingsPlacementOptions() {
	const preferences = useQuery(userUIPreferences());
	const placement = useMutation(updateUserUIPreferences(useQueryClient()));
	const appearance = useQuery(navbarAppearance());
	const layout =
		preferences.data?.navbar_layout ?? appearance.data?.defaultLayout;
	const side = navbarSettingsSide(preferences.data);
	const edgeSlot = layout?.order.at(side === "left" ? 0 : -1);
	const atSavedSide =
		!layout?.order.includes(SETTINGS_ITEM) || edgeSlot === SETTINGS_ITEM;
	const sideOptions = (
		[
			["left", "Left Side", PanelLeftIcon],
			["right", "Right Side", PanelRightIcon],
		] as const
	).map(([position, label, Icon]) => (
		<ContextMenuItem
			key={position}
			disabled={placement.isPending || (position === side && atSavedSide)}
			onSelect={() =>
				placement.mutate({
					navbar_settings_side: position,
					...moveSavedSettingsToEdge(layout, position),
				})
			}
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
