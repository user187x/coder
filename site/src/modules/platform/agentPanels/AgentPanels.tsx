import {
	type CollisionDetection,
	closestCenter,
	DndContext,
	type DragEndEvent,
	PointerSensor,
	pointerWithin,
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
import { GripVerticalIcon } from "lucide-react";
import { useState } from "react";
import "./agentPanels.css";

// Panels differ a lot in height (an embedded app is hundreds of pixels tall), so
// the panel under the pointer is the target, not the nearest centre.
const panelUnderPointer: CollisionDetection = (args) => {
	const under = pointerWithin(args);
	return under.length > 0 ? under : closestCenter(args);
};

export type PanelDefinition = {
	id: string;
	label: string;
	/** The panel, with its reorder handle to put in its header. */
	render: (handle: React.ReactNode) => React.ReactNode;
};

type AgentPanelsProps = {
	/** Every panel, in a fixed order (it never changes when they are moved). */
	panels: PanelDefinition[];
	/** The order they show in. */
	order: string[];
	onReorder: (order: string[]) => void;
	/** Shown over the top of the first panel (AddPanelTab). */
	addTab?: React.ReactNode;
};

/**
 * The agent card's drop-down panels, which the user can put in any order: drag
 * a panel by the handle at the left of its header, or focus the handle, press
 * Space (or Enter), move it with the arrow keys and press Space, Enter or
 * Escape to put it down.
 *
 * They are ordered with CSS (order), never moved in the page: moving an
 * embedded app's iframe would reload it.
 */
export const AgentPanels: React.FC<AgentPanelsProps> = ({
	panels,
	order,
	onReorder,
	addTab,
}) => {
	const [dragging, setDragging] = useState(false);
	// The panel being moved with the keyboard, if any.
	const [moving, setMoving] = useState<string>();
	const [announcement, setAnnouncement] = useState("");
	// A pointer drag only starts after a short move, so a click on the handle stays a click.
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
	);
	const label = (id: string | number) =>
		panels.find((panel) => panel.id === String(id))?.label ?? String(id);
	const position = (id: string | number) =>
		`position ${order.indexOf(String(id)) + 1} of ${order.length}`;

	const move = (id: string, by: number) => {
		const from = order.indexOf(id);
		const to = from + by;
		if (from === -1 || to < 0 || to >= order.length) {
			return;
		}
		onReorder(arrayMove(order, from, to));
		setAnnouncement(
			`The ${label(id)} panel moved to position ${to + 1} of ${order.length}.`,
		);
	};
	// Keyboard moving (the handle keeps the focus: the panels never move in the page).
	const onHandleKeyDown = (id: string, event: React.KeyboardEvent) => {
		if (moving !== id) {
			if (event.key === " " || event.key === "Enter") {
				event.preventDefault();
				setMoving(id);
				setAnnouncement(
					`Moving the ${label(id)} panel, ${position(id)}. Use the up and down arrow keys, then Space to put it down.`,
				);
			}
			return;
		}
		if (event.key === "ArrowUp" || event.key === "ArrowDown") {
			event.preventDefault();
			move(id, event.key === "ArrowUp" ? -1 : 1);
		} else if (
			event.key === " " ||
			event.key === "Enter" ||
			event.key === "Escape" ||
			event.key === "Tab"
		) {
			if (event.key !== "Tab") {
				event.preventDefault();
			}
			setMoving(undefined);
			setAnnouncement(
				`The ${label(id)} panel was put down at ${position(id)}.`,
			);
		}
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		setDragging(false);
		if (over && active.id !== over.id) {
			onReorder(
				arrayMove(
					order,
					order.indexOf(String(active.id)),
					order.indexOf(String(over.id)),
				),
			);
		}
	};

	return (
		<div
			className={cn(
				// Platform: no scrollbars in the panels (they still scroll by wheel, keys and touch): agentPanels.css
				"agent-panels relative flex flex-col",
				// The pointer must not disappear into an embedded app while dragging.
				dragging && "select-none [&_iframe]:pointer-events-none",
			)}
		>
			{addTab}
			<DndContext
				sensors={sensors}
				collisionDetection={panelUnderPointer}
				modifiers={[({ transform }) => ({ ...transform, x: 0 })]}
				onDragStart={() => setDragging(true)}
				onDragCancel={() => setDragging(false)}
				onDragEnd={onDragEnd}
				accessibility={{
					screenReaderInstructions: {
						draggable:
							"To move this panel, press Space or Enter, then the up and down arrow keys, then Space, Enter or Escape to put it down. With a pointer, drag the handle.",
					},
					announcements: {
						onDragStart: ({ active }) =>
							`Picked up the ${label(active.id)} panel, ${position(active.id)}.`,
						onDragOver: ({ active, over }) =>
							over
								? `The ${label(active.id)} panel is over ${position(over.id)}.`
								: `The ${label(active.id)} panel is no longer over a position.`,
						onDragEnd: ({ active, over }) =>
							over
								? `The ${label(active.id)} panel was dropped at ${position(over.id)}.`
								: `The ${label(active.id)} panel was dropped.`,
						onDragCancel: ({ active }) =>
							`Moving the ${label(active.id)} panel was cancelled.`,
					},
				}}
			>
				<SortableContext items={order} strategy={verticalListSortingStrategy}>
					{panels.map((panel) => (
						<SortablePanel
							key={panel.id}
							panel={panel}
							position={order.indexOf(panel.id)}
							moving={moving === panel.id}
							onHandleKeyDown={(event) => onHandleKeyDown(panel.id, event)}
							onHandleBlur={() => setMoving(undefined)}
						/>
					))}
				</SortableContext>
			</DndContext>
			<div className="sr-only" aria-live="assertive" aria-atomic>
				{announcement}
			</div>
		</div>
	);
};

type SortablePanelProps = {
	panel: PanelDefinition;
	position: number;
	/** Being moved with the keyboard. */
	moving: boolean;
	onHandleKeyDown: (event: React.KeyboardEvent) => void;
	onHandleBlur: () => void;
};

const SortablePanel: React.FC<SortablePanelProps> = ({
	panel,
	position,
	moving,
	onHandleKeyDown,
	onHandleBlur,
}) => {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: panel.id });

	const handle = (
		<button
			type="button"
			ref={setActivatorNodeRef}
			{...attributes}
			{...listeners}
			aria-pressed={moving}
			onKeyDown={onHandleKeyDown}
			onBlur={onHandleBlur}
			aria-label={`Reorder the ${panel.label} panel`}
			title="Drag to reorder"
			data-testid="panel-handle"
			className={cn(
				"relative z-[1] -ml-2 flex size-6 shrink-0 touch-none items-center justify-center rounded border-0 bg-transparent p-0",
				"text-content-secondary hover:text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-content-link",
				isDragging ? "cursor-grabbing" : "cursor-grab",
				moving &&
					"bg-surface-secondary text-content-primary ring-1 ring-content-link",
			)}
		>
			<GripVerticalIcon className="size-4" aria-hidden />
		</button>
	);

	return (
		<div
			ref={setNodeRef}
			data-panel={panel.id}
			style={{
				order: position,
				// No scaling: panels keep their size while moving.
				transform: CSS.Translate.toString(transform),
				transition,
			}}
			className={cn(
				isDragging && "relative z-20 bg-surface-primary shadow-lg",
				moving && "relative z-10 ring-1 ring-inset ring-content-link",
			)}
		>
			{panel.render(handle)}
		</div>
	);
};
