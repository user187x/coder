import { cn } from "cn";
import {
	ArrowUpRightIcon,
	HandIcon,
	LayoutGridIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "react-query";
import { useLocation, useNavigate } from "react-router";
import { workspaces } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { embedFrameAttributes } from "#/contexts/platformBoot";
import { TemplatePill } from "#/modules/platform/workspaceLatency/WorkspacesLatencyMenu";

/** Columns and rows in view at most: four dashboards; with more, the grid is dragged round to reach the others. */
export const IN_VIEW = 2;
/** A dashboard is drawn at least this wide and scaled down to its cell, so the page keeps its wide layout. */
export const FRAME_WIDTH = 1280;
/** How often the workspaces' names and states are asked again while the grid is open. */
export const REFRESH_MS = 5000;
const GAP = 12;
/** A cell's own bar: the workspace's name, its state and the way to its page. */
const BAR_HEIGHT = 36;
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

type WorkspaceGridProps = {
	/** The workspaces to show (their ids), in this order. */
	ids: readonly string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Platform: several workspaces' dashboards at once (the Workspaces list's "View in a grid", ProxyMenu), in a window
 * over the page, the page blurred behind it. Each cell is the workspace's own page, live, in a frame of its own
 * (an embedded dashboard page: no navigation bar, classification bars or chat of its own; a link out of it goes to
 * this page), scaled to fit. Up to four fill the window; with more, the cells keep that size and the grid is grabbed
 * and dragged round to reach the others (or scrolled) - the dashboards are then pictures to drag by until one is
 * clicked, which makes that one usable, the others still dragging the grid. Leaving to another page closes it.
 */
export const WorkspaceGrid: React.FC<WorkspaceGridProps> = ({
	ids,
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
				overlayClassName="backdrop-blur-md"
				className={cn(
					"flex max-h-none max-w-none flex-col gap-0 overflow-hidden p-0",
					"w-[calc(100vw-48px)] h-[calc(100vh-2*var(--coder-classification-h,0px)-48px)]",
				)}
			>
				<GridBody shown={shown} loading={query.isLoading} navigate={navigate} />
			</DialogContent>
		</Dialog>
	);
};

type GridBodyProps = {
	shown: readonly Workspace[];
	loading: boolean;
	navigate: (to: string) => void;
};

const GridBody: React.FC<GridBodyProps> = ({ shown, loading, navigate }) => {
	const viewportRef = useRef<HTMLDivElement>(null);
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
	const cellH = Math.max(
		0,
		Math.floor((size.h - GAP * (inViewRows - 1)) / inViewRows),
	);
	const pannable = cols > IN_VIEW || rows > IN_VIEW;
	const frameH = Math.max(0, cellH - BAR_HEIGHT);
	const scale = cellW > 0 ? Math.min(1, cellW / FRAME_WIDTH) : 1;

	// The dashboard in use while the grid drags (the others are pictures to drag by), and the drag itself.
	const [active, setActive] = useState<string | null>(null);
	const [panning, setPanning] = useState(false);
	const drag = useRef<{
		x: number;
		y: number;
		left: number;
		top: number;
		moved: boolean;
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
	const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		drag.current = null;
		setPanning(false);
		if (!d || d.moved) {
			return;
		}
		// A click: on a dashboard, that one is used; anywhere else, none is.
		const cell =
			e.target instanceof Element
				? e.target.closest<HTMLElement>("[data-grid-shield]")
				: null;
		setActive(cell?.dataset.gridShield ?? null);
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
						className="grid"
						style={{
							gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
							gridAutoRows: `${cellH}px`,
							gap: GAP,
							width: cols * cellW + (cols - 1) * GAP,
						}}
					>
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
										className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-border px-3 text-sm"
										style={{ height: BAR_HEIGHT }}
									>
										<span
											aria-hidden
											className={cn(
												"size-2 shrink-0 rounded-full",
												up ? "bg-content-success" : "bg-content-disabled",
											)}
										/>
										<span className="truncate font-medium text-content-primary">
											{w.name}
										</span>
										<TemplatePill workspace={w} />
										<span className="shrink-0 text-xs text-content-secondary">
											{w.latest_build.status}
										</span>
										<button
											type="button"
											data-testid={`workspace-grid-open-${w.name}`}
											title={`Open ${w.name}`}
											aria-label={`Open ${w.name}`}
											className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-content-secondary hover:bg-surface-secondary hover:text-content-primary"
											onClick={() => navigate(workspacePath(w))}
										>
											<ArrowUpRightIcon aria-hidden className="size-4" />
										</button>
									</div>
									<div className="relative min-h-0 flex-1 overflow-hidden">
										<iframe
											title={`${w.name} dashboard`}
											data-testid={`workspace-grid-frame-${w.name}`}
											src={workspacePath(w)}
											{...embedFrameAttributes(workspacePath(w))}
											className={cn(
												"absolute left-0 top-0 origin-top-left border-0 bg-surface-primary",
												(panning || !inUse) && "pointer-events-none",
											)}
											style={{
												width: cellW / scale,
												height: frameH / scale,
												transform: scale < 1 ? `scale(${scale})` : undefined,
											}}
										/>
										{!inUse && (
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
		</>
	);
};
