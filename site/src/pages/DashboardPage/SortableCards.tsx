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
	rectSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { createContext, useContext, useState } from "react";

type CardHandle = {
	/** For the card's header: a pointer drags the card by it. */
	headerProps: React.ComponentProps<"header">;
	dragging: boolean;
	/** The keyboard's way to move it: a grip button for the header (Space, the arrow keys, Space). */
	grip: (title: string) => React.ReactNode;
};

/** The drag handle of the card being rendered (its header), for DashboardCard. */
const CardHandleContext = createContext<CardHandle | null>(null);

export const useCardHandle = () => useContext(CardHandleContext);

export type SortableCard = { id: string; label: string; node: React.ReactNode };

/** The cards in the user's order: saved ones first as saved, the rest (new cards) after them as given. */
export const orderCards = (
	cards: readonly SortableCard[],
	order: readonly string[],
) => {
	const rank = new Map(order.map((id, i) => [id, i]));
	return [...cards].sort(
		(a, b) =>
			(rank.get(a.id) ?? order.length + cards.indexOf(a)) -
			(rank.get(b.id) ?? order.length + cards.indexOf(b)),
	);
};

const SortableItem: React.FC<{ card: SortableCard }> = ({ card }) => {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: card.id });
	return (
		<div
			ref={setNodeRef}
			data-dashboard-card={card.id}
			className={isDragging ? "relative z-10 opacity-80" : undefined}
			style={{
				transform: CSS.Translate.toString(transform),
				transition,
			}}
		>
			<CardHandleContext.Provider
				value={{
					headerProps: { ...listeners },
					dragging: isDragging,
					grip: (title) => (
						<button
							type="button"
							ref={setActivatorNodeRef}
							{...attributes}
							aria-label={`Move ${title}`}
							title="Drag the card's header to move it"
							className="-mr-2 -ml-2 flex w-4 shrink-0 cursor-grab items-center justify-center border-0 bg-transparent p-0 text-content-secondary opacity-0 transition-opacity group-hover/handle:opacity-100 focus-visible:opacity-100"
						>
							<GripVerticalIcon aria-hidden className="size-4" />
						</button>
					),
				}}
			>
				{card.node}
			</CardHandleContext.Provider>
		</div>
	);
};

/**
 * The Dashboard's cards after Summary, moved by dragging a card by its header (or with the keyboard: focus the
 * header, Space, the arrow keys, Space). onReorder gets the new order of the card IDs.
 */
export const SortableCards: React.FC<{
	cards: readonly SortableCard[];
	onReorder: (ids: string[]) => void;
}> = ({ cards, onReorder }) => {
	const [announcement, setAnnouncement] = useState("");
	// A drag starts after a short move, so a click in the header still works.
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const ids = cards.map((c) => c.id);
	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = ids.indexOf(String(active.id));
		const to = ids.indexOf(String(over.id));
		if (from === -1 || to === -1) return;
		onReorder(arrayMove(ids, from, to));
		setAnnouncement(
			`${cards[from]?.label ?? active.id} moved to position ${to + 2} of ${ids.length + 1}.`,
		);
	};
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragEnd={onDragEnd}
		>
			<SortableContext items={ids} strategy={rectSortingStrategy}>
				{cards.map((card) => (
					<SortableItem key={card.id} card={card} />
				))}
			</SortableContext>
			<span className="sr-only" aria-live="polite">
				{announcement}
			</span>
		</DndContext>
	);
};
