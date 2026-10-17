import { useEffect, useRef } from "react";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import {
	makeRope,
	type Point,
	type Rope,
	ropePath,
	settle,
	stepRope,
} from "./ropes";

/** Where the ropes are drawn over: the Workspaces table with its toolbar. */
export const ROPES_AREA = "data-cloud-drive-area";

const motionless = () =>
	document.documentElement.dataset.animations === "off" ||
	(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** Steps a frame (smaller ones keep a fast swing steady). */
const SUBSTEPS = 2;
/** Frames in a row a rope barely moves before the loop stops. */
const REST_FRAMES = 20;

type Ends = { from: Point; ends: Map<string, Point> };

/**
 * The Cloud Drive's connections: a rope from the Cloud Drive (anchor) to the
 * right end of each of the account's workspace rows, over the table and
 * through the pointer. A rope falls into its curve when its row appears and
 * swings when the row moves (sorting, filtering, a workspace made or gone, the
 * window resized), then rests; nothing runs while they are still. Without
 * animations (the user menu's switch, or reduced motion) they are drawn at
 * rest. Red and dashed while the Cloud Drive's storage does not answer.
 */
export const CloudDriveRopes: React.FC<{
	anchor: React.RefObject<HTMLElement | null>;
	workspaceIds: readonly string[];
	connected: boolean | null | undefined;
}> = ({ anchor, workspaceIds, connected }) => {
	const svg = useRef<SVGSVGElement>(null);
	const port = useRef<SVGCircleElement>(null);
	const paths = useRef(new Map<string, SVGPathElement>());
	const plugs = useRef(new Map<string, SVGCircleElement>());
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

		const measure = (): Ends | null => {
			const origin = root.getBoundingClientRect();
			const a = anchor.current?.getBoundingClientRect();
			if (!a || a.width === 0) {
				return null;
			}
			const ends = new Map<string, Point>();
			for (const id of ids) {
				const r = document
					.querySelector(`[data-testid="workspace-${CSS.escape(id)}"]`)
					?.getBoundingClientRect();
				if (r && r.height > 0) {
					ends.set(id, {
						x: r.right - origin.left - 1,
						y: r.top + r.height / 2 - origin.top,
					});
				}
			}
			return {
				from: {
					x: a.left + a.width / 2 - origin.left,
					y: a.bottom - origin.top,
				},
				ends,
			};
		};

		const draw = ({ from, ends }: Ends) => {
			port.current?.setAttribute("cx", `${from.x}`);
			port.current?.setAttribute("cy", `${from.y}`);
			port.current?.setAttribute(
				"visibility",
				ends.size ? "visible" : "hidden",
			);
			for (const [id, path] of paths.current) {
				const rope = ropes.get(id);
				const end = ends.get(id);
				const plug = plugs.current.get(id);
				path.setAttribute("d", rope && end ? ropePath(rope.points) : "");
				plug?.setAttribute("visibility", end ? "visible" : "hidden");
				if (end) {
					plug?.setAttribute("cx", `${end.x}`);
					plug?.setAttribute("cy", `${end.y}`);
				}
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
				if (!m.ends.has(id)) {
					ropes.delete(id);
				}
			}
			const where = [m.from, ...m.ends.values()]
				.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
				.join(" ");
			const moved = where !== seen;
			seen = where;

			if (still()) {
				if (moved) {
					for (const [id, end] of m.ends) {
						const rope = ropes.get(id) ?? makeRope(m.from, end);
						ropes.set(id, settle(rope, m.from, end));
					}
					draw(m);
				}
				last = 0;
				return;
			}

			const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);
			last = now;
			let motion = 0;
			for (const [id, end] of m.ends) {
				let rope = ropes.get(id);
				if (!rope) {
					rope = makeRope(m.from, end);
					ropes.set(id, rope);
				}
				for (let s = 0; s < SUBSTEPS; s++) {
					motion = Math.max(motion, stepRope(rope, m.from, end, dt / SUBSTEPS));
				}
			}
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
				<g key={id} data-workspace={id}>
					<path
						className="cd-rope"
						ref={(el) => {
							if (el) {
								paths.current.set(id, el);
							} else {
								paths.current.delete(id);
							}
						}}
					/>
					<circle
						className="cd-plug"
						r={3}
						visibility="hidden"
						ref={(el) => {
							if (el) {
								plugs.current.set(id, el);
							} else {
								plugs.current.delete(id);
							}
						}}
					/>
				</g>
			))}
			<circle ref={port} className="cd-plug" r={3} visibility="hidden" />
		</svg>
	);
};
