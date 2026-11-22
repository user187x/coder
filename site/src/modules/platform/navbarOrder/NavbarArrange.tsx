import {
	type CollisionDetection,
	DndContext,
	type DragEndEvent,
	type Modifier,
	PointerSensor,
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
import {
	CheckIcon,
	EyeOffIcon,
	ImageIcon,
	RotateCcwIcon,
	XIcon,
} from "lucide-react";
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
import { ContextMenuItem } from "#/components/ContextMenu/ContextMenu";
import { NavbarMoveMenu } from "#/modules/dashboard/Navbar/NavbarMoveMenu";
import { toCssPx } from "#/utils/appZoom";
import {
	isNavbarDivider,
	isNavbarItem,
	NAVBAR_DIVIDERS,
	NAVBAR_ITEMS,
	NAVBAR_LABELS,
	type NavbarControl,
	type NavbarItem,
	onNavbarArrange,
	SETTINGS_ITEM,
	useNavbarOrder,
	withSettingsAtEdge,
} from "./navbarOrder";

const sortableItems: readonly NavbarItem[] = [
	SETTINGS_ITEM,
	...NAVBAR_ITEMS,
	...NAVBAR_DIVIDERS,
];
const arrangeLabel = (id: string | number) =>
	isNavbarItem(id) ? NAVBAR_LABELS[id] : String(id);

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
	items: Record<NavbarControl, React.ReactNode | null>;
	className?: string;
	defaultLayout?: NavbarLayout;
	canSetDefault?: boolean;
	settings?: React.ReactNode;
	settingsRef?: React.Ref<HTMLDivElement>;
};

