import { CableIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "react-query";
import { cloudDrivePeers } from "#/api/queries/platform";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import { motionless } from "./CloudDriveRopes";
import {
	type Cable,
	cableLength,
	cablePath,
	fall,
	hangingRest,
	type Point,
	plugAngle,
	reelSpeed,
	restHandles,
	seat,
	stepCable,
} from "./cables";
import "./cloudDrive.css";
import {
	GAP,
	loopsRoom,
	PLUG,
	type ShareEdge,
	type ShareEnds,
	type ShareRow,
	SOCKET,
	shareEdges,
	shareEnds,
} from "./shareCables";

/** On the two rows of the cable under the pointer. */
export const SHARE_HOVER = "data-share-hover";

const SUBSTEPS = 2;
const REST_FRAMES = 20;
/** When the page opens, the cables plug in one after another (ms apart). */
const STAGGER_MS = 90;
/** How long an ended share's cable hangs limp before it reels into its owner's socket (ms). */
const LIMP_MS = 500;

type Wire = Cable & {
	edge: ShareEdge;
	phase: "seating" | "plugged" | "limp" | "reeling";
	end: Point;
	v: Point;
	length: number;
	since: number;
};

type Layout = {
	ends: ShareEnds;
	/** No cable goes left of this (the table's right edge, and a little). */
	minX: number;
	/** How far the table's right edge is from the screen's (px). */
	room: number;
};

/**
 * The Accounts table's Cloud Drive cables: who shares their Cloud Drive with whom, drawn with the Cloud Drive's own
 * cables. Each active share is a cable from a socket at its owner's row's right end to a plug at the right end of the
 * row of whom it is shared with, looping out to the right of the table, never over it; read and write ones with green
 * prongs, read only ones blue. They plug in one after another when the page opens and swing when their rows move; an
 * ended share's plug comes out and reels into its owner's socket. Pointing at a cable names the share and marks both
 * rows. Admins see every share, others their own. Above the table, a line says what the cables are. Without
 * animations they are drawn at rest. Where the screen has no room right of the table for the loops, the table
 * narrows by that much.
 */
export const AccountShareCables: React.FC<{
	/** The accounts on the page (their rows: data-testid="user-<id>"). */
	userIds: readonly string[];
	children: ReactNode;
}> = ({ userIds, children }) => {
	const peers = useQuery(cloudDrivePeers());
	const ids = userIds.join(",");
	const { edges, offPage } = useMemo(() => {
		const data = peers.data;
		if (!data?.settings.enabled) {
			return { edges: [], offPage: 0 };
		}
		const shares = data.admin
			? (data.all ?? [])
			: [...data.asked, ...data.ofMine];
		return shareEdges(shares, new Set(ids ? ids.split(",") : []));
	}, [peers.data, ids]);

	return (
		<>
			{(edges.length > 0 || offPage > 0) && (
				<p
					className="m-0 mb-2 flex items-start gap-2 text-xs text-content-secondary"
					data-testid="account-shares-legend"
				>
					<CableIcon aria-hidden className="size-3.5 shrink-0" />
					<span>
						Cables: Cloud Drives shared between accounts, from the socket of its
						owner to the plug of whom it is shared with - green prongs read and
						write, blue read only. Point at one for who and how.
						{offPage > 0 &&
							` ${offPage} more with an account not on this page.`}
					</span>
				</p>
			)}
			<ShareCablesArea edges={edges}>{children}</ShareCablesArea>
		</>
	);
};

const ShareCablesArea: React.FC<{
	edges: readonly ShareEdge[];
	children: ReactNode;
}> = ({ edges, children }) => {
	const area = useRef<HTMLDivElement>(null);
	const svg = useRef<SVGSVGElement>(null);
	const elements = useRef(new Map<string, SVGGElement>());
	const socketEls = useRef(new Map<string, SVGGElement>());
	const [keys, setKeys] = useState<readonly string[]>([]);
	const [owners, setOwners] = useState<readonly string[]>([]);
	const animations = useAnimationsEnabled();
	const edgesRef = useRef(edges);
	const kickRef = useRef<() => void>(() => {});

	useEffect(() => {
		edgesRef.current = edges;
		kickRef.current();
	}, [edges]);

	useEffect(() => {
		const root = svg.current;
		const box = area.current;
		if (!root || !box) {
			return;
		}
		const wires = new Map<string, Wire>();
		const still = () => !animations || motionless();
		let frame = 0;
		let last = 0;
		let resting = 0;
		let seen = "";
		let first = true;
		let pad = 0;

		const sync = () => {
			setKeys([...wires.keys()]);
			setOwners([...new Set([...wires.values()].map((w) => w.edge.owner))]);
		};

		const measure = (): Layout | null => {
			const b = root.getBoundingClientRect();
			const rows = new Map<string, ShareRow>();
			let right = Number.NEGATIVE_INFINITY;
			const wanted = new Set<string>();
			for (const e of edgesRef.current) {
				wanted.add(e.owner);
				wanted.add(e.to);
			}
			for (const w of wires.values()) {
				wanted.add(w.edge.owner);
				wanted.add(w.edge.to);
			}
			for (const id of wanted) {
				const el = document.querySelector(
					`[data-testid="user-${CSS.escape(id)}"]`,
				);
				const r = el?.getBoundingClientRect();
				if (!el || !r || r.height === 0) {
					continue;
				}
				const table = el.closest("table")?.getBoundingClientRect();
				right = Math.max(right, table?.right ?? r.right);
				rows.set(id, {
					right: r.right - b.left,
					mid: r.top + r.height / 2 - b.top,
				});
			}
			// every cable's ends, those of ended shares still reeling in too
			const all = [
				...edgesRef.current,
				...[...wires.values()]
					.map((w) => w.edge)
					.filter((e) => !edgesRef.current.some((x) => x.key === e.key)),
			];
			const ends = shareEnds(all, rows);
			const outer = box.getBoundingClientRect().right;
			return {
				ends,
				minX: rows.size ? right + GAP - b.left : Number.NEGATIVE_INFINITY,
				room: document.documentElement.clientWidth - outer,
			};
		};

		/** Room for the loops right of the table: the table narrows where the screen has too little. */
		const makeRoom = (m: Layout) => {
			const want = Math.max(0, Math.ceil(loopsRoom(m.ends) + 12 - m.room));
			if (want !== pad) {
				pad = want;
				box.style.paddingRight = want ? `${want}px` : "";
			}
		};

		const spawn = (m: Layout, e: ShareEdge, delay: number) => {
			const from = m.ends.sockets.get(e.owner)?.from ?? { x: 0, y: 0 };
			wires.set(e.key, {
				edge: e,
				phase: "seating",
				end: { ...from },
				v: { x: 0, y: 0 },
				length: 0,
				since: performance.now() + delay,
				handles: [{ ...from }, { ...from }],
				velocity: [
					{ x: 0, y: 0 },
					{ x: 0, y: 0 },
				],
			});
		};

		/** The cables as the shares are: one plugging in for each new one, an ended one's coming out. */
		const reconcile = (m: Layout) => {
			let changed = false;
			const now = edgesRef.current;
			const keysNow = new Set(now.map((e) => e.key));
			for (const w of [...wires.values()]) {
				if (!m.ends.sockets.has(w.edge.owner)) {
					// its owner's row left the page: gone with it
					wires.delete(w.edge.key);
					changed = true;
				} else if (
					!keysNow.has(w.edge.key) &&
					(w.phase === "plugged" || w.phase === "seating")
				) {
					const from = m.ends.sockets.get(w.edge.owner)?.from ?? w.end;
					w.length = Math.max(
						cableLength(from, w, w.end),
						Math.hypot(w.end.x - from.x, w.end.y - from.y),
					);
					w.phase = "limp";
					w.since = performance.now();
					w.v = { x: 90, y: -60 };
				}
			}
			const fresh = now
				.filter((e) => !wires.has(e.key) && m.ends.plugs.has(e.key))
				.sort(
					(a, b) =>
						(m.ends.plugs.get(a.key)?.end.y ?? 0) -
						(m.ends.plugs.get(b.key)?.end.y ?? 0),
				);
			fresh.forEach((e, i) => {
				spawn(m, e, first ? i * STAGGER_MS : 0);
				changed = true;
			});
			if (m.ends.plugs.size > 0 || now.length === 0) {
				first = false;
			}
			if (changed) {
				sync();
			}
		};

		const restOf = (m: Layout, w: Wire): [Point, Point] => {
			const from = m.ends.sockets.get(w.edge.owner)?.from ?? w.end;
			const plug = m.ends.plugs.get(w.edge.key);
			if (plug && (w.phase === "plugged" || w.phase === "seating")) {
				return restHandles(from, plug.end, plug.reach);
			}
			return hangingRest(from, w.end);
		};

		const draw = (m: Layout, now: number) => {
			for (const [owner, g] of socketEls.current) {
				const s = m.ends.sockets.get(owner);
				g.setAttribute("visibility", s ? "visible" : "hidden");
				if (s) {
					g.setAttribute("transform", `translate(${s.at.x},${s.at.y})`);
				}
			}
			for (const [key, g] of elements.current) {
				const w = wires.get(key);
				const from = w ? m.ends.sockets.get(w.edge.owner)?.from : undefined;
				if (!w || !from || w.since > now) {
					g.setAttribute("visibility", "hidden");
					continue;
				}
				g.setAttribute("visibility", "visible");
				g.dataset.phase = w.phase;
				const d = cablePath(from, w, w.end);
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

		const latched = (el: Element | null | undefined, name: string) => {
			el?.classList.remove(name);
			void el?.getBoundingClientRect();
			el?.classList.add(name);
		};

		const tick = (now: number) => {
			frame = 0;
			const m = measure();
			if (!m) {
				return;
			}
			makeRoom(m);
			reconcile(m);
			const where = [
				...[...m.ends.sockets.values()].map((s) => s.from),
				...[...m.ends.plugs.values()].map((p) => p.end),
			]
				.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
				.join(" ");
			const moved = where !== seen;
			seen = where;

			if (still()) {
				let removed = false;
				for (const w of [...wires.values()]) {
					const plug = m.ends.plugs.get(w.edge.key);
					if (!plug || w.phase === "limp" || w.phase === "reeling") {
						wires.delete(w.edge.key);
						removed = true;
						continue;
					}
					w.phase = "plugged";
					w.since = Math.min(w.since, now);
					w.end = { ...plug.end };
					const r = restOf(m, w);
					w.handles = [{ ...r[0] }, { ...r[1] }];
				}
				if (removed) {
					sync();
				}
				draw(m, now);
				last = 0;
				return;
			}

			const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);
			last = now;
			const h = dt / SUBSTEPS;
			let motion = 0;
			let busy = false;
			let removed = false;
			for (const w of [...wires.values()]) {
				if (w.since > now) {
					busy = true;
					continue;
				}
				const plug = m.ends.plugs.get(w.edge.key);
				const from = m.ends.sockets.get(w.edge.owner)?.from ?? w.end;
				for (let s = 0; s < SUBSTEPS; s++) {
					if (w.phase === "plugged" && plug) {
						w.end = { ...plug.end };
					} else if (w.phase === "seating" && plug) {
						busy = true;
						if (seat(w.end, w.v, plug.end, h)) {
							w.phase = "plugged";
							w.end = { ...plug.end };
							w.v = { x: 0, y: 0 };
							latched(elements.current.get(w.edge.key), "cd-latched");
						}
					} else {
						busy = true;
						if (w.phase !== "reeling" && now - w.since > LIMP_MS) {
							w.phase = "reeling";
							w.since = now;
						} else if (w.phase !== "reeling") {
							w.phase = "limp";
						}
						if (w.phase === "reeling") {
							w.length -= reelSpeed((now - w.since) / 1000) * h;
						}
						fall(w.end, w.v, from, Math.max(0, w.length), h, m.minX);
					}
					motion = Math.max(motion, stepCable(w, restOf(m, w), h, m.minX));
				}
				if (w.phase === "reeling" && w.length <= 2) {
					wires.delete(w.edge.key);
					removed = true;
					latched(socketEls.current.get(w.edge.owner), "cd-gulp");
				}
			}
			if (removed) {
				sync();
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

		kick();
		const resize = new ResizeObserver(kick);
		resize.observe(box);
		const mutations = new MutationObserver(kick);
		mutations.observe(box, { childList: true, subtree: true });
		window.addEventListener("resize", kick);
		const poll = window.setInterval(kick, 1000);
		return () => {
			cancelAnimationFrame(frame);
			kickRef.current = () => {};
			resize.disconnect();
			mutations.disconnect();
			window.removeEventListener("resize", kick);
			window.clearInterval(poll);
			box.style.paddingRight = "";
		};
	}, [animations]);

	/** Pointing at a cable: both its rows marked. */
	const hover = (edge: ShareEdge | null) => {
		for (const el of document.querySelectorAll(`[${SHARE_HOVER}]`)) {
			el.removeAttribute(SHARE_HOVER);
		}
		if (edge) {
			for (const [id, end] of [
				[edge.owner, "owner"],
				[edge.to, "to"],
			]) {
				document
					.querySelector(`[data-testid="user-${CSS.escape(id)}"]`)
					?.setAttribute(SHARE_HOVER, end);
			}
		}
	};
	useEffect(() => () => hover(null), []);

	const byKey = new Map(edges.map((e) => [e.key, e]));
	return (
		<div ref={area} className="relative" data-testid="account-shares-area">
			{children}
			<svg
				ref={svg}
				aria-hidden
				className="cd-ropes"
				data-testid="account-share-cables"
			>
				{keys.map((key) => {
					const edge = byKey.get(key);
					return (
						<g
							key={key}
							data-share={key}
							data-owner={edge?.owner}
							data-to={edge?.to}
							data-access={edge?.access}
							className="cd-share"
							visibility="hidden"
							ref={(el) => {
								if (el) {
									elements.current.set(key, el);
								} else {
									elements.current.delete(key);
								}
							}}
							onPointerEnter={() => hover(edge ?? null)}
							onPointerLeave={() => hover(null)}
						>
							<path className="cd-cable" />
							<path className="cd-cable-shine" />
							<path className="cd-share-hit">
								{edge && <title>{edge.label}</title>}
							</path>
							<g className="cd-plug">
								<line
									className="cd-prong"
									x1={PLUG - 1}
									y1={-2}
									x2={PLUG + GAP + 4}
									y2={-2}
								/>
								<line
									className="cd-prong"
									x1={PLUG - 1}
									y1={2}
									x2={PLUG + GAP + 4}
									y2={2}
								/>
								<rect
									className="cd-plug-body"
									x={0}
									y={-4.5}
									width={PLUG}
									height={9}
									rx={2}
								/>
							</g>
						</g>
					);
				})}
				{owners.map((owner) => (
					<g
						key={owner}
						data-socket={owner}
						className="cd-socket-group"
						visibility="hidden"
						ref={(el) => {
							if (el) {
								socketEls.current.set(owner, el);
							} else {
								socketEls.current.delete(owner);
							}
						}}
					>
						<rect
							className="cd-socket"
							x={-1}
							y={-5}
							width={SOCKET + 1}
							height={10}
							rx={2}
						/>
					</g>
				))}
			</svg>
		</div>
	);
};
