import { EyeIcon, FileIcon, PencilIcon } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { cloudDriveGlance, cloudDrivePeers } from "#/api/queries/platform";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import {
	resolvePlatformAvatar,
	usePlatformSnapshot,
} from "#/contexts/platformBoot";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import { motionless, ROPES_AREA } from "./CloudDriveRopes";
import {
	type Cable,
	cablePath,
	type Point,
	plugAngle,
	reelSpeed,
	seat,
	stepCable,
} from "./cables";
import { formatBytes } from "./drivePaths";
import { GAP, PLUG } from "./shareCables";
import {
	type ButtonBox,
	CLOUD_H,
	CLOUD_PATH,
	CLOUD_W,
	cloudXs,
	type SharedDrive,
	SOCKET_H,
	SOCKET_W,
	sharedDrives,
	spotAt,
	tetherRest,
} from "./sharedClouds";
import { baseName } from "./sharedWithYou";
import "./cloudDrive.css";

const SUBSTEPS = 2;
const REST_FRAMES = 20;
/** A new cloud drifts in this long (ms) before its cable drops into the socket; they come one after another. */
const ARRIVE_MS = 380;
const STAGGER_MS = 140;
/** An ended share's plug pops out of the socket (ms), its cable reels into the cloud, and the cloud fades (ms). */
const UNPLUG_MS = 260;
const VANISH_MS = 420;
/** How many of its newest files the HUD lists. */
const LISTED = 6;
/** The avatar inside the cloud: its middle (px from the cloud's corner) and size. */
const AVATAR = { x: 24, y: 23, size: 20 };

type Tether = Cable & {
	drive: SharedDrive;
	phase:
		| "arriving"
		| "seating"
		| "plugged"
		| "unplugging"
		| "reeling"
		| "vanishing";
	/** Where its cable comes down on the button now (it glides to its place when another cloud leaves). */
	x: number;
	end: Point;
	v: Point;
	since: number;
};

/**
 * The Cloud Drives shared with the user, on the Workspaces page: a dotted cloud for each, floating above their Cloud
 * Drive button (`anchor`) with the owner's avatar inside and a cable down into a socket on the button - another drive
 * connected to theirs (green dots and prongs read and write, blue read only). A new one drifts in and plugs in; when
 * the share ends, the plug pops out, the cable reels into the cloud and the cloud fades away. Pointed at (or focused),
 * a HUD: whose it is, the access, how many files and how much, the newest of them; clicked, the Cloud Drive window
 * opens on it. Without animations they are drawn at rest.
 */
