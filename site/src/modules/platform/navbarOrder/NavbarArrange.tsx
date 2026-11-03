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
import { XIcon } from "lucide-react";
import {
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "#/components/Button/Button";
import {
	isNavbarItem,
	NAVBAR_ITEMS,
	type NavbarItem,
	onNavbarArrange,
	useNavbarOrder,
} from "./navbarOrder";

const LABELS: Record<NavbarItem, string> = {
	logo: "Logo",
	notifications: "Notifications",
	account: "Account",
	workspaces: "Workspaces",
	banner: "Announcement banner",
	// admins': the HUD joined to it (one split button)
	latency: "Latency and HUD",
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

/** Customizable toolbar with a palette for removed tiles. */
export const NavbarArrange: React.FC<NavbarArrangeProps> = ({
	items,
	className,
}) => {
	const { order, hidden, save, reset, commit, saving } = useNavbarOrder();
	const done = () => commit(() => setArranging(false));
	const escapeDone = useEffectEvent(done);
	const [arranging, setArranging] = useState(false);
	const toolbar = useRef<HTMLDivElement>(null);
	const controls = useRef<HTMLDivElement>(null);
	const doneButton = useRef<HTMLButtonElement>(null);
	const [navbarBottom, setNavbarBottom] = useState(0);
	const toggleArrange = useEffectEvent(() => {
		if (arranging) done();
		else setArranging(true);
	});
	const [announcement, setAnnouncement] = useState("");
	const visible = order.filter(
		(id) => items[id] !== null && !hidden.includes(id),
	);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
	);

	useEffect(() => onNavbarArrange(() => toggleArrange()), []);
	useLayoutEffect(() => {
		if (!arranging || !toolbar.current) return;
		const navbar =
			toolbar.current.closest<HTMLElement>(".navbar-soft") ?? toolbar.current;
		const previousFocus = document.activeElement;
		const previousLayer = navbar.style.zIndex;
		navbar.style.zIndex = "121";
		const measure = () =>
			setNavbarBottom(navbar.getBoundingClientRect().bottom);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(navbar);
		window.addEventListener("resize", measure);
		window.addEventListener("scroll", measure, { passive: true });
		// Keep both editing surfaces interactive while the rest of the dashboard is blurred.
		const disabled: { element: HTMLElement; inert: boolean }[] = [];
		let branch: HTMLElement | null = navbar;
		while (branch && branch !== document.body) {
			for (const sibling of branch.parentElement?.children ?? []) {
				if (
					sibling instanceof HTMLElement &&
					sibling !== branch &&
					!sibling.contains(controls.current)
				) {
					disabled.push({ element: sibling, inert: sibling.inert });
					sibling.inert = true;
				}
			}
			branch = branch.parentElement;
		}
		doneButton.current?.focus();
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure);
			navbar.style.zIndex = previousLayer;
			for (const { element, inert } of disabled) element.inert = inert;
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
				previousFocus.focus();
		};
	}, [arranging]);
	useEffect(() => {
		if (!arranging) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				escapeDone();
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
		save(
			order.map((item) => (!visible.includes(item) ? item : nextVisible[i++])),
		);
		setAnnouncement(
			`${LABELS[id]} moved to position ${to + 1} of ${visible.length}.`,
		);
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (
			over &&
			isNavbarItem(active.id) &&
			isNavbarItem(over.id) &&
			active.id !== over.id
		) {
			moveTo(active.id, over.id);
		}
	};

	return (
		<div
			ref={toolbar}
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
					{NAVBAR_ITEMS.filter((id) => visible.includes(id)).map((id) => (
						<ArrangeItem
							key={id}
							id={id}
							position={visible.indexOf(id)}
							arranging={arranging}
							onMove={(by) => {
								const over = visible[visible.indexOf(id) + by];
								if (over) {
									moveTo(id, over);
								}
							}}
							onDone={done}
							onRemove={() => save(order, [...hidden, id])}
						>
							{items[id]}
						</ArrangeItem>
					))}
				</SortableContext>
			</DndContext>
			{arranging &&
				createPortal(
					<div
						ref={controls}
						className="fixed inset-x-0 bottom-[var(--coder-classification-h,0px)] z-[120] flex items-center justify-center bg-black/25 p-4 backdrop-blur-md"
						style={{ top: navbarBottom }}
						onContextMenu={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
					>
						<div
							role="dialog"
							aria-label="Rearrange navigation bar"
							className="flex w-max max-w-full max-h-full overflow-y-auto flex-col gap-3 rounded-xl border border-solid border-border bg-surface-primary p-4 text-sm text-content-secondary shadow-xl"
							data-testid="navbar-arrange-hint"
						>
							<div className="flex flex-wrap items-center gap-3">
								<span>Drag to rearrange. Use × to remove.</span>
								<Button size="sm" variant="outline" onClick={reset}>
									Reset
								</Button>
								<Button
									ref={doneButton}
									size="sm"
									disabled={saving}
									onClick={done}
								>
									{saving ? "Saving…" : "Done"}
								</Button>
							</div>
							{hidden.some((id) => items[id] !== null) && (
								<div
									className="flex flex-wrap items-center gap-2"
									role="group"
									aria-label="Removed toolbar items"
								>
									<span>Restore:</span>
									{hidden
										.filter((id) => items[id] !== null)
										.map((id) => (
											<Button
												key={id}
												size="sm"
												variant="outline"
												aria-label={`Restore ${LABELS[id]}`}
												onClick={() =>
													save(
														order,
														hidden.filter((item) => item !== id),
													)
												}
											>
												{LABELS[id]}
											</Button>
										))}
								</div>
							)}
						</div>
					</div>,
					document.body,
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
	onMove: (by: number) => void;
	onDone: () => void;
	onRemove: () => void;
	children: React.ReactNode;
};

const ArrangeItem: React.FC<ArrangeItemProps> = ({
	id,
	position,
	arranging,
	onMove,
	onDone,
	onRemove,
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
					inert={arranging && !isBanner}
				>
					{children}
				</div>
			)}
			{arranging && !isBanner && (
				<>
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
					<button
						type="button"
						aria-label={`Remove ${LABELS[id]}`}
						onClick={onRemove}
						className="absolute -right-2 -top-2 z-20 flex size-6 cursor-pointer items-center justify-center rounded-[0.5rem] border-2 border-solid border-red-400 bg-red-700 p-0 text-white shadow-md hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-primary"
					>
						<XIcon aria-hidden className="size-4" strokeWidth={3} />
					</button>
				</>
			)}
		</div>
	);
};
