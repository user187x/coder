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
	horizontalListSortingStrategy,
	SortableContext,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "cn";
import { useEffect, useState } from "react";
import { Button } from "#/components/Button/Button";
import {
	NAVBAR_ITEMS,
	type NavbarItem,
	onNavbarArrange,
	useNavbarOrder,
} from "./navbarOrder";

const LABELS: Record<NavbarItem, string> = {
	workspaces: "Workspaces",
	banner: "Announcement banner",
	latency: "Latency",
	hud: "HUD",
};

// The banner placeholder is wide: the item under the pointer is the target.
const itemUnderPointer: CollisionDetection = (args) => {
	const under = pointerWithin(args);
	return under.length > 0 ? under : closestCenter(args);
};

type NavbarArrangeProps = {
	/** Each item's content; null for one this user does not have (it is left out). */
	items: Record<NavbarItem, React.ReactNode | null>;
	className?: string;
};

/**
 * The top bar's Workspaces menu, latency menu and HUD button, in the user's
 * order around the announcement banner. Right-clicking one of them (or the
 * user menu's "Rearrange top bar") starts arranging: they get a dashed
 * outline and can be dragged left or right (or moved with the arrow keys),
 * and the banner shows as a placeholder, so it is clear which side of it each
 * one ends up on. There are no empty places: items only swap. Done, Escape or
 * Enter ends it; Reset puts the default order back.
 */
export const NavbarArrange: React.FC<NavbarArrangeProps> = ({
	items,
	className,
}) => {
	const { order, save, reset } = useNavbarOrder();
	const [arranging, setArranging] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	const visible = order.filter((id) => items[id] !== null);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
	);

	useEffect(() => onNavbarArrange(() => setArranging(true)), []);
	useEffect(() => {
		if (!arranging) {
			return;
		}
		setAnnouncement(
			"Arranging the top bar. Drag the buttons, or focus one and use the left and right arrow keys. Press Escape when done.",
		);
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setArranging(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [arranging]);

	// Moves among the visible items; items this user does not have keep their place.
	const moveTo = (id: NavbarItem, over: NavbarItem) => {
		const from = visible.indexOf(id);
		const to = visible.indexOf(over);
		if (from === -1 || to === -1 || from === to) {
			return;
		}
		const nextVisible = arrayMove(visible, from, to);
		let i = 0;
		save(order.map((item) => (items[item] === null ? item : nextVisible[i++])));
		setAnnouncement(
			`${LABELS[id]} moved to position ${to + 1} of ${visible.length}.`,
		);
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (over && active.id !== over.id) {
			moveTo(active.id as NavbarItem, over.id as NavbarItem);
		}
	};

	return (
		<div
			className={cn(className)}
			data-testid="navbar-arrange"
			data-arranging={arranging || undefined}
		>
			<DndContext
				sensors={sensors}
				collisionDetection={itemUnderPointer}
				modifiers={[({ transform }) => ({ ...transform, y: 0 })]}
				onDragEnd={onDragEnd}
				accessibility={{
					screenReaderInstructions: {
						draggable:
							"Drag to move this button left or right, or use the left and right arrow keys.",
					},
					announcements: {
						onDragStart: ({ active }) =>
							`Picked up ${LABELS[active.id as NavbarItem]}.`,
						onDragOver: ({ active, over }) =>
							over
								? `${LABELS[active.id as NavbarItem]} is over ${LABELS[over.id as NavbarItem]}.`
								: `${LABELS[active.id as NavbarItem]} is not over a place.`,
						onDragEnd: ({ active, over }) =>
							over
								? `${LABELS[active.id as NavbarItem]} dropped in place of ${LABELS[over.id as NavbarItem]}.`
								: `${LABELS[active.id as NavbarItem]} dropped.`,
						onDragCancel: ({ active }) =>
							`Moving ${LABELS[active.id as NavbarItem]} was cancelled.`,
					},
				}}
			>
				<SortableContext
					items={visible}
					strategy={horizontalListSortingStrategy}
				>
					{/* A fixed order in the page (CSS order places them), so a moved button keeps the keyboard focus. */}
					{NAVBAR_ITEMS.filter((id) => items[id] !== null).map((id) => (
						<ArrangeItem
							key={id}
							id={id}
							position={visible.indexOf(id)}
							arranging={arranging}
							onStart={() => setArranging(true)}
							onMove={(by) => {
								const over = visible[visible.indexOf(id) + by];
								if (over) {
									moveTo(id, over);
								}
							}}
							onDone={() => setArranging(false)}
						>
							{items[id]}
						</ArrangeItem>
					))}
				</SortableContext>
			</DndContext>
			{arranging && (
				<div
					className="absolute left-1/2 top-full z-50 mt-2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-solid border-border bg-surface-primary py-1.5 pr-1.5 pl-4 text-sm text-content-secondary shadow-lg"
					data-testid="navbar-arrange-hint"
				>
					<span className="whitespace-nowrap">
						Drag the buttons to either side of the banner
					</span>
					<Button size="sm" variant="outline" onClick={reset}>
						Reset
					</Button>
					<Button size="sm" onClick={() => setArranging(false)}>
						Done
					</Button>
				</div>
			)}
			<div className="sr-only" aria-live="assertive" aria-atomic>
				{announcement}
			</div>
		</div>
	);
};

type ArrangeItemProps = {
	id: NavbarItem;
	position: number;
	arranging: boolean;
	onStart: () => void;
	onMove: (by: number) => void;
	onDone: () => void;
	children: React.ReactNode;
};

const ArrangeItem: React.FC<ArrangeItemProps> = ({
	id,
	position,
	arranging,
	onStart,
	onMove,
	onDone,
	children,
}) => {
	const isBanner = id === "banner";
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id,
		// The banner is not dragged: the buttons move around it.
		disabled: { draggable: isBanner || !arranging, droppable: !arranging },
	});

	return (
		<div
			ref={setNodeRef}
			data-navbar-item={id}
			style={{
				order: position,
				transform: CSS.Translate.toString(transform),
				transition,
			}}
			className={cn(
				"relative",
				isBanner ? "flex min-w-0 flex-1" : "shrink-0",
				isDragging && "z-20",
			)}
			onContextMenu={
				isBanner
					? undefined
					: (event) => {
							event.preventDefault();
							onStart();
						}
			}
		>
			{isBanner && arranging ? (
				// Where the announcement banner goes (it may be empty right now).
				<div
					className="flex h-10 min-w-28 flex-1 items-center justify-center rounded-md border-2 border-dashed border-border bg-surface-secondary/40 text-xs text-content-secondary select-none"
					data-testid="navbar-banner-ghost"
				>
					Announcement banner
				</div>
			) : (
				<div
					className={cn(
						"flex min-w-0 flex-1",
						arranging && "pointer-events-none opacity-90",
					)}
					aria-hidden={arranging && !isBanner ? true : undefined}
				>
					{children}
				</div>
			)}
			{arranging && !isBanner && (
				<button
					type="button"
					{...attributes}
					{...listeners}
					aria-label={`Move ${LABELS[id]}`}
					title="Drag left or right"
					className={cn(
						"absolute -inset-1 z-10 touch-none rounded-lg border-0 bg-transparent p-0",
						"outline outline-2 outline-dashed outline-content-link focus-visible:outline-solid",
						isDragging
							? "cursor-grabbing bg-surface-secondary/50"
							: "cursor-grab",
					)}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
							event.preventDefault();
							onMove(event.key === "ArrowLeft" ? -1 : 1);
						} else if (event.key === "Enter") {
							event.preventDefault();
							onDone();
						}
					}}
				/>
			)}
		</div>
	);
};
