import { cn } from "cn";
import {
	ArrowUpRightIcon,
	HandIcon,
	LayoutGridIcon,
	SquareIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "react-query";
import { useLocation, useNavigate } from "react-router";
import { workspaces } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { embedFrameAttributes } from "#/contexts/platformBoot";
import { TemplatePill } from "#/modules/platform/workspaceLatency/WorkspacesLatencyMenu";
import { WorkspaceTunnelPorts } from "../workspaceTunnels/WorkspaceTunnelPorts";
import { isEmbedSizeMessage } from "./embeddedSize";

/** Columns and rows in view at most: four dashboards; with more, the grid is dragged round to reach the others. */
export const IN_VIEW = 2;
/** A dashboard is drawn at least this wide and scaled down to its cell, so the page keeps its wide layout. */
export const FRAME_WIDTH = 1024;
/** How often the workspaces' names and states are asked again while the grid is open. */
export const REFRESH_MS = 5000;
const GAP = 72;
/** A cell's own bar: the workspace's name, its state and the way to its page. */
const BAR_HEIGHT = 44;
/** A press that moves less than this is a click (it picks the dashboard to use); further, it drags the grid. */
const DRAG_PX = 4;

/** The grid for n dashboards: one fills it, two side by side, three or four 2x2; more, as square as can be. */
export const gridLayout = (n: number): { cols: number; rows: number } => {
	if (n <= 1) {
		return { cols: 1, rows: 1 };
	}
	if (n === 2) {
		return { cols: 2, rows: 1 };
	}
	if (n <= IN_VIEW * IN_VIEW) {
		return { cols: 2, rows: 2 };
	}
	const cols = Math.ceil(Math.sqrt(n));
	return { cols, rows: Math.ceil(n / cols) };
};

const workspacePath = (w: Workspace) => `/@${w.owner_name}/${w.name}`;

/**
 * Fit all dashboards to the same viewport and scale, using the tallest reported
 * content height so every dashboard fits whole and remains evenly sized.
 */
export const frameFit = (
	cellW: number,
	frameH: number,
	contentHeights: readonly (number | undefined)[] = [],
): {
	width: number;
	height: number;
	scale: number;
	left: number;
	top: number;
} => {
	const width = Math.max(cellW, FRAME_WIDTH);
	const byWidth = cellW > 0 ? cellW / width : 1;
	const contentH = contentHeights.reduce<number>(
		(tallest, height) =>
			height !== undefined && Number.isFinite(height) && height > tallest
				? height
				: tallest,
		0,
	);
	// Leave room for rounding without introducing a scrollbar.
	const tall = contentH ? Math.ceil(contentH) + 2 : 0;
	const scale = tall && frameH > 0 ? Math.min(byWidth, frameH / tall) : byWidth;
	const height = tall || frameH / scale;
	return {
		width,
		height,
		scale,
		left: Math.max(0, (cellW - width * scale) / 2),
		top: 0,
	};
};

type WorkspaceGridProps = {
	/** The workspaces to show (their ids), in this order. */
	ids: readonly string[];
	canManageTunnels?: boolean;
	tunnelActorId?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Platform: several workspaces' dashboards at once (the Workspaces list's "View in a grid", ProxyMenu), in a window
 * over the page, the page blurred behind it. Each cell is the workspace's dashboard, live, in a frame of its own (an
 * embedded dashboard page: Workspace shows its dashboard alone, the rest of its page left behind, and tells its
 * height; a link out of it goes to this page), scaled to fit its cell's width and height and centred in it. Up to
 * four fill the window; with more, the cells keep that size and the grid is grabbed
 * and dragged round to reach the others (or scrolled) - the dashboards are then pictures to drag by until one is
 * clicked, which makes that one usable, the others still dragging the grid. Leaving to another page closes it.
 */
