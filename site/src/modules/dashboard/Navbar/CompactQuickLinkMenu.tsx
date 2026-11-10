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
import { useRef } from "react";
import { NavLink } from "react-router";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import type { AdminPage } from "./adminQuickLinks";

/**
 * A quick link's right-click menu in the Settings sidebar's thin strip: remove it from the quick links, or put another
 * page in its place. Without an editor (nothing to change) the link has no menu.
 */
const CompactQuickLinkMenu: React.FC<{
	link: AdminPage;
	/** The quick links' page IDs, in order. */
	ids: readonly string[];
	/** The pages that are not quick links, to put in its place. */
	others: readonly AdminPage[];
	onChange?: (ids: string[]) => void;
	children: React.ReactElement;
}> = ({ link, ids, others, onChange, children }) => {
	if (!onChange) return children;
	return (
		<ContextMenu>
			<ContextMenuTrigger
				asChild
				onContextMenu={(event) => event.stopPropagation()}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label={`${link.label} options`}
				className="z-[2147483647] max-h-[calc(70vh/var(--app-zoom,1))] overflow-y-auto"
				onContextMenu={(event) => event.stopPropagation()}
			>
				<ContextMenuItem
					onSelect={() => onChange(ids.filter((id) => id !== link.id))}
				>
					Remove from quick links
				</ContextMenuItem>
				{others.length > 0 && (
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
 * The thin strip's quick links: each opens its page (Chat opens the chat), has the right-click menu above, and a press
 * held a moment then dragged moves it, as the Settings menu's own list reorders.
 */
export const CompactQuickLinks: React.FC<{
	links: readonly AdminPage[];
	pages: readonly AdminPage[];
	onChange?: (ids: string[]) => void;
	onChat: () => void;
}> = ({ links, pages, onChange, onChat }) => {
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
							{link.id === "chat" ? (
								<DropdownMenuItem
									aria-label="Chat"
									title="Chat; right-click to remove or replace, hold to move"
									className="settings-strip-key"
									onSelect={(event) => {
										event.preventDefault();
										onChat();
									}}
								>
									<link.icon aria-hidden />
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem asChild className="settings-strip-key">
									<NavLink
										to={link.path}
										title={`${link.label}; right-click to remove or replace, hold to move`}
										aria-label={link.label}
									>
										<link.icon aria-hidden />
									</NavLink>
								</DropdownMenuItem>
							)}
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
