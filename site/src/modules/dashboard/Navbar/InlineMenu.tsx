import { cn } from "cn";
import { ArrowRightIcon, PinIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";

/**
 * A Settings menu entry's options, opened in place under it: a right-click, the
 * context-menu key or Shift+F10 on the entry shows or hides them. Every entry of
 * the menu has them, so the mouse works the same everywhere: an entry with
 * nothing else to offer has "Open", which does what a click on it does.
 */
export function useInlineMenu({ arrowRight = false } = {}) {
	const [open, setOpen] = useState(false);
	const id = useId();
	const anchor = useRef<HTMLElement>(null);
	const close = useCallback(() => setOpen(false), []);
	const toggle = (event: React.SyntheticEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
		anchor.current = event.currentTarget;
		setOpen((previous) => !previous);
	};
	return {
		open,
		id,
		anchor,
		close,
		/** Spread on the entry (a DropdownMenuItem). */
		trigger: {
			"aria-expanded": open,
			"aria-controls": open ? id : undefined,
			onContextMenu: toggle,
			onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
				if (
					event.key === "ContextMenu" ||
					(event.shiftKey && event.key === "F10") ||
					(arrowRight && event.key === "ArrowRight")
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
	quickLinkMenu?: ReturnType<typeof useInlineMenu>;
	children: React.ReactNode;
}> = ({ id, label, className, quickLinkMenu, children }) => {
	const panel = useRef<HTMLDivElement>(null);
	const [pinned, setPinned] = useState(false);
	const close = quickLinkMenu?.close;
	const anchor = quickLinkMenu?.anchor;
	useEffect(() => {
		if (!close || pinned) return;
		const dismiss = (event: PointerEvent) => {
			if (!(event.target instanceof Node)) return;
			if (
				!panel.current?.contains(event.target) &&
				!anchor?.current?.contains(event.target)
			) {
				close();
			}
		};
		document.addEventListener("pointerdown", dismiss, true);
		return () => document.removeEventListener("pointerdown", dismiss, true);
	}, [anchor, close, pinned]);

	return (
		<div
			ref={panel}
			id={id}
			role="group"
			aria-label={label}
			className={cn(
				"my-1 w-full min-w-0 rounded-md border border-solid border-border p-1",
				quickLinkMenu
					? "bg-[color-mix(in_srgb,hsl(var(--surface-secondary))_91%,black)]"
					: "bg-surface-secondary",
				className,
			)}
		>
			{quickLinkMenu && (
				<div className="flex justify-end">
					<DropdownMenuItem
						role="menuitemcheckbox"
						aria-checked={pinned}
						aria-label="Keep submenu open"
						title={pinned ? "Unpin submenu" : "Pin submenu"}
						className={cn(
							"size-6 justify-center p-0",
							pinned && "text-content-link",
						)}
						onSelect={(event) => {
							event.preventDefault();
							setPinned((previous) => !previous);
						}}
					>
						<PinIcon aria-hidden className="size-3" />
					</DropdownMenuItem>
				</div>
			)}
			{children}
		</div>
	);
};

/** "Open": a link to the entry's page, or the entry's own action. */
export const OpenMenuItem: React.FC<
	{ label?: string } & ({ to: string } | { onOpen: () => void })
> = ({ label = "Open", ...props }) =>
	"to" in props ? (
		<DropdownMenuItem asChild>
			<Link to={props.to}>
				<ArrowRightIcon aria-hidden />
				{label}
			</Link>
		</DropdownMenuItem>
	) : (
		<DropdownMenuItem
			onSelect={(event) => {
				event.preventDefault();
				props.onOpen();
			}}
		>
			<ArrowRightIcon aria-hidden />
			{label}
		</DropdownMenuItem>
	);

/** An entry that opens a page, with "Open" (and any other options) on a right-click. */
export function MenuLabel({
	children,
	badge,
}: {
	children: string;
	badge?: React.ReactNode;
}) {
	return badge ? (
		<span className="inline-flex min-w-0 items-center gap-1.5">
			<span className="min-w-0 truncate">{children}</span>
			{badge}
		</span>
	) : (
		<span className="truncate">{children}</span>
	);
}

export const PageMenuItem: React.FC<{
	to: string;
	icon: React.ComponentType<{ "aria-hidden"?: boolean }>;
	label: string;
	labelBadge?: React.ReactNode;
	className?: string;
	/** Options after "Open". */
	options?: React.ReactNode;
	/** Where the options go in a row that wraps (order-last puts them under the whole row). */
	panelClassName?: string;
}> = ({
	to,
	icon: Icon,
	label,
	labelBadge,
	className,
	options,
	panelClassName,
}) => {
	const menu = useInlineMenu();
	return (
		<>
			<DropdownMenuItem asChild className={className} {...menu.trigger}>
				<Link to={to}>
					<Icon aria-hidden />
					<MenuLabel badge={labelBadge}>{label}</MenuLabel>
				</Link>
			</DropdownMenuItem>
			{menu.open && (
				<InlineMenuPanel
					id={menu.id}
					label={`${label} options`}
					className={panelClassName}
					quickLinkMenu={menu}
				>
					<OpenMenuItem to={to} />
					{options}
				</InlineMenuPanel>
			)}
		</>
	);
};
