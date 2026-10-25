import { useEffect, useRef, useState } from "react";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import { CloudDriveMalePlug } from "./CloudDriveMalePlug";
import {
	type Cable,
	cableLength,
	cablePath,
	cableReach,
	fall,
	hangingRest,
	type Point,
	plugAngle,
	reelSpeed,
	restHandles,
	seat,
	stepCable,
} from "./cables";

/** Where the cables are drawn over: the Workspaces page's content. */
export const ROPES_AREA = "data-cloud-drive-area";
/** On the row a cable is dragged over: "on" (it plugs in there) or "taken" (connected already: it would not). */
export const DROP = "data-cloud-drive-drop";

/** No motion: the user menu's Animations off, or the system's reduced motion. */
export const motionless = () =>
	document.documentElement.dataset.animations === "off" ||
	(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** Steps a frame (smaller ones keep a fast swing steady). */
const SUBSTEPS = 2;
/** Frames in a row the cables barely move before the loop stops. */
const REST_FRAMES = 20;
/** The socket on the Cloud Drive's right side, and a plug's body (px). */
export const SOCKET = 7;
export const PLUG = 12;
/** Room between the table's right edge and a cable. */
const GAP = 3;
/** How long a pulled-out cable hangs limp before it reels in (ms). */
export const LIMP_MS = 500;
/** How far right of a row a plug dropped there still plugs into it (px). */
const DROP_REACH = 90;
/** When the page opens, the cables plug in one after another (ms apart). */
const STAGGER_MS = 90;
/** A change the owner made by hand wins over the list until the list has it (or this long, if it never does). */
const OVERRIDE_MS = 5000;

type Phase = "plugged" | "seating" | "dragging" | "limp" | "reeling";

type Wire = Cable & {
	key: string;
	phase: Phase;
	/** The workspace it is plugged into, flying to (seating) or held over (dragging); null: none. */
	target: string | null;
	/** Dragged out of this workspace's row (null: pulled out of the socket). */
	from: string | null;
	/** The plug (where the cable joins it), and its speed (px a second). */
	end: Point;
	v: Point;
	/** The cable's length while it hangs or reels in (px). */
	length: number;
	/** When its phase began (ms, performance.now()): a cable waiting its turn to plug in begins later. */
	since: number;
};

type Row = {
	/** Where its plug's cable end sits, at the row's right edge, halfway down. */
	end: Point;
	top: number;
	bottom: number;
	left: number;
	right: number;
	el: Element;
};

type Layout = {
	/** Where the cables leave the Cloud Drive: its socket's outer end. */
	from: Point;
	/** Where their curves begin: the socket, or (the Cloud Drive left of the table's corner) above that corner. */
	start: Point;
	/** The socket's place: the Cloud Drive's right side, halfway down. */
	socket: Point;
	/** No cable goes left of this (the table's right edge, and a little). */
	minX: number;
	/** The account's workspace rows on the page. */
	rows: Map<string, Row>;
	/** The drawing's top-left corner on the screen. */
	origin: { left: number; top: number };
};

/** A cable plugged into a workspace whose drive is not attached there yet: data-attached="false" (red). */
const markAttached = (g: SVGGElement, unattached: ReadonlySet<string>) => {
	const id = g.dataset.workspace;
	const attached = !id || !unattached.has(id) ? "true" : "false";
	if (g.dataset.attached !== attached) {
		g.dataset.attached = attached;
	}
};

/**
 * The Cloud Drive's connections: a cable from a socket on the Cloud Drive's right side (flush with the table's right
 * edge, above it) to a plug in the right end of each of the account's workspace rows connected to it. Each cable
 * leaves the socket and enters its plug straight from the right, looping out to the right of the table, never over
 * it; a deeper row's loop round a shallower one's.
 *
 * Everything moves as it would: the cables plug in one after another when the page opens (each plug flies from the
 * socket to its row and latches), swing when their rows move, then rest. The owner drags a plug away from its row to
 * disconnect that workspace - the cable hangs limp for half a second, then reels back into the Cloud Drive like a
 * vacuum cleaner's cord - and drags a new cable out of the socket onto a workspace that isn't connected to connect
 * it (or a plug from one row onto another, to move it). Nothing runs while they are still. Without animations (the
 * user menu's switch, or reduced motion) they are drawn at rest. Red and dashed while the Cloud Drive's storage does
 * not answer; a cable red while its workspace says the drive is not attached in it yet (attachment.ts). A workspace
 * being deleted lets go of its cable at once - the plug pops off its row, hangs a moment and reels back into the
 * Cloud Drive like a retractable cord - while its row is still there (going, shining).
 */
export const CloudDriveRopes: React.FC<{
	anchor: React.RefObject<HTMLElement | null>;
	/** The signed-in user's workspaces on the page. */
	workspaceIds: readonly string[];
	/** Those of them connected to the Cloud Drive. */
	linked: readonly string[];
	/** The owner plugged a cable into a workspace (true), or pulled one out (false). */
	onLink: (workspaceId: string, connected: boolean) => void;
	connected: boolean | null | undefined;
	/** Of the linked ones, those whose drive is not attached in the workspace yet: their cables red. */
	unattached?: readonly string[];
	/** Being deleted: their cables pop off and reel in before their rows go. */
	deleting?: readonly string[];
}> = ({
	anchor,
	workspaceIds,
	linked,
	onLink,
	connected,
	unattached,
	deleting,
}) => {
	const svg = useRef<SVGSVGElement>(null);
	const socket = useRef<SVGGElement>(null);
	const elements = useRef(new Map<string, SVGGElement>());
	const [keys, setKeys] = useState<readonly string[]>([]);
	const animations = useAnimationsEnabled();
	// the same workspaces in another order (the list re-sorted: one began deleting) are the same cables
	const ids = [...workspaceIds].sort().join(",");
	const linkedRef = useRef(new Set(linked));
	const unattachedRef = useRef(new Set(unattached));
	const deletingRef = useRef(new Set(deleting));
	const onLinkRef = useRef(onLink);
	const kickRef = useRef<() => void>(() => {});
	onLinkRef.current = onLink;

	useEffect(() => {
		linkedRef.current = new Set(linked);
		kickRef.current();
	}, [linked]);

	const going = (deleting ?? []).join(",");
	useEffect(() => {
		deletingRef.current = new Set(going ? going.split(",") : []);
		kickRef.current();
	}, [going]);

	// The cables whose drive is not attached yet: red, at once (nothing is drawn while they are still).
	const waiting = (unattached ?? []).join(",");
	useEffect(() => {
		unattachedRef.current = new Set(waiting ? waiting.split(",") : []);
		for (const g of elements.current.values()) {
			markAttached(g, unattachedRef.current);
		}
	}, [waiting]);

	useEffect(() => {
		const root = svg.current;
		if (!root) {
			return;
		}
		const mine = new Set(ids ? ids.split(",") : []);
		const wires = new Map<string, Wire>();
		// The owner's own changes, until the list says so too: workspace id -> [connected, when].
		const overrides = new Map<string, [boolean, number]>();
		const still = () => !animations || motionless();
		let counter = 0;
		let frame = 0;
		let last = 0;
		let resting = 0;
		let seen = "";
		let first = true;
		let drag: {
			wire: Wire;
			pointer: number;
			at: Point;
			trail: { p: Point; t: number }[];
		} | null = null;
		let highlighted: Element | null = null;

		const isLinked = (id: string) => {
			const o = overrides.get(id);
			if (
				o &&
				performance.now() - o[1] < OVERRIDE_MS &&
				o[0] !== linkedRef.current.has(id)
			) {
				return o[0];
			}
			overrides.delete(id);
			return linkedRef.current.has(id);
		};

		const change = (id: string, on: boolean) => {
			overrides.set(id, [on, performance.now()]);
			onLinkRef.current(id, on);
		};

		const syncKeys = () => setKeys([...wires.keys()]);

		const measure = (): Layout | null => {
			const box = root.getBoundingClientRect();
			const a = anchor.current?.getBoundingClientRect();
			if (!a || a.width === 0) {
				return null;
			}
			const at = (x: number, y: number) => ({
				x: x - box.left,
				y: y - box.top,
			});
			const rows = new Map<string, Row>();
			let right = Number.NEGATIVE_INFINITY;
			for (const id of mine) {
				const el = document.querySelector(
					`[data-testid="workspace-${CSS.escape(id)}"]`,
				);
				const r = el?.getBoundingClientRect();
				if (!el || !r || r.height === 0) {
					continue;
				}
				const table = el.closest("table")?.getBoundingClientRect();
				right = Math.max(right, table?.right ?? r.right);
				const mid = r.top + r.height / 2;
				rows.set(id, {
					end: at(r.right + GAP + PLUG, mid),
					top: r.top - box.top,
					bottom: r.bottom - box.top,
					left: r.left - box.left,
					right: r.right - box.left,
					el,
				});
			}
			const mid = a.top + a.height / 2;
			const from = at(a.right + SOCKET, mid);
			const minX = rows.size
				? right + GAP - box.left
				: Number.NEGATIVE_INFINITY;
			const start = from.x < minX ? { x: minX, y: from.y } : from;
			return {
				from,
				start,
				socket: at(a.right, mid),
				minX,
				rows,
				origin: { left: box.left, top: box.top },
			};
		};

		/** The rows' depth order among the plugged cables: the shallowest's loop innermost. */
		const ranks = (m: Layout) => {
			const ys = [...wires.values()]
				.filter((w) => w.target && m.rows.has(w.target))
				.map(
					(w) => [w.key, m.rows.get(w.target as string)?.end.y ?? 0] as const,
				)
				.sort((p, q) => p[1] - q[1]);
			return new Map(ys.map(([key], rank) => [key, rank]));
		};

		const rest = (m: Layout, w: Wire, rank: number): [Point, Point] => {
			const row = w.target ? m.rows.get(w.target) : undefined;
			if (row && w.phase !== "limp" && w.phase !== "reeling") {
				const to = w.phase === "dragging" ? w.end : row.end;
				return restHandles(m.start, to, cableReach(to.y - m.start.y, rank));
			}
			return hangingRest(m.start, w.end);
		};

		const spawn = (m: Layout, id: string, delay: number) => {
			const key = `c${counter++}`;
			wires.set(key, {
				key,
				phase: "seating",
				target: id,
				from: null,
				end: { ...m.start },
				v: { x: 0, y: 0 },
				length: 0,
				since: performance.now() + delay,
				handles: [{ ...m.start }, { ...m.start }],
				velocity: [
					{ x: 0, y: 0 },
					{ x: 0, y: 0 },
				],
			});
		};

		const unplug = (m: Layout, w: Wire, kick: Point) => {
			w.length = Math.max(
				cableLength(m.start, w, w.end),
				Math.hypot(w.end.x - m.start.x, w.end.y - m.start.y),
			);
			w.phase = "limp";
			w.target = null;
			w.since = performance.now();
			w.v = { ...kick };
		};

		/** The cables as the list says: a plug for every connected row on the page, none for the others. */
		const reconcile = (m: Layout) => {
			let added = false;
			const covered = new Set<string>();
			for (const w of wires.values()) {
				if (w.phase === "dragging" && w.from) {
					covered.add(w.from);
				}
				if ((w.phase === "plugged" || w.phase === "seating") && w.target) {
					if (!m.rows.has(w.target)) {
						// its row left the page (filtered, another page): it reels in, nothing changes
						w.target = null;
						w.phase = "reeling";
						w.length = cableLength(m.start, w, w.end);
						w.since = performance.now();
					} else if (deletingRef.current.has(w.target)) {
						// its workspace is being deleted: the plug pops off, up and out, and the cord reels in
						unplug(m, w, { x: 140, y: -120 });
					} else if (!isLinked(w.target)) {
						// disconnected elsewhere (another tab, a failed save): it comes out
						unplug(m, w, { x: 90, y: -60 });
					} else {
						covered.add(w.target);
					}
				}
			}
			const missing = [...m.rows.entries()]
				.filter(
					([id]) =>
						isLinked(id) && !covered.has(id) && !deletingRef.current.has(id),
				)
				.sort((p, q) => p[1].end.y - q[1].end.y);
			missing.forEach(([id], i) => {
				spawn(m, id, first ? i * STAGGER_MS : 0);
				added = true;
			});
			first = false;
			if (added) {
				syncKeys();
			}
		};

		const draw = (m: Layout, now: number) => {
			const s = socket.current;
			if (s) {
				s.setAttribute("transform", `translate(${m.socket.x},${m.socket.y})`);
				s.setAttribute("visibility", m.rows.size ? "visible" : "hidden");
			}
			for (const [key, g] of elements.current) {
				const w = wires.get(key);
				if (!w || w.since > now) {
					g.setAttribute("visibility", "hidden");
					continue;
				}
				g.setAttribute("visibility", "visible");
				g.dataset.phase = w.phase;
				g.dataset.workspace = w.target ?? "";
				markAttached(g, unattachedRef.current);
				const d = cablePath(m.from, w, w.end, m.start);
				for (const path of g.querySelectorAll("path")) {
					path.setAttribute("d", d);
				}
				const angle = (plugAngle(w, w.end) * 180) / Math.PI;
				const f = (n: number) => Math.round(n * 10) / 10;
				g.querySelector(".cd-plug")?.setAttribute(
					"transform",
					`translate(${f(w.end.x)},${f(w.end.y)}) rotate(${Math.round(angle)})`,
				);
			}
		};

		const highlight = (el: Element | null, state?: "on" | "taken") => {
			if (highlighted && highlighted !== el) {
				highlighted.removeAttribute(DROP);
			}
			highlighted = el;
			if (el && state) {
				el.setAttribute(DROP, state);
			}
		};

		/** The row under a point (the drawing's coordinates), or right of it within DROP_REACH. */
		const rowAt = (m: Layout, p: Point) => {
			for (const [id, row] of m.rows) {
				if (
					p.y >= row.top &&
					p.y <= row.bottom &&
					p.x >= row.left &&
					p.x <= row.right + DROP_REACH
				) {
					return id;
				}
			}
			return null;
		};

		const latched = (el: Element | null | undefined, name: string) => {
			el?.classList.remove(name);
			// a reflow between, so the animation runs again
			void el?.getBoundingClientRect();
			el?.classList.add(name);
		};

		const tick = (now: number) => {
			frame = 0;
			const m = measure();
			if (!m) {
				last = 0;
				return;
			}
			reconcile(m);
			const where = [
				m.from,
				...[...m.rows.values()].map((r) => r.end),
				...(drag ? [drag.at] : []),
			]
				.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
				.join(" ");
			const moved = where !== seen;
			seen = where;
			const order = ranks(m);
			let busy = false;
			let removed = false;

			if (still()) {
				for (const w of [...wires.values()]) {
					const row = w.target ? m.rows.get(w.target) : undefined;
					if (w.phase === "dragging" && drag?.wire === w) {
						w.end = { ...drag.at };
					} else if (row && w.phase !== "limp" && w.phase !== "reeling") {
						w.phase = "plugged";
						w.since = Math.min(w.since, now);
						w.end = { ...row.end };
					} else {
						wires.delete(w.key);
						removed = true;
						continue;
					}
					const r = rest(m, w, order.get(w.key) ?? 0);
					w.handles = [{ ...r[0] }, { ...r[1] }];
				}
				if (removed) {
					syncKeys();
				}
				draw(m, now);
				last = 0;
				return;
			}

			const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);
			last = now;
			const h = dt / SUBSTEPS;
			let motion = 0;
			for (const w of [...wires.values()]) {
				if (w.since > now) {
					busy = true;
					continue;
				}
				const row = w.target ? m.rows.get(w.target) : undefined;
				for (let s = 0; s < SUBSTEPS; s++) {
					if (w.phase === "plugged" && row) {
						w.end = { ...row.end };
					} else if (w.phase === "seating" && row) {
						busy = true;
						if (seat(w.end, w.v, row.end, h)) {
							w.phase = "plugged";
							w.end = { ...row.end };
							w.v = { x: 0, y: 0 };
							// the prongs light up as it latches
							latched(elements.current.get(w.key), "cd-latched");
						}
					} else if (w.phase === "dragging" && drag?.wire === w) {
						busy = true;
						w.end = { ...drag.at };
					} else if (w.phase === "limp" || w.phase === "reeling") {
						busy = true;
						if (w.phase === "limp" && now - w.since > LIMP_MS) {
							w.phase = "reeling";
							w.since = now;
						}
						if (w.phase === "reeling") {
							w.length -= reelSpeed((now - w.since) / 1000) * h;
						}
						fall(w.end, w.v, m.start, Math.max(0, w.length), h, m.minX);
					}
					motion = Math.max(
						motion,
						stepCable(w, rest(m, w, order.get(w.key) ?? 0), h, m.minX),
					);
				}
				if (w.phase === "reeling" && w.length <= 2) {
					wires.delete(w.key);
					removed = true;
					// the socket takes it in
					latched(socket.current, "cd-gulp");
				}
			}
			if (removed) {
				syncKeys();
			}
			draw(m, now);
			resting = moved || busy || motion > 0.03 ? 0 : resting + 1;
			if (resting < REST_FRAMES) {
				frame = requestAnimationFrame(tick);
			} else {
				last = 0;
			}
		};

		const kick = () => {
			if (!frame) {
				frame = requestAnimationFrame(tick);
			}
		};
		kickRef.current = kick;

		const toLocal = (e: PointerEvent, m: Layout): Point => ({
			x: e.clientX - m.origin.left,
			y: e.clientY - m.origin.top,
		});

		const stopDragging = () => {
			drag = null;
			highlight(null);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onCancel);
			window.removeEventListener("keydown", onKey);
			document.documentElement.classList.remove("cd-dragging");
		};

		const onMove = (e: PointerEvent) => {
			if (!drag || e.pointerId !== drag.pointer) {
				return;
			}
			const m = measure();
			if (!m) {
				return;
			}
			drag.at = toLocal(e, m);
			drag.trail.push({ p: drag.at, t: performance.now() });
			if (drag.trail.length > 6) {
				drag.trail.shift();
			}
			const over = rowAt(m, drag.at);
			const free = over && (over === drag.wire.from || !isLinked(over));
			drag.wire.target = free ? over : null;
			highlight(
				over ? (m.rows.get(over)?.el ?? null) : null,
				over ? (free ? "on" : "taken") : undefined,
			);
			kick();
		};

		/** The plug let go: into the row under it, else limp (cancelled: back where it was). */
		const release = (cancelled: boolean) => {
			if (!drag) {
				return;
			}
			const { wire, trail } = drag;
			stopDragging();
			const m = measure();
			if (!m) {
				return;
			}
			const target = cancelled ? wire.from : wire.target;
			if (target && m.rows.has(target)) {
				wire.phase = "seating";
				wire.target = target;
				wire.since = performance.now();
				if (target !== wire.from) {
					change(target, true);
				}
				if (wire.from && wire.from !== target) {
					change(wire.from, false);
				}
			} else {
				// let go anywhere else: it hangs limp, thrown as it was moving, then reels in
				const a = trail[0];
				const b = trail.at(-1);
				const span = a && b ? Math.max(16, b.t - a.t) / 1000 : 1;
				unplug(m, wire, {
					x: a && b ? (b.p.x - a.p.x) / span : 0,
					y: a && b ? (b.p.y - a.p.y) / span : 0,
				});
				if (wire.from) {
					change(wire.from, false);
				}
			}
			kick();
		};
		const onUp = (e: PointerEvent) => {
			if (drag && e.pointerId === drag.pointer) {
				release(false);
			}
		};
		const onCancel = (e: PointerEvent) => {
			if (drag && e.pointerId === drag.pointer) {
				release(true);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && drag) {
				e.preventDefault();
				release(true);
			}
		};

		const onDown = (e: PointerEvent) => {
			if (e.button !== 0 || drag) {
				return;
			}
			const grab = (e.target as Element | null)?.closest<SVGElement>(
				"[data-grab]",
			);
			const m = grab ? measure() : null;
			if (!grab || !m) {
				return;
			}
			let wire: Wire | undefined;
			if (grab.dataset.grab === "socket") {
				// a new cable, out of the socket
				const key = `c${counter++}`;
				wire = {
					key,
					phase: "dragging",
					target: null,
					from: null,
					end: { ...m.start },
					v: { x: 0, y: 0 },
					length: 0,
					since: performance.now(),
					handles: [{ ...m.start }, { ...m.start }],
					velocity: [
						{ x: 0, y: 0 },
						{ x: 0, y: 0 },
					],
				};
				wires.set(key, wire);
				syncKeys();
			} else {
				const key = grab.closest<SVGGElement>("[data-wire]")?.dataset.wire;
				wire = key ? wires.get(key) : undefined;
				if (!wire || wire.phase === "reeling") {
					return;
				}
				wire.from =
					wire.phase === "plugged" || wire.phase === "seating"
						? wire.target
						: null;
				wire.phase = "dragging";
			}
			e.preventDefault();
			const at = toLocal(e, m);
			drag = {
				wire,
				pointer: e.pointerId,
				at,
				trail: [{ p: at, t: performance.now() }],
			};
			document.documentElement.classList.add("cd-dragging");
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
			window.addEventListener("pointercancel", onCancel);
			window.addEventListener("keydown", onKey);
			kick();
		};
		root.addEventListener("pointerdown", onDown);

		kick();
		const area = root.closest(`[${ROPES_AREA}]`) ?? document.body;
		const resize = new ResizeObserver(kick);
		resize.observe(area);
		const mutations = new MutationObserver(kick);
		mutations.observe(area, { childList: true, subtree: true });
		window.addEventListener("resize", kick);
		// Anything else that moves a row (fonts, transitions) within a second.
		const poll = window.setInterval(kick, 1000);
		return () => {
			cancelAnimationFrame(frame);
			kickRef.current = () => {};
			root.removeEventListener("pointerdown", onDown);
			stopDragging();
			resize.disconnect();
			mutations.disconnect();
			window.removeEventListener("resize", kick);
			window.clearInterval(poll);
		};
	}, [anchor, ids, animations]);

	return (
		<svg
			ref={svg}
			aria-hidden
			className="cd-ropes"
			data-testid="cloud-drive-ropes"
			data-connected={connected === false ? "false" : "true"}
		>
			{keys.map((key) => (
				<g
					key={key}
					data-wire={key}
					visibility="hidden"
					ref={(el) => {
						if (el) {
							elements.current.set(key, el);
						} else {
							elements.current.delete(key);
						}
					}}
				>
					<path className="cd-cable" />
					<path className="cd-cable-shine" />
					{/* The plug: the cable joins its body at (0, 0); its prongs point on along +x (into the row's edge). */}
					<g className="cd-plug">
						<CloudDriveMalePlug />
						<rect
							className="cd-grab"
							data-grab="plug"
							x={-4}
							y={-9}
							width={PLUG + GAP + 10}
							height={18}
						>
							<title>Drag away to disconnect this workspace</title>
						</rect>
					</g>
				</g>
			))}
			<g ref={socket} className="cd-socket-group" visibility="hidden">
				{linked.length === 0 ? (
					<CloudDriveMalePlug />
				) : (
					<rect
						className="cd-socket"
						x={-1}
						y={-5}
						width={SOCKET + 1}
						height={10}
						rx={2}
					/>
				)}
				<rect
					className="cd-grab"
					data-grab="socket"
					x={0}
					y={-11}
					width={SOCKET + 12}
					height={22}
				>
					<title>Drag a cable to a workspace to connect it</title>
				</rect>
			</g>
		</svg>
	);
};