export const WorkspaceGrid: React.FC<WorkspaceGridProps> = ({
	ids,
	canManageTunnels = false,
	tunnelActorId,
	open,
	onOpenChange,
}) => {
	const query = useQuery({
		...workspaces({ q: "owner:me" }),
		enabled: open,
		refetchInterval: open ? REFRESH_MS : false,
	});
	const byId = new Map((query.data?.workspaces ?? []).map((w) => [w.id, w]));
	const shown = ids
		.map((id) => byId.get(id))
		.filter((w): w is Workspace => w !== undefined);
	const navigate = useNavigate();

	// A link out of a dashboard navigates this page: the grid makes way for it.
	const { pathname } = useLocation();
	const openedAt = useRef<string | null>(null);
	useEffect(() => {
		if (!open) {
			openedAt.current = null;
		} else if (openedAt.current === null) {
			openedAt.current = pathname;
		} else if (pathname !== openedAt.current) {
			onOpenChange(false);
		}
	}, [open, pathname, onOpenChange]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				data-testid="workspace-grid"
				aria-describedby={undefined}
				// over the floating chat bar too (z-60): it goes under the blur with the rest of the page
				overlayClassName="z-[70] backdrop-blur-md"
				className={cn(
					"z-[70] flex max-h-none max-w-none flex-col gap-0 overflow-hidden p-0",
					"w-[calc(100vw-48px)] h-[calc(100vh-2*var(--coder-classification-h,0px)-48px)]",
				)}
			>
				<GridBody
					shown={shown}
					canManageTunnels={canManageTunnels}
					tunnelActorId={tunnelActorId}
					loading={query.isLoading}
					navigate={navigate}
				/>
			</DialogContent>
		</Dialog>
	);
};

type GridBodyProps = {
	shown: readonly Workspace[];
	canManageTunnels: boolean;
	tunnelActorId?: string;
	loading: boolean;
	navigate: (to: string) => void;
	allowFocus?: boolean;
};

