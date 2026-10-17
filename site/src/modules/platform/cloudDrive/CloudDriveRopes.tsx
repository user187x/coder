import { useEffect, useRef } from "react";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import {
	makeRope,
	outsideCorner,
	type Point,
	pathLength,
	type Rope,
	type RopeOptions,
	ropePath,
	settle,
	stepRope,
} from "./ropes";

/** Where the cables are drawn over: the Workspaces page's content. */
export const ROPES_AREA = "data-cloud-drive-area";

const motionless = () =>
	document.documentElement.dataset.animations === "off" ||
	(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** Steps a frame (smaller ones keep a fast swing steady). */
const SUBSTEPS = 2;
/** Frames in a row a cable barely moves before the loop stops. */
const REST_FRAMES = 20;
/** The socket on the Cloud Drive's right side, and a plug's body (px). */
export const SOCKET = 7;
export const PLUG = 12;
/** Room between the table's right edge and a cable. */
const GAP = 3;
/** Taut, not too taut: a few percent longer than the way round the table's corner. */
const TAUT = 1.04;

type Layout = {
	/** Where the cables leave the Cloud Drive: its socket's outer end. */
	from: Point;
	/** The socket's place: the Cloud Drive's right side, halfway down. */
	socket: Point;
	/** The table's top-right corner, just outside it: no cable goes left of it below the table's top. */
	corner: Point | null;
	/** Each row's: where its plug's prongs meet the row's right edge, and where its cable joins the plug. */
	rows: Map<string, { edge: Point; end: Point }>;
};

/**
 * The Cloud Drive's connections: a cable from a socket on the Cloud Drive's right side to a plug in the right end of
 * each of the account's workspace rows. The cables run round the table's top-right corner and hang to the right of
 * the table, never over it, nearly taut; through the pointer. A cable falls into place when its row appears and
 * swings when the row moves (sorting, filtering, a workspace made or gone, the window resized), then rests; nothing
 * runs while they are still. Without animations (the user menu's switch, or reduced motion) they are drawn at rest.
 * Red and dashed while the Cloud Drive's storage does not answer.
 */
export const CloudDriveRopes: React.FC<{
	anchor: React.RefObject<HTMLElement | null>;
	workspaceIds: readonly string[];
	connected: boolean | null | undefined;
}> = ({ anchor, workspaceIds, connected }) => {
	const svg = useRef<SVGSVGElement>(null);
	const socket = useRef<SVGRectElement>(null);
	const cables = useRef(new Map<string, SVGGElement>());
	const animations = useAnimationsEnabled();
	const key = workspaceIds.join(",");

	useEffect(() => {
		const root = svg.current;
		if (!root) {
			return;
		}
		const ids = key ? key.split(",") : [];
		const ropes = new Map<string, Rope>();
		const still = () => !animations || motionless();
		let frame = 0;
		let last = 0;
		let resting = 0;
		let seen = "";

		const measure = (): Layout | null => {
			const origin = root.getBoundingClientRect();
			const a = anchor.current?.getBoundingClientRect();
			if (!a || a.width === 0) {
				return null;
			}
			const at = (x: number, y: number) => ({
				x: x - origin.left,
				y: y - origin.top,
			});
			const rows = new Map<string, { edge: Point; end: Point }>();
			let right = Number.NEGATIVE_INFINITY;
			let top = Number.POSITIVE_INFINITY;
			for (const id of ids) {
				const row = document.querySelector(
					`[data-testid="workspace-${CSS.escape(id)}"]`,
				);
				const r = row?.getBoundingClientRect();
				if (!row || !r || r.height === 0) {
					continue;
				}
				const table = row.closest("table")?.getBoundingClientRect();
				right = Math.max(right, table?.right ?? r.right);
				top = Math.min(top, table?.top ?? r.top);
				const mid = r.top + r.height / 2;
				rows.set(id, {
					edge: at(r.right, mid),
					end: at(r.right + GAP + PLUG, mid),
				});
			}
			const mid = a.top + a.height / 2;
			const from = at(a.right + SOCKET, mid);
			const corner = rows.size && a.right < right ? at(right + GAP, top) : null;
			return { from, socket: at(a.right, mid), corner, rows };
		};

		const options = (m: Layout, end: Point, i: number): RopeOptions => {
			const way = m.corner ? [m.from, m.corner, end] : [m.from, end];
			return {
				length: pathLength(way) * (TAUT + (i % 3) * 0.006) + 4,
				constrain: m.corner ? outsideCorner(m.corner) : undefined,
			};
		};

		const draw = (m: Layout) => {
			socket.current?.setAttribute("x", `${m.socket.x - 1}`);
			socket.current?.setAttribute("y", `${m.socket.y - 5}`);
			socket.current?.setAttribute(
				"visibility",
				m.rows.size ? "visible" : "hidden",
			);
			for (const [id, g] of cables.current) {
				const rope = ropes.get(id);
				const row = m.rows.get(id);
				if (!rope || !row) {
					g.setAttribute("visibility", "hidden");
					continue;
				}
				g.setAttribute("visibility", "visible");
				const d = ropePath(rope.points);
				for (const path of g.querySelectorAll("path")) {
					path.setAttribute("d", d);
				}
				g.querySelector(".cd-plug")?.setAttribute(
					"transform",
					`translate(${row.edge.x},${row.edge.y})`,
				);
			}
		};

		const tick = (now: number) => {
			frame = 0;
			const m = measure();
			if (!m) {
				last = 0;
				return;
			}
			for (const id of ropes.keys()) {
				if (!m.rows.has(id)) {
					ropes.delete(id);
				}
			}
			const where = [m.from, ...[...m.rows.values()].map((r) => r.end)]
				.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
				.join(" ");
			const moved = where !== seen;
			seen = where;
			const ends = [...m.rows.entries()];
			const via = m.corner ? [m.corner] : [];

			if (still()) {
				if (moved) {
					ends.forEach(([id, row], i) => {
						const o = options(m, row.end, i);
						const rope =
							ropes.get(id) ?? makeRope(m.from, row.end, 22, o.length, via);
						ropes.set(id, settle(rope, m.from, row.end, 900, o));
					});
					draw(m);
				}
				last = 0;
				return;
			}

			const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);
			last = now;
			let motion = 0;
			ends.forEach(([id, row], i) => {
				const o = options(m, row.end, i);
				let rope = ropes.get(id);
				if (!rope) {
					rope = makeRope(m.from, row.end, 22, o.length, via);
					ropes.set(id, rope);
				}
				for (let s = 0; s < SUBSTEPS; s++) {
					motion = Math.max(
						motion,
						stepRope(rope, m.from, row.end, dt / SUBSTEPS, o),
					);
				}
			});
			draw(m);
			resting = moved || motion > 0.03 ? 0 : resting + 1;
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
			resize.disconnect();
			mutations.disconnect();
			window.removeEventListener("resize", kick);
			window.clearInterval(poll);
		};
	}, [anchor, key, animations]);

	return (
		<svg
			ref={svg}
			aria-hidden
			className="cd-ropes"
			data-testid="cloud-drive-ropes"
			data-connected={connected === false ? "false" : "true"}
		>
			{workspaceIds.map((id) => (
				<g
					key={id}
					data-workspace={id}
					visibility="hidden"
					ref={(el) => {
						if (el) {
							cables.current.set(id, el);
						} else {
							cables.current.delete(id);
						}
					}}
				>
					<path className="cd-cable" />
					<path className="cd-cable-shine" />
					{/* The plug: its body outside the row, its two prongs into the row's right edge. */}
					<g className="cd-plug">
						<line className="cd-prong" x1={-4} y1={-2} x2={GAP + 1} y2={-2} />
						<line className="cd-prong" x1={-4} y1={2} x2={GAP + 1} y2={2} />
						<rect
							className="cd-plug-body"
							x={GAP}
							y={-4.5}
							width={PLUG}
							height={9}
							rx={2}
						/>
					</g>
				</g>
			))}
			<rect
				ref={socket}
				className="cd-socket"
				width={SOCKET + 1}
				height={10}
				rx={2}
				visibility="hidden"
			/>
		</svg>
	);
};
