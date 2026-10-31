import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { UserUIPreferences } from "#/api/platform";
import {
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
export const useNavbarOrder = () => {
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const [draft, setDraft] = useState<UserUIPreferences["navbar_layout"]>();
	const layout = draft ?? preferences.data?.navbar_layout;
	const order = layout ? normalizeOrder(layout.order) : readNavbarOrder();
	const hidden = (layout?.hidden ?? []).filter(isNavbarItem);
	const mutation = useMutation({
		...updateUserUIPreferences(client),
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not save the top bar layout.")),
	});
	return {
		order,
		hidden,
		save: (next: NavbarItem[], removed = hidden) =>
			setDraft({ order: next, hidden: removed }),
		reset: () => setDraft({ order: [...NAVBAR_ITEMS], hidden: [] }),
		commit: (onSuccess: () => void) =>
			mutation.mutate(
				{ navbar_layout: { order, hidden } },
				{
					onSuccess: () => {
						setDraft(undefined);
						onSuccess();
					},
				},
			),
		saving: mutation.isPending,
	};
};
/** Starts arranging even when the account tile is hidden. */
export const startNavbarArrange = () => window.dispatchEvent(new Event(START));
export const onNavbarArrange = (listener: () => void) => {
	window.addEventListener(START, listener);
	return () => window.removeEventListener(START, listener);
};
