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
import { GripVerticalIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import type { HideableMenuItem } from "./AdminSettings";
import { DefaultViewOption, DefaultViewOrb } from "./DefaultViewOption";
import { PageMenuItem } from "./InlineMenu";

/**
 * The Settings menu's rows after its quick links (the admin categories and its other pages), as the quick links: each
 * opens its page, and while pointed at (or holding the focus) shows a trash can that hides it under Controls and a
 * handle that moves it, by dragging or with Enter then the arrow keys.
 */
export const HideableMenuRows: React.FC<{
	items: readonly HideableMenuItem[];
	itemClassName?: string;
	onHide: (id: string) => void;
	onReorder: (ids: string[]) => void;
}> = ({ items, itemClassName, onHide, onReorder }) => {
	const ids = items.map((item) => item.id);
	const [moving, setMoving] = useState<string>();
	// A drag starts after a short move, so a click on the handle stays a click.
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
	);
	const move = (id: string, to: number) => {
		const from = ids.indexOf(id);
		if (from === -1 || to < 0 || to >= ids.length || to === from) return;
		onReorder(arrayMove(ids, from, to));
	};
	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (over && active.id !== over.id) {
			move(String(active.id), ids.indexOf(String(over.id)));
		}
	};
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			modifiers={[({ transform }) => ({ ...transform, x: 0 })]}
			onDragEnd={onDragEnd}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				{items.map((item, index) => (
					<HideableRow
						key={item.id}
						item={item}
						itemClassName={itemClassName}
						moving={moving === item.id}
						onHide={() => {
							setMoving(undefined);
							onHide(item.id);
						}}
						onToggleMoving={() =>
							setMoving((now) => (now === item.id ? undefined : item.id))
						}
						onStopMoving={() => setMoving(undefined)}
						onMove={(by) => move(item.id, index + by)}
					/>
				))}
			</SortableContext>
		</DndContext>
	);
};

const HideableRow: React.FC<{
	item: HideableMenuItem;
	itemClassName?: string;
	moving: boolean;
	onHide: () => void;
	onToggleMoving: () => void;
	onStopMoving: () => void;
	onMove: (by: number) => void;
}> = ({
	item,
	itemClassName,
	moving,
	onHide,
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
	} = useSortable({ id: item.id });
	const shown = moving || isDragging;
	return (
		<div
			ref={setNodeRef}
			data-testid="admin-quick-link"
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				"group/quick flex flex-wrap items-center rounded-full transition-[box-shadow,background-color]",
				"hover:bg-surface-secondary/60 hover:ring-1 hover:ring-border focus-within:ring-1 focus-within:ring-border",
				isDragging && "relative z-10 bg-surface-secondary shadow-md",
			)}
		>
			<PageMenuItem
				to={item.path}
				icon={item.icon}
				label={item.label}
				className={cn("min-w-0 flex-1", itemClassName)}
				panelClassName="order-last"
				options={
					<>
						{item.options}
						<DefaultViewOption path={item.path} />
					</>
				}
			/>
			<DefaultViewOrb path={item.path} />
			<DropdownMenuItem
				aria-label={`Hide ${item.label} under Controls`}
				title="Hide under Controls"
				className={cn(
					"flex-none px-2 text-content-secondary hover:text-content-destructive focus:text-content-destructive",
					!shown &&
						"invisible group-hover/quick:visible group-focus-within/quick:visible",
				)}
				onSelect={(event) => {
					// Stay open, so several can be hidden in a row.
					event.preventDefault();
					onHide();
				}}
			>
				<Trash2Icon aria-hidden />
			</DropdownMenuItem>
			<DropdownMenuItem
				ref={setActivatorNodeRef}
				aria-label={`Reorder ${item.label}`}
				title="Drag to reorder"
				className={cn(
					"flex-none touch-none px-1 text-content-secondary",
					!shown &&
						"invisible group-hover/quick:visible group-focus-within/quick:visible",
					isDragging ? "cursor-grabbing" : "cursor-grab",
					moving &&
						"bg-surface-secondary text-content-primary ring-1 ring-content-link",
				)}
				{...listeners}
				onSelect={(event) => event.preventDefault()}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onToggleMoving();
						return;
					}
					if (!moving) return;
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
