import { MoveIcon } from "lucide-react";
import { createContext } from "react";
import {
	ContextMenu,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { startNavbarArrange } from "#/modules/platform/navbarOrder/navbarOrder";
import { BreadcrumbContextMenuContent } from "./BreadcrumbMenu";

export const NavbarMoveScope = createContext(false);

export function NavbarMoveOption({ divided = false }: { divided?: boolean }) {
	return (
		<>
			{divided && (
				<ContextMenuSeparator className="mx-2 my-0.5 shrink-0 bg-content-secondary/30" />
			)}
			<ContextMenuItem onSelect={startNavbarArrange}>
				<MoveIcon aria-hidden />
				Configure
			</ContextMenuItem>
		</>
	);
}

export function NavbarMoveMenu({
	children,
	label,
	actions,
}: {
	children: React.ReactElement;
	label: string;
	actions?: React.ReactNode;
}) {
	return (
		<ContextMenu modal={false}>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<BreadcrumbContextMenuContent aria-label={label}>
				{actions}
				<NavbarMoveOption divided={Boolean(actions)} />
			</BreadcrumbContextMenuContent>
		</ContextMenu>
	);
}
