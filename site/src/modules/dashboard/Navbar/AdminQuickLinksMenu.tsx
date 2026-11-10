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
import {
	ChevronDownIcon,
	EyeIcon,
	GripVerticalIcon,
	PinIcon,
	Trash2Icon,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
	Collapsible,
	CollapsibleContent,
} from "#/components/Collapsible/Collapsible";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import "./adminQuickLinksMenu.css";
import { useChatEnabled } from "#/modules/platform/chat/useChatEnabled";
import type { HideableMenuItem } from "./AdminSettings";
import { AnnouncementMenuItem } from "./AnnouncementMenuItem";
import { AppearanceMenuItem } from "./AppearanceMenuItem";
import type { AdminPage } from "./adminQuickLinks";
import { ChatMenuItem } from "./ChatMenuItem";
import {
	InlineMenuPanel,
	OpenMenuItem,
	PageMenuItem,
	useInlineMenu,
} from "./InlineMenu";
import { SettingsDestinationMenu } from "./SettingsDestinationMenu";

type AdminQuickLinksMenuProps = {
	/** The quick links, in the user's order. */
	links: readonly AdminPage[];
	/** The pages that can still be added, in the order to offer them. */
	addable: readonly AdminPage[];
	/** The new list of page IDs, in order, after an add, remove or move. */
	onChange?: (ids: string[]) => void;
	admin?: boolean;
	itemClassName?: string;
	chatExpanded?: boolean;
	onChatToggle?: () => void;
	/** The menu's other items the user hid: listed under Controls, each with a button to show it again. */
	hiddenItems?: readonly HideableMenuItem[];
	/** More rows for the quick links' list, after the links: the menu's other items not hidden under Controls. */
	moreLinks?: React.ReactNode;
	onShowItem?: (id: string) => void;
};

/**
 * The Admin menu's quick links, editable in place: each row opens its page and
 * has a remove button and a drag handle, and the row after them adds a page.
 * Dragging the handle reorders; so do Enter (or Space) on the handle, then the
 * arrow keys, then Enter again. The menu stays open while editing.
 */
