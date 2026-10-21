import { cn } from "cn";
import { MonitorIcon } from "lucide-react";
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

/**
 * The navigation bar's latency and Controls menu (ProxyMenu) starts with this: a Workspaces row - its icon, the word
 * and the number of the signed-in user's workspaces in one pill as wide as the menu, the number in a pill of its own.
 * Holding a mouse button (or a finger) down on it slides open the list of those workspaces, each with the latency to
 * it - its agent's, as on its page; one that is not running says so - and letting go, anywhere, slides it closed
 * again; letting go on a workspace opens its page. While the press lasts a ring is drawn round the pill's border (hold
 * to confirm); drawn all the way (HOLD_MS) it turns green and the list stays locked open until a press anywhere else
 * (or on the pill again). A double click locks it too. From the keyboard, Enter or Space opens and closes the list,
 * and the arrow keys walk into it. The list is asked again every few seconds while the menu is open.
 */
export const WorkspacesLatencyMenu: React.FC<{ open: boolean }> = ({
	open,
}) => {
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
		}
	}, [open]);
	useEffect(() => stopHold, []);

	// Locked: a press anywhere but the list (and the pill, which unlocks it itself) lets go of it.
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
							return (
								<DropdownMenuItem key={w.id} asChild>
									<Link
										to={`/@${w.owner_name}/${w.name}`}
										data-testid={`workspace-latency-${w.name}`}
										className="flex items-center gap-2"
									>
										<span
											aria-hidden
											className={cn(
												"size-2 shrink-0 rounded-full",
												up ? "bg-content-success" : "bg-content-disabled",
											)}
										/>
										<span
											className={cn(
												"truncate",
												!up && "text-content-secondary",
											)}
										>
											{w.name}
										</span>
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
									</Link>
								</DropdownMenuItem>
							);
						})}
					</div>
				</div>
			</div>
		</>
	);
};
