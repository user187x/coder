import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "cn";
import { PinIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { NavLink } from "react-router";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import type { AdminPage } from "./adminQuickLinks";
import { DefaultViewOption } from "./DefaultViewOption";

import { type UnreadGlow, unreadRowClass } from "./useUnreadGlow";

/**
 * A quick link's right-click menu in the Settings sidebar's thin strip.
 */
const CompactQuickLinkMenu: React.FC<{
	link: AdminPage;
	/** The quick links' page IDs, in order. */
	ids: readonly string[];
	/** The pages available to add or replace. */
	others: readonly AdminPage[];
	onChange?: (ids: string[]) => void;
	children: React.ReactElement;
}> = ({ link, ids, others, onChange, children }) => {
	const [pinned, setPinned] = useState(false);
	return (
		<ContextMenu
			modal={false}
			onOpenChange={(open) => {
				if (!open) setPinned(false);
			}}
		>
			<ContextMenuTrigger
				asChild
				onContextMenu={(event) => event.stopPropagation()}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label={`${link.label} options`}
				className="z-[2147483647] max-h-[calc(70vh/var(--app-zoom,1))] overflow-y-auto bg-[color-mix(in_srgb,hsl(var(--surface-secondary))_91%,black)]"
				onContextMenu={(event) => event.stopPropagation()}
				onInteractOutside={(event) => {
					if (pinned) event.preventDefault();
				}}
			>
				<ContextMenuItem
					role="menuitemcheckbox"
					aria-checked={pinned}
					aria-label="Keep submenu open"
					title={pinned ? "Unpin submenu" : "Pin submenu"}
					className={cn(
						"ml-auto size-6 justify-center p-0",
						pinned && "text-content-link",
					)}
					onSelect={(event) => {
						event.preventDefault();
						setPinned((previous) => !previous);
					}}
				>
					<PinIcon aria-hidden className="size-3" />
				</ContextMenuItem>
				{onChange && others.length > 0 && (
					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<PlusIcon aria-hidden />
							Add
						</ContextMenuSubTrigger>
						<ContextMenuSubContent className="z-[2147483647] max-h-[calc(70vh/var(--app-zoom,1))] overflow-y-auto bg-[color-mix(in_srgb,hsl(var(--surface-secondary))_91%,black)]">
							{others.map((page) => (
								<ContextMenuItem
									key={page.id}
									onSelect={() =>
										onChange(
											ids.flatMap((id) =>
												id === link.id ? [id, page.id] : [id],
											),
										)
									}
								>
									<page.icon aria-hidden />
									{page.label}
								</ContextMenuItem>
							))}
						</ContextMenuSubContent>
					</ContextMenuSub>
				)}
				<DefaultViewOption path={link.path} context />
				{onChange && (
					<ContextMenuItem
						onSelect={() => onChange(ids.filter((id) => id !== link.id))}
					>
						<XIcon aria-hidden />
						Remove from quick links
					</ContextMenuItem>
				)}
				{onChange && others.length > 0 && (
					<>
						<ContextMenuSeparator />
						<ContextMenuGroup aria-label={`Replace ${link.label} with`}>
							<div className="px-2 py-1 text-xs text-content-secondary">
								Replace with
							</div>
							{others.map((page) => (
								<ContextMenuItem
									key={page.id}
									onSelect={() =>
										onChange(ids.map((id) => (id === link.id ? page.id : id)))
									}
								>
									<page.icon aria-hidden />
									{page.label}
								</ContextMenuItem>
							))}
						</ContextMenuGroup>
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
};

/**
 * The thin strip's quick links: each opens its page, has the right-click menu above, and a press
 * held a moment then dragged moves it, as the Settings menu's own list reorders.
 */
export const CompactQuickLinks: React.FC<{
	unreadGlow?: UnreadGlow;
	links: readonly AdminPage[];
	pages: readonly AdminPage[];
	onChange?: (ids: string[]) => void;
}> = ({ links, pages, onChange, unreadGlow }) => {
	const ids = links.map((link) => link.id);
	const others = pages.filter((page) => !ids.includes(page.id));
	// A short hold starts the drag, so a click still opens the link.
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { delay: 250, tolerance: 6 },
		}),
	);
	const dragged = useRef(false);
	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!onChange || !over || active.id === over.id) return;
		onChange(
			arrayMove(
				ids,
				ids.indexOf(String(active.id)),
				ids.indexOf(String(over.id)),
			),
		);
	};
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			modifiers={[({ transform }) => ({ ...transform, x: 0 })]}
			onDragStart={() => {
				dragged.current = true;
			}}
			onDragEnd={onDragEnd}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				{links.map((link) => (
					<CompactSortable
						key={link.id}
						id={link.id}
						disabled={!onChange}
						dragged={dragged}
					>
						<CompactQuickLinkMenu
							link={link}
							ids={ids}
							others={others}
							onChange={onChange}
						>
							<DropdownMenuItem
								asChild
								className={cn(
									"settings-strip-key",
									unreadRowClass(link.id, unreadGlow),
								)}
							>
								<NavLink
									to={link.path}
									title={`${link.label}; right-click for quick-link options, hold to move`}
									aria-label={link.label}
								>
									<link.icon aria-hidden />
								</NavLink>
							</DropdownMenuItem>
						</CompactQuickLinkMenu>
					</CompactSortable>
				))}
			</SortableContext>
		</DndContext>
	);
};

const CompactSortable: React.FC<{
	id: string;
	disabled: boolean;
	/** Set when a drag starts: the click that ends it does not open the link. */
	dragged: React.RefObject<boolean>;
	children: React.ReactNode;
}> = ({ id, disabled, dragged, children }) => {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id, disabled });
	return (
		<div
			ref={setNodeRef}
			{...attributes}
			{...listeners}
			// the link inside keeps the keyboard; this wrapper only carries the drag
			tabIndex={-1}
			role="presentation"
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={isDragging ? "relative z-10 opacity-80" : undefined}
			onClickCapture={(event) => {
				if (!dragged.current) return;
				dragged.current = false;
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{children}
		</div>
	);
};