export const AdminQuickLinksMenu: React.FC<AdminQuickLinksMenuProps> = ({
	links,
	admin,
	addable,
	onChange,
	itemClassName,
	chatExpanded,
	onChatToggle,
	hiddenItems = [],
	onShowItem,
	moreLinks,
}) => {
	const [expanded, setExpanded] = useState(false);
	const chatOn = useChatEnabled();
	const choicesId = useId();
	const choices = addable.filter((page) => page.id !== "chat");
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
		onChange?.(arrayMove(ids, from, to));
		const label = links[from]?.label ?? id;
		setAnnouncement(`${label} moved to position ${to + 1} of ${ids.length}.`);
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (over && active.id !== over.id) {
			move(String(active.id), ids.indexOf(String(over.id)));
		}
	};

	const controlsMenu = useInlineMenu();
	// Open, the Controls list drops over whatever is below it, down to the Settings panel's bottom, and scrolls the rest:
	// the panel never grows for it.
	const controlsRoot = useRef<HTMLDivElement>(null);
	const [choicesMax, setChoicesMax] = useState<number>();
	useLayoutEffect(() => {
		const root = controlsRoot.current;
		const surface = root?.closest<HTMLElement>(".settings-menu-surface");
		if (!expanded || !root || !surface) return;
		const measure = () =>
			setChoicesMax(
				Math.max(
					96,
					Math.floor(
						surface.getBoundingClientRect().bottom -
							root.getBoundingClientRect().bottom -
							12,
					),
				),
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(surface);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [expanded]);
	const controlsChevron = (
		<span
			aria-hidden
			className="settings-controls-chevron inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-content-secondary/5 ring-1 ring-inset ring-content-secondary/15"
		>
			<ChevronDownIcon className={cn("size-3", expanded && "rotate-180")} />
		</span>
	);

	return (
		<>
			{/* The links scroll on their own, above Controls, which always stays in view */}
			<div
				className="admin-quick-links-scroll min-h-0 flex-1 overflow-y-auto"
				data-testid="quick-links-scroll"
			>
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
								admin={admin}
								editable={Boolean(onChange)}
								chatExpanded={chatExpanded}
								onChatToggle={onChatToggle}
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
									onChange?.(ids.filter((id) => id !== link.id));
									setAnnouncement(
										`${link.label} removed from the quick links.`,
									);
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
				{moreLinks}
			</div>

			<Collapsible
				ref={controlsRoot}
				open={expanded}
				onOpenChange={setExpanded}
				className="relative shrink-0"
			>
				<DropdownMenuItem
					{...controlsMenu.trigger}
					aria-expanded={expanded}
					data-settings-expanded={expanded}
					aria-controls={choicesId}
					className={cn(
						itemClassName,
						"settings-controls-bar my-1 rounded-full border border-solid border-border text-content-secondary focus:bg-surface-secondary",
					)}
					onSelect={(event) => {
						event.preventDefault();
						setExpanded(!expanded);
					}}
				>
					{controlsChevron}
					{/* The Controls glyph, drawn for the theme (light-controls.png, dark-controls.png); its name for
					    assistive technology */}
					<span className="flex flex-1 items-center justify-center">
						<img
							src="/light-controls.png"
							alt=""
							className="controls-glyph controls-glyph-light size-6"
						/>
						<img
							src="/dark-controls.png"
							alt=""
							className="controls-glyph controls-glyph-dark size-6"
						/>
						<span className="sr-only">Controls</span>
					</span>
					{controlsChevron}
				</DropdownMenuItem>
				{controlsMenu.open && (
					<InlineMenuPanel id={controlsMenu.id} label="Controls options">
						<OpenMenuItem
							label={expanded ? "Close" : "Open"}
							onOpen={() => {
								setExpanded(!expanded);
								controlsMenu.close();
							}}
						/>
					</InlineMenuPanel>
				)}
				<CollapsibleContent
					id={choicesId}
					className="admin-quick-link-choices settings-controls-overlay absolute inset-x-0 top-full z-50 overflow-hidden"
				>
					<div
						style={{ maxHeight: expanded ? choicesMax : undefined }}
						className="my-1 overflow-y-auto shadow-lg overscroll-contain rounded-lg border border-solid border-border bg-surface-secondary p-1 scrollbar-thin [scrollbar-color:hsl(var(--surface-quaternary))_transparent]"
					>
						{chatOn && (
							<div className="flex items-center">
								<ChatMenuItem
									className="min-w-0 flex-1"
									admin={admin}
									expanded={chatExpanded}
									onToggle={onChatToggle}
									onPin={
										onChange && addable.some((page) => page.id === "chat")
											? () => onChange([...ids, "chat"])
											: undefined
									}
								/>
								{onChange && addable.some((page) => page.id === "chat") && (
									<DropdownMenuItem
										aria-label="Add Chat to quick links"
										title="Add Chat to quick links"
										className="shrink-0"
										onSelect={(e) => {
											e.preventDefault();
											onChange([...ids, "chat"]);
											setAnnouncement("Chat added to the quick links.");
										}}
									>
										<PinIcon aria-hidden />
									</DropdownMenuItem>
								)}
							</div>
						)}
						{hiddenItems.map((item) => (
							<div key={item.id} className="flex flex-wrap items-center">
								<PageMenuItem
									to={item.path}
									icon={item.icon}
									label={item.label}
									className="min-w-0 flex-1"
									panelClassName="order-last"
									options={
										onShowItem && (
											<DropdownMenuItem
												onSelect={(event) => {
													event.preventDefault();
													onShowItem(item.id);
												}}
											>
												Show in the menu
											</DropdownMenuItem>
										)
									}
								/>
								{onShowItem && (
									<DropdownMenuItem
										aria-label={`Show ${item.label} in the menu`}
										title={`Show ${item.label}`}
										onSelect={(event) => {
											event.preventDefault();
											onShowItem(item.id);
											setAnnouncement(`${item.label} shown in the menu.`);
										}}
									>
										<EyeIcon aria-hidden />
									</DropdownMenuItem>
								)}
							</div>
						))}
						{onChange &&
							choices.map((page) => (
								<div key={page.id} className="flex flex-wrap items-center">
									<DestinationLink
										link={page}
										options={
											<DropdownMenuItem
												onSelect={(event) => {
													event.preventDefault();
													onChange([...ids, page.id]);
													setAnnouncement(
														`${page.label} added to the quick links.`,
													);
												}}
											>
												Add to quick links
											</DropdownMenuItem>
										}
									/>
									<DropdownMenuItem
										aria-label={`Add ${page.label} to quick links`}
										title={`Pin ${page.label}`}
										onSelect={(event) => {
											event.preventDefault();
											onChange([...ids, page.id]);
											setAnnouncement(
												`${page.label} added to the quick links.`,
											);
										}}
									>
										<PinIcon aria-hidden />
									</DropdownMenuItem>
								</div>
							))}
					</div>
				</CollapsibleContent>
			</Collapsible>

			<span className="sr-only" aria-live="polite">
				{announcement}
			</span>
		</>
	);
};

function DestinationLink({
	link,
	className,
	options,
}: {
	link: AdminPage;
	className?: string;
	/** Options after "Open" in its right-click menu. */
	options?: React.ReactNode;
}) {
	if (link.id === "workspaces" || link.id === "templates")
		return <SettingsDestinationMenu link={link} className={className} />;
	return (
		<PageMenuItem
			to={link.path}
			icon={link.icon}
			label={link.label}
			className={cn("min-w-0 flex-1", className)}
			options={options}
			panelClassName="order-last"
		/>
	);
}

type QuickLinkRowProps = {
	editable: boolean;
	admin?: boolean;
	link: AdminPage;
	itemClassName?: string;
	chatExpanded?: boolean;
	onChatToggle?: () => void;
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
	editable,
	admin,
	itemClassName,
	chatExpanded,
	onChatToggle,
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
	} = useSortable({ id: link.id, disabled: !editable });
	// Chat turned off for the deployment: its quick link is gone with it.
	const chatOn = useChatEnabled();
	if (link.id === "chat" && !chatOn) {
		return null;
	}

	return (
		<div
			ref={setNodeRef}
			data-testid="admin-quick-link"
			style={{
				// No scaling: rows keep their size while moving.
				transform: CSS.Translate.toString(transform),
				transition,
			}}
			// Pointed at (or holding the keyboard's focus): an oval round the row, and only then its remove and move
			// controls, so a link is removed or moved only from the row in hand.
			className={cn(
				"group/quick flex flex-wrap items-center rounded-full transition-[box-shadow,background-color]",
				editable &&
					"hover:bg-surface-secondary/60 hover:ring-1 hover:ring-border focus-within:ring-1 focus-within:ring-border",
				isDragging && "relative z-10 bg-surface-secondary shadow-md",
			)}
		>
			{link.id === "chat" ? (
				<ChatMenuItem
					admin={admin}
					expanded={chatExpanded}
					onToggle={onChatToggle}
					className={cn("min-w-0 flex-1", itemClassName)}
				/>
			) : link.id === "announcement" ? (
				<AnnouncementMenuItem className={cn("min-w-0 flex-1", itemClassName)} />
			) : link.id === "customize" ? (
				<AppearanceMenuItem
					to={link.path}
					className={cn("min-w-0 flex-1", itemClassName)}
				/>
			) : (
				<DestinationLink
					link={link}
					className={itemClassName}
					options={
						editable && (
							<DropdownMenuItem
								onSelect={(event) => {
									event.preventDefault();
									onRemove();
								}}
							>
								Remove from quick links
							</DropdownMenuItem>
						)
					}
				/>
			)}
			{editable && (
				<>
					<DropdownMenuItem
						aria-label={`Remove ${link.label} from the quick links`}
						title="Remove"
						className={cn(
							"flex-none px-2 text-content-secondary hover:text-content-destructive focus:text-content-destructive",
							!(moving || isDragging) &&
								"invisible group-hover/quick:visible group-focus-within/quick:visible",
						)}
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
							!(moving || isDragging) &&
								"invisible group-hover/quick:visible group-focus-within/quick:visible",
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
				</>
			)}
		</div>
	);
};
