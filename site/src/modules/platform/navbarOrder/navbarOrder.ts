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
export type NavbarItem = (typeof NAVBAR_ITEMS)[number];
const KEY = "coder-ui-navbar-order";
const START = "coder-ui-navbar-arrange";
export const isNavbarItem = (value: unknown): value is NavbarItem =>
	typeof value === "string" && NAVBAR_ITEMS.some((item) => item === value);

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
		.filter((item) => item !== "action" && item !== "banner");
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
		save: (next: NavbarItem[], removed: NavbarItem[] = hidden) =>
			setDraft({ order: next, hidden: removed }),
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
