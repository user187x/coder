import { HouseIcon, XIcon } from "lucide-react";
import { useContext } from "react";
import {
	ContextMenu,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { useSettingsDefaultView } from "#/modules/management/settingsDefaultView";
import { BreadcrumbContextMenuContent } from "./BreadcrumbMenu";
import { NavbarMoveOption, NavbarMoveScope } from "./NavbarMoveMenu";

/** A page the Default View can be: a plain path, as the user's preferences accept (no fragment or query). */
const settable = (path: string) => /^\/[a-z0-9][a-z0-9/_-]{0,127}$/.test(path);

/**
 * A quick link's right-click option: make its page the user's Default View (kept in their preferences), where the root
 * Settings crumb takes them; on the page that already is, it clears it.
 */
export const DefaultViewOption: React.FC<{
	path: string;
	context?: boolean;
}> = ({ path, context = false }) => {
	const view = useSettingsDefaultView();
	if (!settable(path)) return null;
	const current = view.path === path;
	const Item = context ? ContextMenuItem : DropdownMenuItem;
	return (
		<Item
			onSelect={(event) => {
				if (!context) event.preventDefault();
				view.set(current ? null : path);
			}}
		>
			{context && (current ? <XIcon aria-hidden /> : <HouseIcon aria-hidden />)}
			{current ? "Clear Default" : "Set Default"}
			{!context && " View"}
		</Item>
	);
};

export const CategoryDefaultMenu: React.FC<{
	path?: string;
	children: React.ReactElement;
	actions?: React.ReactNode;
}> = ({ path, children, actions }) => {
	const navbarMove = useContext(NavbarMoveScope);
	if (!path || !settable(path)) return children;
	return (
		<ContextMenu>
			<ContextMenuTrigger
				asChild
				onContextMenu={(event) => event.stopPropagation()}
			>
				{children}
			</ContextMenuTrigger>
			<BreadcrumbContextMenuContent aria-label="Category options">
				<DefaultViewOption path={path} context />
				{actions}
				{navbarMove && <NavbarMoveOption divided />}
			</BreadcrumbContextMenuContent>
		</ContextMenu>
	);
};

/** Marks the quick link used as the default home. */
export const DefaultViewOrb: React.FC<{ path: string }> = ({ path }) => {
	const view = useSettingsDefaultView();
	if (view.path !== path) return null;
	return (
		<span
			aria-hidden
			className="pointer-events-none absolute bottom-full left-0 whitespace-nowrap rounded-full bg-content-link px-1 text-[8px] font-semibold leading-[9px] text-content-invert"
		>
			Default home
		</span>
	);
};