const GridBody: React.FC<GridBodyProps> = ({
	shown,
	canManageTunnels,
	tunnelActorId,
	loading,
	navigate,
	allowFocus = true,
}) => {
	const [focusedId, setFocusedId] = useState<string | null>(null);
	const focused = shown.find((workspace) => workspace.id === focusedId);
	const viewportRef = useRef<HTMLDivElement>(null);
	const [connecting, setConnecting] = useState(false);
	const [size, setSize] = useState({ w: 0, h: 0 });
	useLayoutEffect(() => {
		const el = viewportRef.current;
		if (!el || typeof ResizeObserver === "undefined") {
			return;
		}
		const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const { cols, rows } = gridLayout(shown.length);
	const inViewCols = Math.min(cols, IN_VIEW);
	const inViewRows = Math.min(rows, IN_VIEW);
	const cellW = Math.max(
		0,
		Math.floor((size.w - GAP * (inViewCols - 1)) / inViewCols),
	);
	const availableCellH = Math.max(
		0,
		Math.floor((size.h - GAP * (inViewRows - 1)) / inViewRows),
	);
	const pannable = cols > IN_VIEW || rows > IN_VIEW;
	// inside the cell's 1px border
	const frameW = Math.max(0, cellW - 2);
	const frameH = Math.max(0, availableCellH - BAR_HEIGHT - 14);

	// Each dashboard's height, as it tells it (its page in the frame: useReportEmbeddedSize).
	const frames = useRef(new Map<string, HTMLIFrameElement>());
	const [heights, setHeights] = useState<Record<string, number>>({});
	const fit = frameFit(
		frameW,
		frameH,
		shown.map((w) => heights[w.id]),
	);
	const focusFit = frameFit(
		Math.min(size.w, 1168),
		Math.max(0, size.h - 2 * BAR_HEIGHT - 40),
		[focused ? heights[focused.id] : undefined],
	);
	const cellH = Math.min(
		availableCellH,
		BAR_HEIGHT + 14 + Math.ceil(fit.height * fit.scale),
	);
	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (
				event.origin !== window.location.origin ||
				!isEmbedSizeMessage(event.data)
			) {
				return;
			}
			const { height } = event.data;
			for (const [id, frame] of frames.current) {
				if (frame.contentWindow === event.source) {
					setHeights((h) => (h[id] === height ? h : { ...h, [id]: height }));
				}
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	// The dashboard in use while the grid drags (the others are pictures to drag by), and the drag itself.
	const [active, setActive] = useState<string | null>(null);
	const [panning, setPanning] = useState(false);
	const drag = useRef<{
		x: number;
		y: number;
		left: number;
		top: number;
		moved: boolean;
		/** The dashboard pressed on (its id), if any: the release goes to the viewport, which holds the pointer. */
		shield: string | null;
	} | null>(null);

	const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		const viewport = viewportRef.current;
		if (
			!pannable ||
			!viewport ||
			e.button !== 0 ||
			(e.target instanceof Element && e.target.closest("a, button"))
		) {
			return;
		}
		drag.current = {
			x: e.clientX,
			y: e.clientY,
			left: viewport.scrollLeft,
			top: viewport.scrollTop,
			moved: false,
			shield:
				e.target instanceof Element
					? (e.target.closest<HTMLElement>("[data-grid-shield]")?.dataset
							.gridShield ?? null)
					: null,
		};
		viewport.setPointerCapture?.(e.pointerId);
	};
	const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		const viewport = viewportRef.current;
		if (!d || !viewport) {
			return;
		}
		const dx = e.clientX - d.x;
		const dy = e.clientY - d.y;
		if (!d.moved && Math.hypot(dx, dy) < DRAG_PX) {
			return;
		}
		if (!d.moved) {
			d.moved = true;
			setPanning(true);
		}
		viewport.scrollLeft = d.left - dx;
		viewport.scrollTop = d.top - dy;
	};
	const onPointerUp = () => {
		const d = drag.current;
		drag.current = null;
		setPanning(false);
		if (!d || d.moved) {
			return;
		}
		// A click: on a dashboard, that one is used; anywhere else, none is.
		setActive(d.shield);
	};

	return (
		<>
			<header className="flex items-center gap-3 border-0 border-b border-solid border-border px-4 py-3">
				<LayoutGridIcon aria-hidden className="size-5 text-content-secondary" />
				<DialogTitle className="text-base">
					Workspaces
					<span className="ml-2 text-sm font-normal text-content-secondary tabular-nums">
						{shown.length}
					</span>
				</DialogTitle>
				{pannable && (
					<span
						data-testid="workspace-grid-hint"
						className="flex items-center gap-1.5 text-sm text-content-secondary"
					>
						<HandIcon aria-hidden className="size-4" />
						Drag to see them all; click one to use it
					</span>
				)}
				<DialogClose
					aria-label="Close"
					className="ml-auto flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-content-secondary hover:bg-surface-secondary hover:text-content-primary"
				>
					<XIcon aria-hidden className="size-4" />
				</DialogClose>
			</header>
			<div
				ref={viewportRef}
				data-testid="workspace-grid-viewport"
				data-pannable={pannable || undefined}
				// Its scrollbars hidden: the hand (or the wheel, or the arrow keys) moves it.
				tabIndex={pannable ? 0 : undefined}
				className={cn(
					"relative min-h-0 flex-1 overflow-auto p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
					"m-3 focus-visible:outline-hidden",
					pannable && (panning ? "cursor-grabbing select-none" : "cursor-grab"),
				)}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={() => {
					drag.current = null;
					setPanning(false);
				}}
			>
				{loading && shown.length === 0 && (
					<p className="m-0 p-6 text-sm text-content-secondary">Loading…</p>
				)}
				{!loading && shown.length === 0 && (
					<p className="m-0 p-6 text-sm text-content-secondary">
						None of these workspaces is here any more.
					</p>
				)}
				{shown.length > 0 && (
					<div
						data-testid="workspace-grid-board"
						className="relative grid"
						style={{
							gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
							gridAutoRows: `${cellH}px`,
							gap: GAP,
							width: cols * cellW + (cols - 1) * GAP,
						}}
					>
						{allowFocus && (
							<WorkspaceTunnelPorts
								shown={shown}
								cols={cols}
								cellW={cellW}
								cellH={cellH}
								gap={GAP}
								portCenterY={
									BAR_HEIGHT + 1 + fit.top + (fit.height * fit.scale) / 2
								}
								canManage={canManageTunnels}
								actorId={tunnelActorId}
								onDragging={setConnecting}
							/>
						)}
						{shown.map((w) => {
							const up = w.latest_build.status === "running";
							const inUse = !pannable || active === w.id;
							return (
								<section
									key={w.id}
									data-testid={`workspace-grid-cell-${w.name}`}
									data-active={(pannable && active === w.id) || undefined}
									aria-label={w.name}
									className={cn(
										"flex flex-col overflow-hidden rounded-lg border border-solid border-border bg-surface-primary",
										pannable && active === w.id && "ring-2 ring-content-link",
									)}
								>
									<div
										className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-0 border-b border-solid border-border px-3 text-sm"
										style={{ height: BAR_HEIGHT }}
									>
										<span className="flex min-w-0 items-center gap-2 text-xs text-content-secondary">
											<span
												aria-hidden
												className={cn(
													"size-2 shrink-0 rounded-full",
													up ? "bg-content-success" : "bg-content-disabled",
												)}
											/>
											<span className="truncate">{w.latest_build.status}</span>
										</span>
										<span className="min-w-0 truncate font-medium text-content-primary">
											{w.name}
										</span>
										<div className="flex min-w-0 items-center justify-end gap-2">
											<TemplatePill workspace={w} />
											{allowFocus && (
												<Button
													variant="outline"
													size="icon"
													aria-label={`Focus ${w.name}`}
													title={`Focus ${w.name}`}
													onClick={() => setFocusedId(w.id)}
												>
													<SquareIcon aria-hidden />
												</Button>
											)}
											<Button
												variant="outline"
												size="icon"
												data-testid={`workspace-grid-open-${w.name}`}
												title={`Open ${w.name}`}
												aria-label={`Open ${w.name}`}
												onClick={() => navigate(workspacePath(w))}
											>
												<ArrowUpRightIcon aria-hidden />
											</Button>
										</div>
									</div>
									<div className="relative min-h-0 flex-1 overflow-hidden">
										<iframe
											ref={(frame) => {
												if (frame) {
													frames.current.set(w.id, frame);
												} else {
													frames.current.delete(w.id);
												}
											}}
											title={`${w.name} dashboard`}
											data-testid={`workspace-grid-frame-${w.name}`}
											src={workspacePath(w)}
											{...embedFrameAttributes(workspacePath(w))}
											className={cn(
												"absolute origin-top-left border-0 bg-transparent",
												(panning || connecting || !inUse) &&
													"pointer-events-none",
											)}
											style={{
												left: fit.left,
												top: fit.top,
												width: fit.width,
												height: fit.height,
												transform:
													fit.scale < 1 ? `scale(${fit.scale})` : undefined,
											}}
										/>
										{(connecting || !inUse) && (
											<div
												data-grid-shield={w.id}
												data-testid={`workspace-grid-shield-${w.name}`}
												title="Drag to look round the grid; click to use this workspace"
												className="absolute inset-0"
											/>
										)}
									</div>
								</section>
							);
						})}
					</div>
				)}
			</div>
			{allowFocus && (
				<Dialog
					open={Boolean(focused)}
					onOpenChange={(open) => {
						if (!open) setFocusedId(null);
					}}
				>
					<DialogContent
						aria-describedby={undefined}
						overlayClassName="z-[80] backdrop-blur-md"
						className="z-[80] flex max-h-none w-[calc(100vw-80px)] max-w-[1200px] flex-col gap-0 overflow-hidden p-0"
						style={{
							height: Math.min(
								size.h,
								2 * BAR_HEIGHT +
									40 +
									Math.ceil(focusFit.height * focusFit.scale),
							),
						}}
					>
						{focused && (
							<GridBody
								shown={[focused]}
								canManageTunnels={canManageTunnels}
								tunnelActorId={tunnelActorId}
								loading={false}
								navigate={navigate}
								allowFocus={false}
							/>
						)}
					</DialogContent>
				</Dialog>
			)}
		</>
	);
};