/** Customizable toolbar with a palette for removed tiles. */
export const NavbarArrange: React.FC<NavbarArrangeProps> = ({
	items,
	className,
	defaultLayout,
	canSetDefault = false,
	settings,
	settingsRef,
}) => {
	const {
		order,
		hidden,
		hide,
		save,
		reset,
		publish,
		commit,
		saving,
		settingsSide,
	} = useNavbarOrder(defaultLayout);
	const done = () => {
		if (!saving) commit(() => setArranging(false));
	};
	const finishArranging = useEffectEvent(done);
	const [arranging, setArranging] = useState(false);
	const toolbar = useRef<HTMLDivElement>(null);
	const controls = useRef<HTMLDivElement>(null);
	const dialog = useRef<HTMLDivElement>(null);
	const headingId = useId();
	const doneButton = useRef<HTMLButtonElement>(null);
	const [navbarBottom, setNavbarBottom] = useState(0);
	const toggleArrange = useEffectEvent(() => {
		if (arranging) done();
		else setArranging(true);
	});
	const [announcement, setAnnouncement] = useState("");
	const hasSettings = settings !== undefined;
	const ordered =
		hasSettings && !order.includes(SETTINGS_ITEM)
			? withSettingsAtEdge(order, settingsSide)
			: order;
	const available = ordered.filter((id) =>
		id === SETTINGS_ITEM
			? hasSettings
			: isNavbarDivider(id) ||
				items[id] !== null ||
				(arranging && id === "logo"),
	);
	const freeDivider = NAVBAR_DIVIDERS.find((id) => !order.includes(id));
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
		// Keep the palette below the raised toolbar, using the portal's coordinate scale.
		const measure = () =>
			setNavbarBottom(toCssPx(navbar.getBoundingClientRect().bottom));
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
				finishArranging();
			}
		};
		const onClickOutside = (event: MouseEvent) => {
			const target = event.target;
			if (
				!(target instanceof Node) ||
				dialog.current?.contains(target) ||
				toolbar.current?.closest(".navbar-soft")?.contains(target) ||
				toolbar.current?.contains(target)
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			finishArranging();
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("click", onClickOutside, true);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("click", onClickOutside, true);
		};
	}, [arranging]);

	// Moves among the visible items; items this user does not have keep their place.
	const moveTo = (id: NavbarItem, over: NavbarItem) => {
		const from = visible.indexOf(id);
		const to = visible.indexOf(over);
		if (from === -1 || to === -1 || from === to) {
			return;
		}
		const nextVisible = arrayMove(visible, from, to);
		let index = 0;
		const next = ordered.map((item) =>
			visible.includes(item) ? nextVisible[index++] : item,
		);
		const keepSettingsSlot =
			order.includes(SETTINGS_ITEM) ||
			next.indexOf(SETTINGS_ITEM) !== ordered.indexOf(SETTINGS_ITEM);
		save(
			keepSettingsSlot ? next : next.filter((item) => item !== SETTINGS_ITEM),
		);
		setAnnouncement(
			`${NAVBAR_LABELS[id]} moved to position ${to + 1} of ${visible.length}.`,
		);
	};

	// What an item shows, in the navbar and in the restore previews alike.
	const itemContent = (id: NavbarItem) =>
		isNavbarDivider(id) ? (
			<span
				className="h-8 w-0.5 rounded-full bg-content-secondary/60"
				aria-hidden
			/>
		) : id === SETTINGS_ITEM ? (
			<Button variant="outline" size="lg">
				{NAVBAR_LABELS[id]}
			</Button>
		) : id === "logo" && items.logo === null ? (
			<span className="inline-flex h-10 items-center gap-2 rounded-md border border-dashed border-border px-2 text-xs text-content-secondary">
				<ImageIcon className="size-4" aria-hidden />
				Logo
			</span>
		) : (
			items[id]
		);

	// Each tile's center divides the slots on either side. The pointer is the
	// reference even when dragging the wide banner or crossing a narrow gap.
	const slotUnderPointer: CollisionDetection = ({
		active,
		droppableRects,
		pointerCoordinates,
	}) => {
		if (!pointerCoordinates) return [];
		const position = visible.filter((id) => {
			const rect = droppableRects.get(id);
			return (
				id !== active.id &&
				rect &&
				pointerCoordinates.x > rect.left + rect.width / 2
			);
		}).length;
		const id = visible[position];
		return id ? [{ id }] : [];
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
			{hasSettings && (
				<div
					ref={settingsRef}
					data-testid="navbar-start"
					className="navbar-start flex shrink-0 items-center empty:hidden"
					style={{
						order: visible.indexOf(SETTINGS_ITEM),
						display: arranging ? "none" : undefined,
					}}
				>
					{settings}
				</div>
			)}
			<DndContext
				sensors={sensors}
				collisionDetection={slotUnderPointer}
				modifiers={[restrictToRow()]}
				onDragEnd={onDragEnd}
				accessibility={{
					screenReaderInstructions: {
						draggable:
							"Drag to move this button left or right, or use the left and right arrow keys.",
					},
					announcements: {
						onDragStart: ({ active }) =>
							`Picked up ${arrangeLabel(active.id)}.`,
						onDragOver: ({ active, over }) =>
							over
								? `${arrangeLabel(active.id)} is over ${arrangeLabel(over.id)}.`
								: `${arrangeLabel(active.id)} is not over a place.`,
						onDragEnd: ({ active, over }) =>
							over
								? `${arrangeLabel(active.id)} dropped in place of ${arrangeLabel(over.id)}.`
								: `${arrangeLabel(active.id)} dropped.`,
						onDragCancel: ({ active }) =>
							`Moving ${arrangeLabel(active.id)} was cancelled.`,
					},
				}}
			>
				<SortableContext
					items={visible}
					strategy={horizontalListSortingStrategy}
				>
					{/* A fixed order in the page (CSS order places them), so a moved button keeps the keyboard focus. */}
					{sortableItems
						.filter(
							(id) =>
								visible.includes(id) && (id !== SETTINGS_ITEM || arranging),
						)
						.map((id) => (
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
								onRemove={
									id === SETTINGS_ITEM || id === "banner"
										? undefined
										: () =>
												isNavbarDivider(id)
													? save(order.filter((item) => item !== id))
													: save(order, [...hidden, id])
								}
								onHide={
									!arranging &&
									!isNavbarDivider(id) &&
									visible.indexOf(id) > visible.indexOf("banner")
										? () => hide(id)
										: undefined
								}
								hideDisabled={saving}
							>
								{arranging && id === "action" && (
									<Button variant="outline" size="lg">
										{NAVBAR_LABELS.action}
									</Button>
								)}
								{itemContent(id)}
							</ArrangeItem>
						))}
				</SortableContext>
			</DndContext>
			{arranging &&
				createPortal(
					<div
						ref={controls}
						className="fixed inset-x-0 top-0 bottom-[var(--coder-classification-h,0px)] z-[120] flex items-center justify-center bg-black/25 p-(--arrange-padding) backdrop-blur-md [--arrange-padding:0.5rem] sm:[--arrange-padding:2rem]"
						style={{
							paddingTop: `calc(${navbarBottom}px + var(--arrange-padding))`,
						}}
						onContextMenu={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
					>
						<div
							ref={dialog}
							role="dialog"
							aria-labelledby={headingId}
							className="flex max-h-full w-full max-w-5xl flex-col rounded-[40px] border border-solid border-border bg-(--dashboard-panel-bg) p-3 text-sm text-content-secondary shadow-xl sm:p-5"
							data-testid="navbar-arrange-hint"
						>
							<div className="min-h-0 overflow-y-auto rounded-[28px] border border-solid border-border bg-surface-primary sm:rounded-[20px]">
								<div className="min-h-48 p-4 sm:p-5">
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
									<Button
										size="sm"
										variant="outline"
										className="mt-4"
										disabled={!freeDivider || saving}
										onClick={() => {
											if (freeDivider) save([...order, freeDivider]);
										}}
									>
										Add divider
									</Button>
									<div
										className="mt-4 flex flex-wrap items-center gap-2"
										role="group"
										aria-label="Removed toolbar items"
									>
										{removed.length > 0 ? (
											<>
												<span className="w-full font-medium">
													Restore items
												</span>
												{removed.map((id) => (
													<button
														key={id}
														type="button"
														aria-label={`Restore ${NAVBAR_LABELS[id]}`}
														title={`Restore ${NAVBAR_LABELS[id]}`}
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
															{id === "action"
																? NAVBAR_LABELS.action
																: itemContent(id)}
														</div>
													</button>
												))}
											</>
										) : (
											<span>
												All available items are on the navigation bar.
											</span>
										)}
									</div>
								</div>
								<footer className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-border p-4 sm:p-5">
									<span className="mr-auto">
										Drag to rearrange. Use × to remove.
									</span>
									<div className="flex flex-wrap items-center gap-2">
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

// The page action is portaled here, so its React events follow the page's tree.
const forwardActionContextMenu = (tile: HTMLDivElement | null) => {
	if (!tile) return;
	const forward = (event: MouseEvent) => {
		if (event.target === tile || event.defaultPrevented) return;
		event.preventDefault();
		tile.dispatchEvent(new MouseEvent("contextmenu", event));
	};
	tile.addEventListener("contextmenu", forward);
	return () => tile.removeEventListener("contextmenu", forward);
};

type ArrangeItemProps = {
	id: NavbarItem;
	position: number;
	arranging: boolean;
	onMove: (by: number) => void;
	onDone: () => void;
	onRemove?: () => void;
	onHide?: () => void;
	hideDisabled?: boolean;
	children: React.ReactNode;
};

const ArrangeItem: React.FC<ArrangeItemProps> = ({
	id,
	position,
	arranging,
	onMove,
	onDone,
	onRemove,
	onHide,
	hideDisabled,
	children,
}) => {
	const isBanner = id === "banner";
	const label = NAVBAR_LABELS[id];
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id,
		disabled: !arranging,
	});

	const tile = (
		<div
			ref={id === "action" && !arranging ? forwardActionContextMenu : undefined}
			className={cn(
				"flex min-w-0 flex-1",
				arranging && "pointer-events-none opacity-90",
			)}
			aria-hidden={arranging && !isBanner ? true : undefined}
			inert={arranging && !isBanner}
		>
			{children}
		</div>
	);

	return (
		<div
			ref={setNodeRef}
			data-navbar-item={id}
			data-navbar-divider={isNavbarDivider(id) || undefined}
			style={{
				order: position,
				transform: CSS.Translate.toString(transform),
				transition,
			}}
			className={cn(
				"relative",
				isBanner ? "flex min-w-0 flex-1" : "shrink-0",
				isNavbarDivider(id) && "flex items-center px-1",
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
			) : !arranging ? (
				<NavbarMoveMenu
					label={label}
					actions={
						onHide && (
							<ContextMenuItem disabled={hideDisabled} onSelect={onHide}>
								<EyeOffIcon aria-hidden />
								Hide
							</ContextMenuItem>
						)
					}
				>
					{tile}
				</NavbarMoveMenu>
			) : (
				tile
			)}
			{arranging && (
				<>
					<button
						type="button"
						{...attributes}
						{...listeners}
						data-navbar-arrange-control
						aria-label={`Move ${label}`}
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
					{onRemove && (
						<button
							type="button"
							data-navbar-arrange-control
							aria-label={`Remove ${arrangeLabel(id)}`}
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
