import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { NavbarLayout } from "#/api/platform";
import {
	updateNavbarLayoutDefault,
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";

export const NAVBAR_ITEMS = [
	"logo",
	"workspaces",
	"banner",
	"latency",
	"hud",
	"notifications",
	"account",
	"action",
] as const;
export const NAVBAR_DIVIDERS = [
	"divider-1",
	"divider-2",
	"divider-3",
	"divider-4",
] as const;
export const isNavbarDivider = (
	value: unknown,
): value is (typeof NAVBAR_DIVIDERS)[number] =>
	NAVBAR_DIVIDERS.some((divider) => divider === value);
export type NavbarControl = (typeof NAVBAR_ITEMS)[number];
export const SETTINGS_ITEM = "settings-chevrons";
export type NavbarItem =
	| NavbarControl
	| typeof SETTINGS_ITEM
	| (typeof NAVBAR_DIVIDERS)[number];

/** Each item's name, as the arrange bar and Appearance's Navigation bar card show it. */
export const NAVBAR_LABELS: Record<NavbarItem, string> = {
	logo: "Logo",
	[SETTINGS_ITEM]: "Settings",
	action: "Action",
	notifications: "Notifications",
	account: "Account",
	workspaces: "Workspaces",
	banner: "Announcement banner",
	// admins': the HUD joined to it (one split button)
	latency: "Latency and HUD",
	hud: "HUD",
	"divider-1": "Divider 1",
	"divider-2": "Divider 2",
	"divider-3": "Divider 3",
	"divider-4": "Divider 4",
};
const KEY = "coder-ui-navbar-order";
const START = "coder-ui-navbar-arrange";
export const isNavbarItem = (value: unknown): value is NavbarItem =>
	value === SETTINGS_ITEM ||
	isNavbarDivider(value) ||
	NAVBAR_ITEMS.some((item) => item === value);

/** Keep existing positions while placing newly customizable tiles at their original edges. */
export const normalizeOrder = (value: unknown): NavbarItem[] => {
	const known: NavbarItem[] = Array.isArray(value)
		? value
				.filter(isNavbarItem)
				.filter((item, i, items) => items.indexOf(item) === i)
		: [];
	if (!known.includes("logo")) known.unshift("logo");
	return [...known, ...NAVBAR_ITEMS.filter((item) => !known.includes(item))];
};
/** Preserve legacy edge placement until Settings has a saved slot in the order. */
export const withSettingsAtEdge = (
	order: NavbarItem[],
	side: "left" | "right",
): NavbarItem[] => {
	const items = order.filter((item) => item !== SETTINGS_ITEM);
	return side === "left"
		? [SETTINGS_ITEM, ...items]
		: [...items, SETTINGS_ITEM];
};

export const moveSavedSettingsToEdge = (
	layout: NavbarLayout | null | undefined,
	side: "left" | "right",
): { navbar_layout?: NavbarLayout } =>
	layout?.order.includes(SETTINGS_ITEM)
		? {
				navbar_layout: {
					...layout,
					order: withSettingsAtEdge(normalizeOrder(layout.order), side),
				},
			}
		: {};

const readNavbarOrder = (): NavbarItem[] => {
	try {
		return normalizeOrder(JSON.parse(localStorage.getItem(KEY) ?? "null"));
	} catch {
		return [...NAVBAR_ITEMS];
	}
};
export const useNavbarOrder = (defaultLayout?: NavbarLayout) => {
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const [draft, setDraft] = useState<NavbarLayout | null>();
	const personal =
		draft === undefined ? preferences.data?.navbar_layout : draft;
	const layout = personal ?? defaultLayout;
	const order = layout
		? normalizeOrder(layout.order)
		: personal === null
			? [...NAVBAR_ITEMS]
			: readNavbarOrder();
	const hidden: NavbarItem[] = (layout?.hidden ?? [])
		.filter(isNavbarItem)
		.filter(
			(item) =>
				item !== "banner" && item !== SETTINGS_ITEM && !isNavbarDivider(item),
		);
	const deploymentDefault = useMutation({
		...updateNavbarLayoutDefault(client),
		onError: (error) =>
			toast.error(
				getErrorMessage(error, "Could not save the default navbar layout."),
			),
	});
	const mutation = useMutation({
		...updateUserUIPreferences(client),
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not save the top bar layout.")),
	});
	return {
		order,
		hidden,
		settingsSide: preferences.data?.navbar_settings_side ?? "left",
		save: (next: NavbarItem[], removed: NavbarItem[] = hidden) =>
			setDraft({ order: next, hidden: removed }),
		hide: (item: NavbarItem) =>
			mutation.mutate({ navbar_layout: { order, hidden: [...hidden, item] } }),
		reset: () => setDraft(null),
		publish: () =>
			deploymentDefault.mutate(
				{ order, hidden },
				{
					onSuccess: () => toast.success("Default navbar layout saved."),
				},
			),
		commit: (onSuccess: () => void) => {
			if (draft === undefined) {
				onSuccess();
				return;
			}
			mutation.mutate(
				{ navbar_layout: draft === null ? null : { order, hidden } },
				{
					onSuccess: () => {
						setDraft(undefined);
						onSuccess();
					},
				},
			);
		},
		saving: mutation.isPending || deploymentDefault.isPending,
	};
};
/** Starts arranging even when the account tile is hidden. */
export const startNavbarArrange = () => window.dispatchEvent(new Event(START));
export const onNavbarArrange = (listener: () => void) => {
	window.addEventListener(START, listener);
	return () => window.removeEventListener(START, listener);
};
