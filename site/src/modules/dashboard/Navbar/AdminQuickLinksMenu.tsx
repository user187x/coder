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
import { GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import type { AdminPage } from "./adminQuickLinks";

type AdminQuickLinksMenuProps = {
	/** The quick links, in the user's order. */
	links: readonly AdminPage[];
	/** The pages that can still be added, in the order to offer them. */
	addable: readonly AdminPage[];
	/** The new list of page IDs, in order, after an add, remove or move. */
	onChange: (ids: string[]) => void;
	itemClassName?: string;
};

/**
 * The Admin menu's quick links, editable in place: each row opens its page and
 * has a remove button and a drag handle, and the row after them adds a page.
 * Dragging the handle reorders; so do Enter (or Space) on the handle, then the
 * arrow keys, then Enter again. The menu stays open while editing.
 */
export const AdminQuickLinksMenu: React.FC<AdminQuickLinksMenuProps> = ({
	links,
	addable,
	onChange,
	itemClassName,
}) => {
	const ids = links.map((link) => link.id);
	// The page being moved with the keyboard, if any.
	const [moving, setMoving] = useState<string>();
	const [announcement, setAnnouncement] = useState("");
	const handles = useRef(new Map<string, HTMLElement>());
	// A pointer drag only starts after a short move, so a click on the handle
	// stays a click.
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
	);

	// Moving a row re-renders it in its new place; keep the keyboard on its handle.
	useEffect(() => {
		if (moving) {
			handles.current.get(moving)?.focus();
		}
	}, [moving, links]);

	const move = (id: string, to: number) => {
		const from = ids.indexOf(id);
		if (from === -1 || to < 0 || to >= ids.length || to === from) {
			return;
		}
		onChange(arrayMove(ids, from, to));
		const label = links[from]?.label ?? id;
		setAnnouncement(`${label} moved to position ${to + 1} of ${ids.length}.`);
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (over && active.id !== over.id) {
			move(String(active.id), ids.indexOf(String(over.id)));
		}
	};

	return (
		<>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[({ transform }) => ({ ...transform, x: 0 })]}
				onDragEnd={onDragEnd}
			>
				<SortableContext items={ids} strategy={verticalListSortingStrategy}>
					{links.map((link, index) => (
						<QuickLinkRow
							key={link.id}
							link={link}
							itemClassName={itemClassName}
							moving={moving === link.id}
							handleRef={(node) => {
								if (node) {
									handles.current.set(link.id, node);
								} else {
									handles.current.delete(link.id);
								}
							}}
							onRemove={() => {
								setMoving(undefined);
								onChange(ids.filter((id) => id !== link.id));
								setAnnouncement(`${link.label} removed from the quick links.`);
							}}
							onToggleMoving={() => {
								const next = moving === link.id ? undefined : link.id;
								setMoving(next);
								setAnnouncement(
									next
										? `Moving ${link.label}, position ${index + 1} of ${ids.length}. Use the up and down arrow keys, then Enter.`
										: `${link.label} dropped at position ${index + 1} of ${ids.length}.`,
								);
							}}
							onStopMoving={() => setMoving(undefined)}
							onMove={(by) => move(link.id, index + by)}
						/>
					))}
				</SortableContext>
			</DndContext>

			{addable.length > 0 && (
				<DropdownMenuSub>
					<DropdownMenuSubTrigger
						aria-label="Add a quick link"
						title="Add a quick link"
						className={cn("text-content-secondary", itemClassName)}
					>
						<PlusIcon aria-hidden />
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
						<DropdownMenuLabel>Add a quick link</DropdownMenuLabel>
						{addable.map((page) => (
							<DropdownMenuItem
								key={page.id}
								onSelect={(event) => {
									// Stay open, so several pages can be added in a row.
									event.preventDefault();
									onChange([...ids, page.id]);
									setAnnouncement(`${page.label} added to the quick links.`);
								}}
							>
								{page.label}
							</DropdownMenuItem>
						))}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			)}

			<span className="sr-only" aria-live="polite">
				{announcement}
			</span>
		</>
	);
};

type QuickLinkRowProps = {
	link: AdminPage;
	itemClassName?: string;
	moving: boolean;
	handleRef: (node: HTMLElement | null) => void;
	onRemove: () => void;
	onToggleMoving: () => void;
	onStopMoving: () => void;
	/** Moves the row by this many places (-1 up, 1 down). */
	onMove: (by: number) => void;
};

const QuickLinkRow: React.FC<QuickLinkRowProps> = ({
	link,
	itemClassName,
	moving,
	handleRef,
	onRemove,
	onToggleMoving,
	onStopMoving,
	onMove,
}) => {
	const {
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: link.id });

	return (
		<div
			ref={setNodeRef}
			data-testid="admin-quick-link"
			style={{
				// No scaling: rows keep their size while moving.
				transform: CSS.Translate.toString(transform),
				transition,
			}}
			className={cn(
				"flex items-center",
				isDragging && "relative z-10 rounded-md bg-surface-secondary shadow-md",
			)}
		>
			<DropdownMenuItem asChild className={cn("min-w-0 flex-1", itemClassName)}>
				<Link to={link.path}>
					<span className="truncate">{link.label}</span>
				</Link>
			</DropdownMenuItem>
			<DropdownMenuItem
				aria-label={`Remove ${link.label} from the quick links`}
				title="Remove"
				className="flex-none px-2 text-content-secondary hover:text-content-destructive focus:text-content-destructive"
				onSelect={(event) => {
					// Stay open, so several links can be removed in a row.
					event.preventDefault();
					onRemove();
				}}
			>
				<Trash2Icon aria-hidden />
			</DropdownMenuItem>
			<DropdownMenuItem
				ref={(node) => {
					setActivatorNodeRef(node);
					handleRef(node);
				}}
				aria-label={`Reorder ${link.label}`}
				title="Drag to reorder"
				className={cn(
					"flex-none touch-none px-1 text-content-secondary",
					isDragging ? "cursor-grabbing" : "cursor-grab",
					moving &&
						"bg-surface-secondary text-content-primary ring-1 ring-content-link",
				)}
				{...listeners}
				// A click on the handle does nothing (and keeps the menu open).
				onSelect={(event) => event.preventDefault()}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onToggleMoving();
						return;
					}
					if (!moving) {
						return;
					}
					// While moving, the arrows move this row instead of the menu's focus.
					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault();
						event.stopPropagation();
						onMove(event.key === "ArrowUp" ? -1 : 1);
					} else if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						onStopMoving();
					}
				}}
			>
				<GripVerticalIcon aria-hidden />
			</DropdownMenuItem>
		</div>
	);
};