export const SharedDriveClouds: React.FC<{
	anchor: RefObject<HTMLElement | null>;
	onOpen: (owner: string) => void;
}> = ({ anchor, onOpen }) => {
	const peers = useQuery(cloudDrivePeers());
	const drives = useMemo(() => sharedDrives(peers.data), [peers.data]);
	const drivesRef = useRef(drives);
	const svg = useRef<SVGSVGElement>(null);
	const cables = useRef(new Map<string, SVGGElement>());
	const sockets = useRef(new Map<string, SVGGElement>());
	const clouds = useRef(new Map<string, HTMLElement>());
	const [shown, setShown] = useState<readonly SharedDrive[]>([]);
	const animations = useAnimationsEnabled();
	const kickRef = useRef<() => void>(() => {});

	useEffect(() => {
		drivesRef.current = drives;
		kickRef.current();
	}, [drives]);

	useEffect(() => {
		const root = svg.current;
		if (!root) {
			return;
		}
		const tethers = new Map<string, Tether>();
		let order: string[] = [];
		const still = () => !animations || motionless();
		let frame = 0;
		let last = 0;
		let resting = 0;
		let seen = "";
		let first = true;

		const sync = () =>
			setShown(order.map((o) => tethers.get(o)?.drive as SharedDrive));

		const measure = (): ButtonBox | null => {
			const el = anchor.current;
			const r = el?.getBoundingClientRect();
			if (!el || !r || r.width === 0) {
				return null;
			}
			const b = root.getBoundingClientRect();
			return {
				left: r.left - b.left,
				top: r.top - b.top,
				right: r.right - b.left,
			};
		};

		/** The clouds as the shares are: one drifting in for each new one, an ended one's going. */
		const reconcile = (button: ButtonBox, now: number) => {
			let changed = false;
			const current = new Map(drivesRef.current.map((d) => [d.owner, d]));
			for (const t of tethers.values()) {
				const d = current.get(t.drive.owner);
				if (d && d.access !== t.drive.access) {
					t.drive = d;
					changed = true;
				}
				if (!d && !["unplugging", "reeling", "vanishing"].includes(t.phase)) {
					if (t.phase === "plugged" || t.phase === "seating") {
						t.phase = "unplugging";
						t.v = { x: 40, y: -150 };
					} else {
						t.phase = "vanishing";
					}
					t.since = now;
				}
			}
			const fresh = drivesRef.current.filter((d) => !tethers.has(d.owner));
			const xs = cloudXs(button, order.length + fresh.length);
			fresh.forEach((d, i) => {
				const x = xs[order.length];
				const spot = spotAt(button, x);
				tethers.set(d.owner, {
					drive: d,
					phase: "arriving",
					x,
					end: { ...spot.from },
					v: { x: 0, y: 0 },
					since: now + (first ? i * STAGGER_MS : 0),
					handles: [{ ...spot.from }, { ...spot.from }],
					velocity: [
						{ x: 0, y: 0 },
						{ x: 0, y: 0 },
					],
				});
				order.push(d.owner);
				changed = true;
			});
			if (peers.isFetched) {
				first = false;
			}
			if (changed) {
				sync();
			}
		};

		const draw = (button: ButtonBox, now: number) => {
			const f = (n: number) => Math.round(n * 10) / 10;
			for (const [owner, t] of tethers) {
				const spot = spotAt(button, t.x);
				const cloud = clouds.current.get(owner);
				if (cloud) {
					cloud.style.transform = `translate(${f(spot.corner.x)}px,${f(spot.corner.y)}px)`;
					// its drift in starts as it shows (one after another)
					const phase = t.since > now ? "waiting" : t.phase;
					cloud.style.visibility = phase === "waiting" ? "hidden" : "visible";
					if (cloud.dataset.phase !== phase) {
						cloud.dataset.phase = phase;
					}
				}
				const socket = sockets.current.get(owner);
				if (socket) {
					socket.setAttribute(
						"visibility",
						t.since > now || t.phase === "vanishing" ? "hidden" : "visible",
					);
					socket.setAttribute(
						"transform",
						`translate(${f(spot.socket.x)},${f(spot.socket.y)})`,
					);
				}
				const g = cables.current.get(owner);
				if (!g) {
					continue;
				}
				const drawn = !["arriving", "vanishing"].includes(t.phase);
				g.setAttribute("visibility", drawn ? "visible" : "hidden");
				g.dataset.phase = t.phase;
				if (drawn) {
					const d = cablePath(spot.from, t, t.end);
					for (const path of g.querySelectorAll("path")) {
						path.setAttribute("d", d);
					}
					// in its socket it points straight down, whatever the cable does; loose, along the cable
					const angle =
						t.phase === "plugged" ? 90 : (plugAngle(t, t.end) * 180) / Math.PI;
					g.querySelector(".cd-plug")?.setAttribute(
						"transform",
						`translate(${f(t.end.x)},${f(t.end.y)}) rotate(${Math.round(angle)})`,
					);
				}
			}
		};

		const latched = (el: Element | null | undefined, name: string) => {
			el?.classList.remove(name);
			void el?.getBoundingClientRect();
			el?.classList.add(name);
		};

		const remove = (owner: string) => {
			tethers.delete(owner);
			order = order.filter((o) => o !== owner);
		};

		const tick = (now: number) => {
			frame = 0;
			const button = measure();
			if (!button) {
				for (const el of clouds.current.values()) {
					el.style.visibility = "hidden";
				}
				root.setAttribute("visibility", "hidden");
				return;
			}
			root.removeAttribute("visibility");
			reconcile(button, now);
			const xs = cloudXs(button, order.length);
			const where = `${Math.round(button.left)},${Math.round(button.top)},${Math.round(button.right)} ${order.join(",")}`;
			const moved = where !== seen;
			seen = where;

			if (still()) {
				let removed = false;
				order.forEach((owner, i) => {
					const t = tethers.get(owner);
					if (!t) {
						return;
					}
					if (["unplugging", "reeling", "vanishing"].includes(t.phase)) {
						tethers.delete(owner);
						removed = true;
						return;
					}
					t.x = xs[i];
				});
				if (removed) {
					order = order.filter((o) => tethers.has(o));
					sync();
					const again = cloudXs(button, order.length);
					order.forEach((o, i) => {
						const t = tethers.get(o);
						if (t) {
							t.x = again[i];
						}
					});
				}
				for (const t of tethers.values()) {
					const spot = spotAt(button, t.x);
					t.phase = "plugged";
					t.since = Math.min(t.since, now);
					t.end = { ...spot.end };
					const r = tetherRest(spot.from, spot.end);
					t.handles = [{ ...r[0] }, { ...r[1] }];
				}
				draw(button, now);
				last = 0;
				return;
			}

			const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);
			last = now;
			const h = dt / SUBSTEPS;
			let motion = 0;
			let busy = false;
			let removed = false;
			order.forEach((owner, i) => {
				const t = tethers.get(owner);
				if (!t) {
					return;
				}
				if (t.since > now) {
					busy = true;
					return;
				}
				for (let s = 0; s < SUBSTEPS; s++) {
					// it glides to its place (another cloud left, the button moved)
					const glide = (xs[i] - t.x) * Math.min(1, 12 * h);
					t.x += glide;
					motion = Math.max(motion, Math.abs(glide));
					const spot = spotAt(button, t.x);
					if (t.phase === "arriving") {
						busy = true;
						t.end = { ...spot.from };
						t.handles = [{ ...spot.from }, { ...spot.from }];
						if (now - t.since > ARRIVE_MS) {
							t.phase = "seating";
							t.v = { x: 0, y: 0 };
						}
						continue;
					}
					if (t.phase === "plugged") {
						t.end = { ...spot.end };
					} else if (t.phase === "seating") {
						busy = true;
						if (seat(t.end, t.v, spot.end, h)) {
							t.phase = "plugged";
							t.end = { ...spot.end };
							t.v = { x: 0, y: 0 };
							latched(cables.current.get(owner), "cd-latched");
							latched(sockets.current.get(owner), "cd-gulp");
						}
					} else if (t.phase === "unplugging") {
						// out of the socket with a jolt, slowing
						busy = true;
						t.v.x *= 0.9;
						t.v.y *= 0.9;
						t.end.x += t.v.x * h;
						t.end.y += t.v.y * h;
						if (now - t.since > UNPLUG_MS) {
							t.phase = "reeling";
							t.since = now;
						}
					} else if (t.phase === "reeling") {
						// into the cloud, slow then fast
						busy = true;
						const dx = spot.from.x - t.end.x;
						const dy = spot.from.y - t.end.y;
						const d = Math.hypot(dx, dy);
						const step = reelSpeed((now - t.since) / 1000) * h;
						if (d <= step || d < 1.5) {
							t.end = { ...spot.from };
							t.phase = "vanishing";
							t.since = now;
						} else {
							t.end.x += (dx / d) * step;
							t.end.y += (dy / d) * step;
						}
					} else if (t.phase === "vanishing") {
						busy = true;
						if (now - t.since > VANISH_MS) {
							remove(owner);
							removed = true;
							break;
						}
						continue;
					}
					const rest =
						t.phase === "plugged" || t.phase === "seating"
							? tetherRest(spot.from, spot.end)
							: tetherRest(spot.from, t.end);
					motion = Math.max(motion, stepCable(t, rest, h));
				}
			});
			if (removed) {
				sync();
			}
			draw(button, now);
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
		const area = root.closest(`[${ROPES_AREA}]`);
		const resize = new ResizeObserver(kick);
		if (area) {
			resize.observe(area);
		}
		if (anchor.current) {
			resize.observe(anchor.current);
		}
		window.addEventListener("resize", kick);
		const poll = window.setInterval(kick, 1000);
		return () => {
			cancelAnimationFrame(frame);
			kickRef.current = () => {};
			resize.disconnect();
			window.removeEventListener("resize", kick);
			window.clearInterval(poll);
		};
	}, [animations, anchor, peers.isFetched]);

	/** A cloud pointed at (or its HUD open): its cable lights up. */
	const lit = (owner: string, on: boolean) => {
		const g = cables.current.get(owner);
		if (on) {
			g?.setAttribute("data-lit", "");
		} else {
			g?.removeAttribute("data-lit");
		}
	};

	const register =
		<T extends Element>(map: Map<string, T>, owner: string) =>
		(el: T | null) => {
			if (el) {
				map.set(owner, el);
			} else {
				map.delete(owner);
			}
		};

	return (
		<div className="cd-clouds" data-testid="shared-drive-clouds">
			<svg ref={svg} aria-hidden className="cd-ropes">
				{/* the sockets under the plugs: their prongs show going in */}
				{shown.map((d) => (
					<g
						key={d.owner}
						data-cloud-socket={d.owner}
						className="cd-cloud-socket"
						visibility="hidden"
						ref={register(sockets.current, d.owner)}
					>
						<rect
							className="cd-socket"
							x={-SOCKET_W / 2}
							y={-SOCKET_H}
							width={SOCKET_W}
							height={SOCKET_H + 1}
							rx={2}
						/>
					</g>
				))}
				{shown.map((d) => (
					<g
						key={d.owner}
						data-tether={d.owner}
						data-access={d.access}
						className="cd-share cd-tether"
						visibility="hidden"
						ref={register(cables.current, d.owner)}
					>
						<path className="cd-cable" />
						<path className="cd-cable-shine" />
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
				))}
			</svg>
			{shown.map((d) => (
				<SharedCloud
					key={d.owner}
					drive={d}
					cloudRef={register(clouds.current, d.owner)}
					onLit={(on) => lit(d.owner, on)}
					onOpen={() => onOpen(d.owner)}
				/>
			))}
		</div>
	);
};

