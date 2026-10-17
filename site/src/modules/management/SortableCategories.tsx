import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "cn";
import { ArrowDownAZIcon, GripVerticalIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/Button/Button";

export type SidebarCategory = {
	/** The category's page ID (adminQuickLinks' IDs). */
	id: string;
	/** What it is sorted by alphabetically. */
	label: string;
	node: React.ReactNode;
};

/**
 * The categories in the user's order: those they placed, as they placed them,
 * then any they never placed (new ones, or ones their permissions just
 * allowed) alphabetically. Without an order, alphabetically.
 */
export const orderCategories = (
	categories: readonly SidebarCategory[],
	order: readonly string[],
): SidebarCategory[] => {
	const byLabel = [...categories].sort((a, b) =>
		a.label.localeCompare(b.label),
	);
	const placed = order
		.map((id) => byLabel.find((c) => c.id === id))
		.filter((c): c is SidebarCategory => c !== undefined);
	return [...placed, ...byLabel.filter((c) => !order.includes(c.id))];
};

type SortableCategoriesProps = {
	categories: readonly SidebarCategory[];
	/** The user's order (page IDs); empty: alphabetical. */
	order: readonly string[];
	/** The new order after a move, or [] for alphabetical. */
	onReorder: (ids: string[]) => void;
};

/**
 * Admin Controls' categories, which the admin can arrange: each has a handle
 * to drag it to another place (or, focused, the up and down arrow keys), and
 * the button above them lists them alphabetically again.
 */
export const SortableCategories: React.FC<SortableCategoriesProps> = ({
	categories,
	order,
	onReorder,
}) => {
	const ordered = orderCategories(categories, order);
	const ids = ordered.map((c) => c.id);
	const alphabetical = orderCategories(categories, []).map((c) => c.id);
	const isAlphabetical = ids.every((id, i) => id === alphabetical[i]);
	const [announcement, setAnnouncement] = useState("");
	// A pointer drag only starts after a short move, so a click on a category
	// still opens it.
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) {
			return;
		}
		const from = ids.indexOf(String(active.id));
		const to = ids.indexOf(String(over.id));
		if (from === -1 || to === -1) {
			return;
		}
		onReorder(arrayMove(ids, from, to));
		const label = ordered[from]?.label ?? String(active.id);
		setAnnouncement(`${label} moved to position ${to + 1} of ${ids.length}.`);
	};

	return (
		<>
			<div className="flex items-center justify-between pb-1 pl-3">
				<span className="text-xs font-medium text-content-secondary">
					Categories
				</span>
				<Button
					size="icon"
					variant="subtle"
					className="size-7"
					aria-label="List the categories alphabetically"
					title={
						isAlphabetical
							? "Listed alphabetically: drag a category's handle to move it"
							: "List the categories alphabetically"
					}
					disabled={isAlphabetical}
					onClick={() => {
						onReorder([]);
						setAnnouncement("Categories listed alphabetically.");
					}}
				>
					<ArrowDownAZIcon />
				</Button>
			</div>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[({ transform }) => ({ ...transform, x: 0 })]}
				onDragEnd={onDragEnd}
			>
				<SortableContext items={ids} strategy={verticalListSortingStrategy}>
					<div className="flex flex-col gap-1" data-testid="admin-categories">
						{ordered.map((category) => (
							<SortableCategory key={category.id} category={category} />
						))}
					</div>
				</SortableContext>
			</DndContext>
			<span className="sr-only" aria-live="polite">
				{announcement}
			</span>
		</>
	);
};

const SortableCategory: React.FC<{ category: SidebarCategory }> = ({
	category,
}) => {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: category.id });
	return (
		<div
			ref={setNodeRef}
			data-testid="admin-category"
			data-category={category.id}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				"group/category relative flex items-start",
				isDragging && "z-10 rounded-md bg-surface-secondary shadow-md",
			)}
		>
			<button
				ref={setActivatorNodeRef}
				type="button"
				aria-label={`Move ${category.label}`}
				title="Drag to move"
				className={cn(
					"mt-2 flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded border-0 bg-transparent p-0 text-content-disabled",
					"opacity-40 transition-opacity group-hover/category:opacity-100 focus-visible:opacity-100",
					isDragging && "cursor-grabbing opacity-100",
				)}
				{...attributes}
				{...listeners}
			>
				<GripVerticalIcon aria-hidden className="size-3.5" />
			</button>
			<div className="min-w-0 flex-1">{category.node}</div>
		</div>
	);
};
