import { cn } from "cn";
import {
	ArrowUpRightIcon,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	LayoutGridIcon,
	MonitorIcon,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "react-query";
import { Link } from "react-router";
import { workspaces } from "#/api/queries/workspaces";
import type { Workspace, WorkspaceAgent } from "#/api/typesGenerated";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { getLatencyColor } from "#/utils/latency";
import "./workspacesLatency.css";

/** How often the list asks again while the menu is open. */
export const REFRESH_MS = 3000;
/** How long a press lasts before the list locks open (the ring round the pill drawn all the way). */
export const HOLD_MS = 800;
/** An agent's latency as the workspace page shows it: its preferred region's, else the first. */
export const agentLatency = (agent: WorkspaceAgent): number | undefined => {
	const regions = Object.values(agent.latency ?? {});
	return (regions.find((r) => r.preferred) ?? regions[0])?.latency_ms;
};

/** A workspace's: its agents' best (a running workspace whose agents report none yet: undefined). */
export const workspaceLatency = (workspace: Workspace): number | undefined => {
	const values = workspace.latest_build.resources
		.flatMap((r) => r.agents ?? [])
		.map(agentLatency)
		.filter((v): v is number => typeof v === "number");
	return values.length ? Math.min(...values) : undefined;
};

/** At most this many chevrons each side of the pill's words while it is held (workspacesLatency.css). */
export const HOLD_CHEVRONS = 3;

/**
 * Hold to confirm, counted: chevrons each side of the pill's words, pointing at them, one more each third of the hold -
 * in step with the ring - so all three show as it locks; they stay while it is locked, and go when it is let go or
 * closed (workspacesLatency.css: the pill's data-hold).
 */
const HoldChevrons: React.FC<{ side: "left" | "right" }> = ({ side }) => {
	const Chevron = side === "left" ? ChevronRightIcon : ChevronLeftIcon;
	// the outermost first, so they close in on the words
	const order = Array.from({ length: HOLD_CHEVRONS }, (_, i) => i + 1);
	return (
		<span
			aria-hidden
			data-testid={`workspaces-pill-chevrons-${side}`}
			className={cn(
				"workspaces-pill-chevrons flex shrink-0 items-center",
				side === "right" && "flex-row-reverse",
			)}
		>
			{order.map((n) => (
				<Chevron
					key={n}
					className="workspaces-pill-chevron -mx-1 size-3.5"
					style={{ "--n": n } as React.CSSProperties}
				/>
			))}
		</span>
	);
};

/**
 * The template pills' colours: each template keeps one, wherever it shows. DEFAULT's is green; the others' are
 * none of green's neighbours (no lime or teal), to tell them from it at a glance.
 */
export const TEMPLATE_COLOURS = [
	"#22c55e",
	"#38bdf8",
	"#a78bfa",
	"#f59e0b",
	"#f472b6",
	"#fb923c",
	"#818cf8",
	"#e879f9",
	"#f87171",
] as const;

/** A template's colour, from its name: the same every time, everywhere; DEFAULT green, the others picked from the rest. */
export const templateColour = (name: string): string => {
	const key = name.trim().toUpperCase();
	if (key === "DEFAULT") {
		return TEMPLATE_COLOURS[0];
	}
	let hash = 0;
	for (const c of key) {
		hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
	}
	return TEMPLATE_COLOURS[1 + (hash % (TEMPLATE_COLOURS.length - 1))];
};

/** The template a workspace was made from (its display name, else its name), in a pill of the template's colour. */
export const TemplatePill: React.FC<{
	workspace: Workspace;
	className?: string;
}> = ({ workspace, className }) => {
	const name = workspace.template_display_name || workspace.template_name;
	if (!name) {
		return null;
	}
	const colour = templateColour(name);
	return (
		<span
			data-testid="workspace-template-pill"
			title={`Template: ${name}`}
			// cut short (whole on hover) rather than run past a narrow menu's edge
			className={cn(
				"min-w-0 max-w-[9rem] shrink truncate rounded-full border border-solid px-2 text-[11px] font-semibold leading-4",
				className,
			)}
			style={{
				color: colour,
				borderColor: `${colour}66`,
				backgroundColor: `${colour}1a`,
			}}
		>
			{name}
		</span>
	);
};

/**
 * The navigation bar's latency and Controls menu (ProxyMenu) starts with this: a Workspaces row - its icon, the word
 * and the number of the signed-in user's workspaces in one pill as wide as the menu, the number in a pill of its own.
 * Holding a mouse button (or a finger) down on it slides open the list of those workspaces, each with the latency to
 * it - its agent's, as on its page; one that is not running says so - and letting go, anywhere, slides it closed
 * again; letting go on a workspace opens its page. While the press lasts a ring is drawn round the pill's border (hold
 * to confirm); drawn all the way (HOLD_MS) it turns green and the list stays locked open until a press anywhere else
 * (or on the pill again). A double click locks it too. From the keyboard, Enter or Space opens and closes the list,
 * and the arrow keys walk into it. The list is asked again every few seconds while the menu is open. Each workspace
 * carries its template's name in a pill beside its own.
 *
 * Locked open, the list chooses workspaces for the grid (onOpenGrid, ProxyMenu's WorkspaceGrid): a workspace's row
 * ticks it (its arrow, at the end, still opens its page), and "View in a grid" under the list shows those chosen,
 * together. Each menu session starts with all workspaces selected.
 */
export const WorkspacesLatencyMenu: React.FC<{
	open: boolean;
	/** Shows the chosen workspaces (their ids) together: without it, the locked list chooses none. */
	onOpenGrid?: (ids: string[]) => void;
}> = ({ open, onOpenGrid }) => {
	const query = useQuery({
		...workspaces({ q: "owner:me" }),
		enabled: open,
		refetchInterval: open ? REFRESH_MS : false,
	});
	const list = query.data?.workspaces ?? [];
	const running = list.filter((w) => w.latest_build.status === "running");
	// How the list is open: for as long as a press lasts; locked (a press held through HOLD_MS, or a double click)
	// until a press elsewhere; or until the keyboard closes it.
	const [pressed, setPressed] = useState(false);
	const [locked, setLocked] = useState(false);
	const [keyboard, setKeyboard] = useState(false);
	const expanded = pressed || locked || keyboard;
	const selecting = locked && onOpenGrid !== undefined;
	const [selected, setSelected] = useState<string[]>();
	const chosen = list.filter(
		(w) => selected === undefined || selected.includes(w.id),
	);
	// Align template badges after the longest name, capped at 25 characters.
	const [nameWidth, setNameWidth] = useState<number>();
	const names = list.map((w) => w.name).join("\n");
	useLayoutEffect(() => {
		const spans = listRef.current?.querySelectorAll<HTMLElement>(
			"[data-workspace-name]",
		);
		if (!names || !spans?.length) {
			return;
		}
		let widest = 0;
		for (const span of spans) {
			const width = span.style.width;
			span.style.width = "max-content";
			widest = Math.max(widest, span.offsetWidth);
			span.style.width = width;
		}
		setNameWidth(widest > 0 ? widest : undefined);
	}, [names, selecting]);
	const toggle = (id: string) =>
		setSelected((ids) =>
			(ids ?? list.map((w) => w.id)).includes(id)
				? (ids ?? list.map((w) => w.id)).filter((i) => i !== id)
				: [...(ids ?? list.map((w) => w.id)), id],
		);
	const listId = useId();
	const listRef = useRef<HTMLDivElement>(null);
	const rowRef = useRef<HTMLDivElement>(null);
	const holdTimer = useRef<number | undefined>(undefined);
	// The pill's size, for its ring: drawn in pixels (SVG percentages there resolve unevenly across browsers).
	const pillRef = useRef<HTMLSpanElement>(null);
	const [pillSize, setPillSize] = useState({ w: 0, h: 0 });
	useLayoutEffect(() => {
		const pill = pillRef.current;
		if (!pill || typeof ResizeObserver === "undefined") {
			return;
		}
		const measure = () =>
			setPillSize({ w: pill.offsetWidth, h: pill.offsetHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(pill);
		return () => observer.disconnect();
	}, []);
	const stopHold = () => window.clearTimeout(holdTimer.current);

	// The menu closed: everything starts over.
	useEffect(() => {
		if (!open) {
			stopHold();
			setPressed(false);
			setLocked(false);
			setKeyboard(false);
			setSelected(undefined);
		}
	}, [open]);
	useEffect(() => stopHold, []);

	// Locked: a press anywhere but the list (and the pill, which unlocks it itself) lets go of it - in the menu, once
	// the press ends: the list sliding shut under it would otherwise bring another item under the pointer, which its
	// release would choose.
	useEffect(() => {
		if (!locked) {
			return;
		}
		const elsewhere = (event: Event) => {
			const target = event.target instanceof Node ? event.target : null;
			if (
				target &&
				(listRef.current?.contains(target) || rowRef.current?.contains(target))
			) {
				return;
			}
			if (target instanceof Element && target.closest("[role='menu']")) {
				document.addEventListener("pointerup", () => setLocked(false), {
					capture: true,
					once: true,
				});
				return;
			}
			setLocked(false);
		};
		document.addEventListener("pointerdown", elsewhere, true);
		return () => document.removeEventListener("pointerdown", elsewhere, true);
	}, [locked]);

	// A press keeps the list open until it ends, wherever the pointer is by then. Ending it on a workspace opens that
	// workspace (the menu's own press, move and release); on any other item of the menu it chooses nothing - the
	// release is stopped on its way down, before the menu's handlers see it.
	useEffect(() => {
		if (!pressed) {
			return;
		}
		const release = (event: Event) => {
			stopHold();
			setPressed(false);
			const target = event.target instanceof Element ? event.target : null;
			if (
				event.type === "pointerup" &&
				target?.closest("[role='menu']") &&
				!listRef.current?.contains(target)
			) {
				event.stopPropagation();
			}
		};
		document.addEventListener("pointerup", release, true);
		document.addEventListener("pointercancel", release, true);
		window.addEventListener("blur", release);
		return () => {
			document.removeEventListener("pointerup", release, true);
			document.removeEventListener("pointercancel", release, true);
			window.removeEventListener("blur", release);
		};
	}, [pressed]);

	return (
		<>
			<DropdownMenuItem
				ref={rowRef}
				data-testid="workspaces-latency"
				aria-expanded={expanded}
				aria-controls={listId}
				data-locked={locked || undefined}
				className="justify-center px-1 py-1"
				// The row opens nothing itself: the menu stays open.
				onSelect={(e) => e.preventDefault()}
				onPointerDown={(e) => {
					if (e.button !== 0) {
						return;
					}
					// A press on the locked pill unlocks it (and the list slides shut).
					if (locked) {
						setLocked(false);
						return;
					}
					setPressed(true);
					stopHold();
					holdTimer.current = window.setTimeout(() => setLocked(true), HOLD_MS);
				}}
				onDoubleClick={() => {
					stopHold();
					setLocked(true);
				}}
				onKeyDown={(e) => {
					if (e.key !== "Enter" && e.key !== " ") {
						return;
					}
					// Not a selection (that would be the menu's own click on the row).
					e.preventDefault();
					if (!e.repeat) {
						if (expanded) {
							setLocked(false);
							setKeyboard(false);
						} else {
							setKeyboard(true);
						}
					}
				}}
			>
				<span
					ref={pillRef}
					data-testid="workspaces-latency-pill"
					data-hold={locked ? "locked" : pressed ? "holding" : undefined}
					className="workspaces-pill relative flex w-full items-center justify-center gap-2 h-8 pl-3 pr-1.5 rounded-full border border-solid border-border bg-surface-primary text-content-primary"
					// the chevrons' timing, the ring's (HOLD_MS)
					style={{ "--hold": `${HOLD_MS}ms` } as React.CSSProperties}
				>
					{/* Hold to confirm: the ring drawn round the border while the press lasts, green once locked. */}
					<svg
						aria-hidden
						className="workspaces-pill-ring"
						// the pill's border box, unscaled: the ring's 2px line over the pill's 1px border
						viewBox={`0 0 ${pillSize.w} ${pillSize.h}`}
						preserveAspectRatio="none"
					>
						{pillSize.w > 0 && (
							<rect
								pathLength={100}
								x={1}
								y={1}
								width={pillSize.w - 2}
								height={pillSize.h - 2}
								rx={(pillSize.h - 2) / 2}
							/>
						)}
					</svg>
					<HoldChevrons side="left" />
					<MonitorIcon aria-hidden className="size-4 shrink-0" />
					Workspaces
					<span
						data-testid="workspaces-latency-count"
						title={query.data ? `${running.length} running` : undefined}
						className="inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded-full bg-surface-tertiary text-xs tabular-nums text-content-primary"
					>
						{query.data ? list.length : "…"}
					</span>
					{query.data && (
						<span className="sr-only">, {running.length} running</span>
					)}
					<HoldChevrons side="right" />
				</span>
			</DropdownMenuItem>
			<div
				ref={listRef}
				id={listId}
				data-testid="workspaces-latency-list"
				data-state={expanded ? "open" : "closed"}
				// Closed, its workspaces are out of reach (no focus, no screen reader) while it slides shut.
				inert={!expanded}
				className={cn(
					"grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
					expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="mx-1 my-1 rounded-md bg-surface-secondary p-1">
						{query.isLoading && (
							<DropdownMenuItem disabled>Loading…</DropdownMenuItem>
						)}
						{query.data && list.length === 0 && (
							<DropdownMenuItem disabled>No workspaces</DropdownMenuItem>
						)}
						{list.map((w) => {
							const up = w.latest_build.status === "running";
							const ms = up ? workspaceLatency(w) : undefined;
							const path = `/@${w.owner_name}/${w.name}`;
							const row = (
								<>
									<span
										aria-hidden
										className={cn(
											"size-2 shrink-0 rounded-full",
											up ? "bg-content-success" : "bg-content-disabled",
										)}
									/>
									<span
										data-workspace-name
										title={w.name}
										className={cn(
											// Keep template badges aligned while bounding long workspace names.
											"min-w-0 max-w-[25ch] shrink-0 truncate",
											!up && "text-content-secondary",
										)}
										style={{ width: nameWidth }}
									>
										{w.name}
									</span>
									<TemplatePill workspace={w} className="max-w-none shrink-0" />
									<span
										className={cn(
											"ml-auto shrink-0 text-xs tabular-nums",
											up ? getLatencyColor(ms) : "text-content-secondary",
										)}
									>
										{!up
											? w.latest_build.status
											: ms === undefined
												? "…"
												: `${Math.round(ms)}ms`}
									</span>
								</>
							);
							if (!selecting) {
								return (
									<DropdownMenuItem key={w.id} asChild>
										<Link
											to={path}
											data-testid={`workspace-latency-${w.name}`}
											className="flex min-w-0 items-center gap-2"
										>
											{row}
										</Link>
									</DropdownMenuItem>
								);
							}
							const ticked = chosen.some((workspace) => workspace.id === w.id);
							return (
								<div key={w.id} className="flex items-center gap-0.5">
									<DropdownMenuItem
										role="menuitemcheckbox"
										aria-checked={ticked}
										data-testid={`workspace-latency-${w.name}`}
										className="flex min-w-0 flex-1 items-center gap-2"
										// Ticks it; the menu stays open.
										onSelect={(e) => {
											e.preventDefault();
											toggle(w.id);
										}}
									>
										<span
											aria-hidden
											data-testid="workspace-grid-tick"
											className={cn(
												"flex size-4 shrink-0 items-center justify-center rounded-xs border border-solid",
												ticked
													? "border-surface-invert-primary bg-surface-invert-primary text-content-invert"
													: "border-border bg-surface-primary",
											)}
										>
											{ticked && (
												<CheckIcon className="size-3" strokeWidth={3} />
											)}
										</span>
										{row}
									</DropdownMenuItem>
									<DropdownMenuItem asChild className="shrink-0 px-1.5">
										<Link
											to={path}
											title={`Open ${w.name}`}
											aria-label={`Open ${w.name}`}
											data-testid={`workspace-open-${w.name}`}
										>
											<ArrowUpRightIcon aria-hidden className="size-4" />
										</Link>
									</DropdownMenuItem>
								</div>
							);
						})}
						{selecting && list.length > 0 && (
							<div className="mt-1 space-y-1 border-0 border-t border-solid border-border pt-1">
								<div className="flex items-center justify-center gap-2 text-[10px] text-content-secondary">
									<span
										title={`${chosen.length} selected of ${list.length} selectable`}
									>
										{chosen.length} : {list.length}
									</span>
									<DropdownMenuItem
										data-testid="workspace-grid-clear"
										className="min-h-0 rounded-full border border-solid border-border px-2 py-0.5 text-[10px]"
										onSelect={(e) => {
											e.preventDefault();
											setSelected([]);
										}}
									>
										Clear
									</DropdownMenuItem>
									<DropdownMenuItem
										data-testid="workspace-grid-all"
										className="min-h-0 rounded-full border border-solid border-border px-2 py-0.5 text-[10px]"
										onSelect={(e) => {
											e.preventDefault();
											setSelected(list.map((w) => w.id));
										}}
									>
										Select all
									</DropdownMenuItem>
								</div>
								<DropdownMenuItem
									data-testid="workspace-grid-view"
									disabled={chosen.length === 0}
									className="min-h-10 w-full justify-center gap-2 rounded-full border border-solid border-border bg-surface-secondary px-4 py-2 font-medium"
									onSelect={() => onOpenGrid?.(chosen.map((w) => w.id))}
								>
									<LayoutGridIcon aria-hidden className="size-4" />
									Grid View
								</DropdownMenuItem>
							</div>
						)}
					</div>
				</div>
			</div>
		</>
	);
};