const accessWords = (access: SharedDrive["access"]) =>
	access === "write" ? "read and write" : "read only";

/** One shared drive's cloud: the owner's avatar in a dotted cloud; its HUD pointed at; its files clicked. */
const SharedCloud: React.FC<{
	drive: SharedDrive;
	cloudRef: (el: HTMLButtonElement | null) => void;
	onLit: (on: boolean) => void;
	onOpen: () => void;
}> = ({ drive, cloudRef, onLit, onOpen }) => {
	const [open, setOpen] = useState(false);
	const glance = useQuery(cloudDriveGlance(drive.owner, open, drive.part?.id));
	const platform = usePlatformSnapshot();
	const src = resolvePlatformAvatar(platform, drive.ownerName, undefined);
	const name = glance.data?.owner?.name || drive.ownerName;
	const initials =
		name
			.split(/[\s._-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0])
			.join("")
			.toUpperCase() || "?";
	const avatar = (size: number, className: string) => (
		<span
			className={className}
			style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
		>
			{src ? <img src={src} alt="" /> : initials}
		</span>
	);
	const data = glance.data;

	return (
		<Tooltip
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				onLit(next);
			}}
		>
			<TooltipTrigger asChild>
				<button
					type="button"
					ref={cloudRef}
					className="cd-cloud"
					data-testid={`shared-drive-cloud-${drive.owner}`}
					data-access={drive.access}
					data-phase="waiting"
					style={{ width: CLOUD_W, height: CLOUD_H, visibility: "hidden" }}
					aria-label={`${drive.ownerName}'s Cloud Drive, shared with you (${accessWords(drive.access)}): open it`}
					onClick={() => {
						setOpen(false);
						onLit(false);
						onOpen();
					}}
				>
					<span className="cd-cloud-body">
						<svg
							aria-hidden
							width={CLOUD_W}
							height={CLOUD_H}
							viewBox={`0 0 ${CLOUD_W} ${CLOUD_H}`}
						>
							<path className="cd-cloud-outline" d={CLOUD_PATH} />
						</svg>
						<span
							className="absolute"
							style={{
								left: AVATAR.x - AVATAR.size / 2,
								top: AVATAR.y - AVATAR.size / 2,
							}}
						>
							{avatar(AVATAR.size, "cd-cloud-avatar")}
						</span>
					</span>
				</button>
			</TooltipTrigger>
			<TooltipContent
				className="w-72 px-3 py-2.5"
				data-testid="shared-drive-hud"
			>
				<div className="flex items-center gap-2.5">
					{avatar(32, "cd-cloud-avatar shrink-0")}
					<div className="min-w-0">
						<p className="m-0 truncate font-semibold text-content-primary">
							{name}
							{name !== drive.ownerName && (
								<span className="font-normal text-content-secondary">
									{" "}
									@{drive.ownerName}
								</span>
							)}
						</p>
						<p className="m-0 text-content-secondary">
							{drive.part
								? `shares their ${drive.part.kind} ${baseName(drive.part.path)} with you${drive.part.more > 0 ? ` (and ${drive.part.more} more)` : ""}`
								: "shares their Cloud Drive with you"}
						</p>
					</div>
				</div>
				<dl className="m-0 mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-0 border-t border-solid border-border pt-2">
					<dt>Access</dt>
					<dd
						className="m-0 flex items-center gap-1.5 text-content-primary"
						data-testid="shared-drive-hud-access"
					>
						{drive.access === "write" ? (
							<PencilIcon
								aria-hidden
								className="size-3.5 text-content-success"
							/>
						) : (
							<EyeIcon aria-hidden className="size-3.5 text-content-link" />
						)}
						{drive.access === "write"
							? "Read and write: open, add, change and delete"
							: "Read only: open and download"}
					</dd>
					<dt>Shared</dt>
					<dd
						className="m-0 tabular-nums text-content-primary"
						data-testid="shared-drive-hud-size"
					>
						{data
							? `${formatBytes(data.usedBytes)} in ${data.files} ${data.files === 1 ? "file" : "files"}`
							: glance.isError
								? "-"
								: "Reading…"}
					</dd>
				</dl>
				<ul className="m-0 mt-2 flex list-none flex-col gap-0.5 border-0 border-t border-solid border-border p-0 pt-2">
					{glance.isError ? (
						<li className="text-content-destructive">
							{getErrorMessage(glance.error, "Its files could not be read.")}
						</li>
					) : !data ? (
						<li className="text-content-secondary">Reading…</li>
					) : data.files === 0 ? (
						<li className="text-content-secondary">No files yet</li>
					) : (
						<>
							<li className="text-content-secondary">Newest files</li>
							{data.newest.slice(0, LISTED).map((file) => (
								<li key={file.path} className="flex items-center gap-1.5">
									<FileIcon
										aria-hidden
										className="size-3.5 shrink-0 text-content-secondary"
									/>
									<span
										className="min-w-0 flex-1 truncate text-content-primary"
										title={file.path}
									>
										{file.path}
									</span>
									<span className="shrink-0 tabular-nums">
										{formatBytes(file.size)}
									</span>
								</li>
							))}
							{data.files > LISTED && (
								<li className="text-content-secondary">
									and {data.files - Math.min(LISTED, data.newest.length)} more
								</li>
							)}
						</>
					)}
				</ul>
				<p className="m-0 mt-2 border-0 border-t border-solid border-border pt-2 text-content-secondary">
					Click to open it. Your workspaces have it at{" "}
					<code className="text-content-primary">
						~/cloud-drive-shared/{drive.ownerName}
						{drive.part ? `/${baseName(drive.part.path)}` : ""}
					</code>{" "}
					from their next start.
				</p>
			</TooltipContent>
		</Tooltip>
	);
};
