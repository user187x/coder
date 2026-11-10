import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

export const NavbarActionTarget = createContext<HTMLElement | null | undefined>(
	undefined,
);

export function NavbarAction({ children }: { children: React.ReactNode }) {
	const target = useContext(NavbarActionTarget);
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
