import {
	type CollisionDetection,
	closestCenter,
	DndContext,
	type DragEndEvent,
	type Modifier,
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
import { CheckIcon, ImageIcon, RotateCcwIcon, XIcon } from "lucide-react";
import {
	useEffect,
	useEffectEvent,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import type { NavbarLayout } from "#/api/platform";
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
	action: "Page action",
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

/** The navbar's zoom factor; pointer deltas are screen pixels, transforms are zoomed. */
const readZoom = (element: Element): number => {
	const zoom = Number.parseFloat(
		getComputedStyle(element).getPropertyValue("--navbar-zoom"),
	);
	return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
};

/** The arrangeable row the drag started in, found from the pointer or key event's target. */
const rowOfDrag: (args: Parameters<Modifier>[0]) => HTMLElement | null = ({
	activatorEvent,
}) =>
	activatorEvent?.target instanceof Element
		? activatorEvent.target.closest<HTMLElement>(
				'[data-testid="navbar-arrange"]',
			)
		: null;

/** Moves along x only, and keeps the dragged item inside the row it belongs to. */
export const restrictToRow =
	(row = rowOfDrag): Modifier =>
	(args) => {
		const { transform, draggingNodeRect } = args;
		const element = row(args);
		let x = transform.x;
		if (element && draggingNodeRect) {
			const bounds = element.getBoundingClientRect();
			const min = Math.min(0, bounds.left - draggingNodeRect.left);
			const max = Math.max(0, bounds.right - draggingNodeRect.right);
			x = Math.min(Math.max(x, min), max);
		}
		const zoom = element ? readZoom(element) : 1;
		return { ...transform, x: x / zoom, y: 0 };
	};

type NavbarArrangeProps = {
	/** Each item's content; null for one this user does not have (it is left out). */
	items: Record<NavbarItem, React.ReactNode | null>;
	className?: string;
	defaultLayout?: NavbarLayout;
	canSetDefault?: boolean;
};

/** Customizable toolbar with a palette for removed tiles. */
export const NavbarArrange: React.FC<NavbarArrangeProps> = ({
	items,
	className,
	defaultLayout,
	canSetDefault = false,
}) => {
	const { order, hidden, save, reset, publish, commit, saving } =
		useNavbarOrder(defaultLayout);
	const done = () => commit(() => setArranging(false));
	const escapeDone = useEffectEvent(done);
	const [arranging, setArranging] = useState(false);
	const toolbar = useRef<HTMLDivElement>(null);
	const controls = useRef<HTMLDivElement>(null);
	const headingId = useId();
	const doneButton = useRef<HTMLButtonElement>(null);
	const [navbarBottom, setNavbarBottom] = useState(0);
	const toggleArrange = useEffectEvent(() => {
		if (arranging) done();
		else setArranging(true);
	});
	const [announcement, setAnnouncement] = useState("");
	const available = order.filter(
		(id) => items[id] !== null || (arranging && id === "logo"),
	);
	const visible = available.filter((id) => !hidden.includes(id));
	const removed = hidden.filter((id) => available.includes(id));
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
	// The restore previews sit in a portal, outside the navbar's zoom: read it when arranging starts.
	const [previewZoom, setPreviewZoom] = useState(1);
	useEffect(() => {
		if (arranging && toolbar.current) {
			setPreviewZoom(readZoom(toolbar.current));
		}
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

	// What an item shows, in the navbar and in the restore previews alike.
	const itemContent = (id: NavbarItem) =>
		id === "logo" && items.logo === null ? (
			<span className="inline-flex h-10 items-center gap-2 rounded-md border border-dashed border-border px-2 text-xs text-content-secondary">
				<ImageIcon className="size-4" aria-hidden />
				Logo
			</span>
		) : (
			items[id]
		);

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
				modifiers={[restrictToRow()]}
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
							{itemContent(id)}
						</ArrangeItem>
					))}
				</SortableContext>
			</DndContext>
			{arranging &&
				createPortal(
					<div
						ref={controls}
						className="fixed inset-x-0 bottom-[var(--coder-classification-h,0px)] z-[120] flex items-center justify-center bg-black/25 p-2 backdrop-blur-md sm:p-8"
						style={{ top: navbarBottom }}
						onContextMenu={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
					>
						<div
							role="dialog"
							aria-labelledby={headingId}
							className="flex w-full max-w-5xl max-h-full flex-col overflow-y-auto rounded-xl border border-solid border-border bg-surface-primary text-sm text-content-secondary shadow-xl"
							data-testid="navbar-arrange-hint"
						>
							<div className="min-h-48 p-5 sm:p-10">
								<h2
									id={headingId}
									className="m-0 text-lg font-semibold text-content-primary"
								>
									Rearrange navigation bar
								</h2>
								{items.logo === null && (
									<p className="mb-0 mt-2">
										You can position the Logo tile here. Turn on Show logo in
										Settings › Appearance to display it.
									</p>
								)}
								<div
									className="mt-4 flex flex-wrap items-center gap-2"
									role="group"
									aria-label="Removed toolbar items"
								>
									{removed.length > 0 ? (
										<>
											<span className="w-full font-medium">Restore items</span>
											{removed.map((id) => (
												<button
													key={id}
													type="button"
													aria-label={`Restore ${LABELS[id]}`}
													title={`Restore ${LABELS[id]}`}
													className="flex cursor-pointer items-center rounded-lg border border-dashed border-border bg-transparent p-2 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-link"
													onClick={() =>
														save(
															order,
															hidden.filter((item) => item !== id),
														)
													}
												>
													{/* A live copy of the real control, at the navbar's zoom. */}
													<div
														aria-hidden
														inert
														className="pointer-events-none flex items-center"
														style={{ zoom: previewZoom }}
													>
														{itemContent(id)}
													</div>
												</button>
											))}
										</>
									) : (
										<span>All available items are on the navigation bar.</span>
									)}
								</div>
							</div>
							<footer className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-border p-4 sm:px-10 sm:py-5">
								<span className="mr-auto">
									Drag to rearrange. Use × to remove.
								</span>
								<div className="flex items-center gap-2">
									{canSetDefault && (
										<Button
											size="sm"
											variant="outline"
											disabled={saving}
											onClick={publish}
											title="Use this arrangement for everyone who has not saved a personal layout."
										>
											Set deployment default
										</Button>
									)}
									<Button
										size="sm"
										variant="outline"
										onClick={reset}
										title="Use the deployment default"
									>
										<RotateCcwIcon aria-hidden />
										Reset
									</Button>
									<Button
										ref={doneButton}
										size="sm"
										disabled={saving}
										onClick={done}
									>
										<CheckIcon aria-hidden />
										{saving ? "Saving…" : "Done"}
									</Button>
								</div>
							</footer>
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
					{id !== "action" && (
						<button
							type="button"
							aria-label={`Remove ${LABELS[id]}`}
							onClick={onRemove}
							className="absolute -right-2 -top-2 z-20 flex size-6 cursor-pointer items-center justify-center rounded-[0.5rem] border-2 border-solid border-red-400 bg-red-700 p-0 text-white shadow-md hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-primary"
						>
							<XIcon aria-hidden className="size-4" strokeWidth={3} />
						</button>
					)}
				</>
			)}
		</div>
	);
};
