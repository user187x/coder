import { cn } from "cn";
import { useId, useState } from "react";
import { Link } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";

/**
 * A Settings menu entry's options, opened in place under it: a right-click, the
 * context-menu key or Shift+F10 on the entry shows or hides them. Every entry of
 * the menu has them, so the mouse works the same everywhere: an entry with
 * nothing else to offer has "Open", which does what a click on it does.
 */
export function useInlineMenu() {
	const [open, setOpen] = useState(false);
	const id = useId();
	const toggle = (event: React.SyntheticEvent) => {
		event.preventDefault();
		event.stopPropagation();
		setOpen((previous) => !previous);
	};
	return {
		open,
		id,
		close: () => setOpen(false),
		/** Spread on the entry (a DropdownMenuItem). */
		trigger: {
			"aria-expanded": open,
			"aria-controls": open ? id : undefined,
			onContextMenu: toggle,
			onKeyDown: (event: React.KeyboardEvent) => {
				if (
					event.key === "ContextMenu" ||
					(event.shiftKey && event.key === "F10")
				) {
					toggle(event);
				}
			},
		},
	};
}

export const InlineMenuPanel: React.FC<{
	id: string;
	label: string;
	className?: string;
	children: React.ReactNode;
}> = ({ id, label, className, children }) => (
	<div
		id={id}
		role="group"
		aria-label={label}
		className={cn(
			"my-1 w-full min-w-0 rounded-md border border-solid border-border bg-surface-secondary p-1",
			className,
		)}
	>
		{children}
	</div>
);

/** "Open": a link to the entry's page, or the entry's own action. */
export const OpenMenuItem: React.FC<
	{ label?: string } & ({ to: string } | { onOpen: () => void })
> = ({ label = "Open", ...props }) =>
	"to" in props ? (
		<DropdownMenuItem asChild>
			<Link to={props.to}>{label}</Link>
		</DropdownMenuItem>
	) : (
		<DropdownMenuItem
			onSelect={(event) => {
				event.preventDefault();
				props.onOpen();
			}}
		>
			{label}
		</DropdownMenuItem>
	);

/** An entry that opens a page, with "Open" (and any other options) on a right-click. */
export const PageMenuItem: React.FC<{
	to: string;
	icon: React.ComponentType<{ "aria-hidden"?: boolean }>;
	label: string;
	className?: string;
	/** Options after "Open". */
	options?: React.ReactNode;
	/** Where the options go in a row that wraps (order-last puts them under the whole row). */
	panelClassName?: string;
}> = ({ to, icon: Icon, label, className, options, panelClassName }) => {
	const menu = useInlineMenu();
	return (
		<>
			<DropdownMenuItem asChild className={className} {...menu.trigger}>
				<Link to={to}>
					<Icon aria-hidden />
					<span className="truncate">{label}</span>
				</Link>
			</DropdownMenuItem>
			{menu.open && (
				<InlineMenuPanel
					id={menu.id}
					label={`${label} options`}
					className={panelClassName}
				>
					<OpenMenuItem to={to} />
					{options}
				</InlineMenuPanel>
			)}
		</>
	);
};
