import {
	closestCenter,
	DndContext,
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

export type HudPanel = {
	id: string;
	label: string;
	render: (handle: React.ReactNode) => React.ReactNode;
};

/** Pointer and keyboard ordering for both HUD graph sizes. */
export const HudSortableGrid = ({
	panels,
	onReorder,
	className,
}: {
	panels: HudPanel[];
	onReorder: (ids: string[]) => void;
	className: string;
}) => {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragEnd={({ active, over }) => {
				if (!over || active.id === over.id) return;
				const ids = panels.map((p) => p.id);
				onReorder(
					arrayMove(
						ids,
						ids.indexOf(String(active.id)),
						ids.indexOf(String(over.id)),
					),
				);
			}}
		>
			<SortableContext
				items={panels.map((p) => p.id)}
				strategy={rectSortingStrategy}
			>
				<div className={className}>
					{panels.map((panel) => (
						<SortablePanel key={panel.id} panel={panel} />
					))}
				</div>
			</SortableContext>
		</DndContext>
	);
};

const SortablePanel = ({ panel }: { panel: HudPanel }) => {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: panel.id });
	return (
		<div
			ref={setNodeRef}
			className="relative min-w-0"
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				zIndex: isDragging ? 10 : undefined,
			}}
		>
			{panel.render(
				<button
					ref={setActivatorNodeRef}
					type="button"
					{...attributes}
					{...listeners}
					aria-label={`Reorder ${panel.label}`}
					className="flex size-6 shrink-0 touch-none cursor-grab items-center justify-center rounded border-0 bg-transparent text-content-secondary hover:text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-content-link"
				>
					<GripVerticalIcon aria-hidden className="size-4" />
				</button>,
			)}
		</div>
	);
};
