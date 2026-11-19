import { createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { NavbarMoveMenu, NavbarMoveScope } from "./NavbarMoveMenu";

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

export function NavbarStart({
	children,
	inlineWithoutNavbar = false,
}: {
	children: React.ReactNode;
	inlineWithoutNavbar?: boolean;
}) {
	const target = useContext(NavbarStartTarget);
	if (target === undefined && inlineWithoutNavbar) return children;
	return target
		? createPortal(
				<NavbarMoveScope.Provider value>
					<NavbarMoveMenu label="Breadcrumb options">
						<div className="contents">{children}</div>
					</NavbarMoveMenu>
				</NavbarMoveScope.Provider>,
				target,
			)
		: null;
}
