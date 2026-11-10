import type { LucideIcon } from "lucide-react";
import {
	createContext,
	useContext,
	useLayoutEffect,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

export const NavbarActionTarget = createContext<HTMLElement | null | undefined>(
	undefined,
);

/** One of a page's navbar actions as a menu item: a link, or a command run on select. */
type NavbarActionItem = { label: string; icon: LucideIcon } & (
	| { to: string }
	| { onSelect: () => void }
);

// The menu items of the page's navbar action, for the settings breadcrumb's category chevron (CategoryActionsMenu).
let actionMenu: readonly NavbarActionItem[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
const setActionMenu = (next: readonly NavbarActionItem[]) => {
	actionMenu = next;
	for (const listener of listeners) listener();
};

/** The menu items of the navbar action the current page shows (none: an empty list). */
export const useNavbarActionMenu = () =>
	useSyncExternalStore(subscribe, () => actionMenu);

/**
 * A page's action, in the navbar's action slot. `menu` lists what the action offers as menu items, so the settings
 * breadcrumb's category chevron can offer them too.
 */
export function NavbarAction({
	children,
	menu,
}: {
	children: React.ReactNode;
	menu?: readonly NavbarActionItem[];
}) {
	const target = useContext(NavbarActionTarget);
	useLayoutEffect(() => {
		if (!menu) return;
		setActionMenu(menu);
		return () => {
			if (actionMenu === menu) setActionMenu([]);
		};
	}, [menu]);
	return target === undefined
		? children
		: target && createPortal(children, target);
}

/** The navbar's top-left slot, after the logo: a page's own navigation, moved up into the navbar. */
export const NavbarStartTarget = createContext<HTMLElement | null | undefined>(
	undefined,
);

export function NavbarStart({ children }: { children: React.ReactNode }) {
	const target = useContext(NavbarStartTarget);
	return target ? createPortal(children, target) : null;
}
