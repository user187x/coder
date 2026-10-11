import { useState } from "react";

/**
 * The order of the top bar's movable items, around the announcement banner
 * (NavbarArrange), remembered in this browser. The banner is one of them: an
 * item before it sits at the left (after the logo), one after it at the right.
 */
export const NAVBAR_ITEMS = ["workspaces", "banner", "latency", "hud"] as const;
export type NavbarItem = (typeof NAVBAR_ITEMS)[number];

const KEY = "coder-ui-navbar-order";
const START = "coder-ui-navbar-arrange";

const isItem = (value: unknown): value is NavbarItem =>
	typeof value === "string" &&
	(NAVBAR_ITEMS as readonly string[]).includes(value);

/** Every item once: the remembered order, then any it does not know, in the default order. */
export const normalizeOrder = (value: unknown): NavbarItem[] => {
	const known = Array.isArray(value)
		? value.filter((item, i) => isItem(item) && value.indexOf(item) === i)
		: [];
	return [...known, ...NAVBAR_ITEMS.filter((item) => !known.includes(item))];
};

export const readNavbarOrder = (): NavbarItem[] => {
	try {
		return normalizeOrder(JSON.parse(localStorage.getItem(KEY) ?? "null"));
	} catch {
		return [...NAVBAR_ITEMS];
	}
};

export const useNavbarOrder = () => {
	const [order, setOrder] = useState(readNavbarOrder);
	const save = (next: NavbarItem[]) => {
		setOrder(next);
		try {
			localStorage.setItem(KEY, JSON.stringify(next));
		} catch {
			// For this page only.
		}
	};
	return { order, save, reset: () => save([...NAVBAR_ITEMS]) };
};

/** Starts arranging the top bar (the user menu's "Rearrange top bar"). */
export const startNavbarArrange = () => window.dispatchEvent(new Event(START));

export const onNavbarArrange = (listener: () => void) => {
	window.addEventListener(START, listener);
	return () => window.removeEventListener(START, listener);
};
