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
