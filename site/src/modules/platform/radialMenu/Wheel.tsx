import { cn } from "cn";
import { type LucideIcon, MenuIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import "./radialMenu.css";

// The wheel (radial-menu.html): wedges round a centre that shows the one pointed at, its icon and name.
const SIZE = 600;
const CENTER = SIZE / 2;
const OUTER = 280;
const INNER = 110;
const TEXT_RADIUS = 255;
const ICON_RADIUS = 185;
const ICON = 34;
const PAD_DEGREES = 2;

const polar = (radius: number, degrees: number) => {
	const r = ((degrees - 90) * Math.PI) / 180;
	return { x: CENTER + radius * Math.cos(r), y: CENTER + radius * Math.sin(r) };
};

/** A wedge of the ring: between two angles, a little apart from its neighbours. */
const wedgePath = (start: number, end: number) => {
	const a = polar(OUTER, start + PAD_DEGREES);
	const b = polar(OUTER, end - PAD_DEGREES);
	const c = polar(INNER, end - PAD_DEGREES);
	const d = polar(INNER, start + PAD_DEGREES);
	const large = end - start <= 180 ? 0 : 1;
	return `M ${a.x} ${a.y} A ${OUTER} ${OUTER} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${INNER} ${INNER} 0 ${large} 0 ${d.x} ${d.y} Z`;
};

/** The arc a wedge's name runs along: reversed in the lower half, so it reads left to right there too. */
const textArc = (start: number, end: number) => {
	const mid = (start + end) / 2;
	const lower = mid > 90 && mid < 270;
	const from = polar(TEXT_RADIUS, lower ? end : start);
	const to = polar(TEXT_RADIUS, lower ? start : end);
	return `M ${from.x} ${from.y} A ${TEXT_RADIUS} ${TEXT_RADIUS} 0 0 ${lower ? 0 : 1} ${to.x} ${to.y}`;
};

/** A name's size on its wedge's arc: 13 px (radial-menu.html's), smaller for a long name on a narrow wedge. */
export const labelSize = (label: string, step: number) => {
	const arc = ((2 * Math.PI * TEXT_RADIUS * step) / 360) * 0.85;
	// an upper-case letter is about 0.62 of the size wide, and 2 px apart
	const fit = (arc / Math.max(1, label.length) - 2) / 0.62;
	return Math.max(8, Math.min(13, Math.floor(fit * 10) / 10));
};

export type WheelItem = {
	id: string;
	name: string;
	icon: LucideIcon;
	/** The user may go there; else the wedge is dimmed and says why. */
	allowed: boolean;
	why?: string;
};

/**
 * Each wedge's own colour, pointed at (or focused) and chosen, round the wheel in this order: emerald first, as it
 * always was, then the rest, so neighbours never share one.
 */
export const PETAL_COLOURS = [
	"#10b981",
	"#38bdf8",
	"#a78bfa",
	"#f59e0b",
	"#f472b6",
	"#2dd4bf",
	"#fb923c",
	"#818cf8",
	"#facc15",
	"#f87171",
] as const;

/** A wedge's colour by its place round the wheel; the last never repeats the first (the wheel is a circle). */
export const petalColour = (index: number, count: number) => {
	const n = PETAL_COLOURS.length;
	const colour = PETAL_COLOURS[index % n];
	return index === count - 1 && index % n === 0 && count > 1
		? PETAL_COLOURS[(index + 1) % n]
		: colour;
};

type WheelProps = {
	items: readonly WheelItem[];
	/** A wedge chosen (a click, Enter); none: the wheel only lights up (a preview). */
	onChoose?: (index: number) => void;
	/** The wedge being chosen: shown white. */
	chosen?: number | null;
	/** The first wedge that opens takes the focus when the wheel appears (the overlay). */
	autoFocus?: boolean;
	/** The wedges' test IDs' prefix. */
	testIdPrefix?: string;
	className?: string;
};

/**
 * Platform: the quick access wheel itself (radial-menu.html) - its wedges round a centre that names the one pointed
 * at or focused, a dimmed one saying why it is closed. The arrow keys go round it, Enter chooses. The Escape overlay
 * (RadialMenu) and Admin Settings > Quick Menu's preview draw it.
 */
export const Wheel: React.FC<WheelProps> = ({
	items,
	onChoose,
	chosen = null,
	autoFocus = false,
	testIdPrefix = "radial",
	className,
}) => {
	const [hovered, setHovered] = useState<number | null>(null);
	const wedges = useRef<(SVGPathElement | null)[]>([]);
	const id = useId();
	const step = 360 / Math.max(1, items.length);

	// the first wedge that opens, focused as the wheel appears - and again once a menu that closed on the same Escape
	// has given its trigger the focus back
	useEffect(() => {
		if (!autoFocus) {
			return;
		}
		const first = () => wedges.current[items.findIndex((i) => i.allowed)];
		first()?.focus();
		const again = window.setTimeout(() => {
			if (!document.activeElement?.closest("[data-radial-menu]")) {
				first()?.focus();
			}
		}, 80);
		return () => window.clearTimeout(again);
	}, [autoFocus]);

	const move = (from: number, by: number) => {
		for (let k = 1; k <= items.length; k++) {
			const next = (from + by * k + items.length * k) % items.length;
			if (items[next].allowed) {
				wedges.current[next]?.focus();
				return;
			}
		}
	};

	const shown = hovered ?? chosen;
	const label = shown === null ? "Menu" : (items[shown]?.name ?? "Menu");
	// nothing pointed at: the menu's own icon, a hamburger
	const ShownIcon = (shown !== null && items[shown]?.icon) || MenuIcon;
	const note =
		shown !== null && items[shown] && !items[shown].allowed
			? items[shown].why
			: undefined;

	return (
		<div
			className={cn("radial-wheel", className)}
			role="menu"
			aria-label="Go to"
		>
			<svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden={false}>
				<defs>
					{items.map((item, i) => (
						<path
							key={item.id}
							id={`${id}-arc-${i}`}
							d={textArc(i * step, (i + 1) * step)}
						/>
					))}
				</defs>
				{items.map((item, i) => {
					const at = polar(ICON_RADIUS, i * step + step / 2);
					const Icon = item.icon;
					const lit = hovered === i || chosen === i;
					return (
						<g
							key={item.id}
							className={cn(
								"radial-item",
								lit && "radial-item-lit",
								chosen === i && "radial-item-chosen",
								!item.allowed && "radial-item-off",
							)}
							// its own colour when pointed at or chosen (radialMenu.css)
							style={
								{
									"--petal": petalColour(i, items.length),
								} as React.CSSProperties
							}
							data-petal={petalColour(i, items.length)}
						>
							<path
								ref={(el) => {
									wedges.current[i] = el;
								}}
								className="radial-wedge"
								d={wedgePath(i * step, (i + 1) * step)}
								role="menuitem"
								tabIndex={item.allowed ? 0 : -1}
								aria-label={
									item.allowed ? item.name : `${item.name} (${item.why})`
								}
								aria-disabled={!item.allowed || undefined}
								data-testid={`${testIdPrefix}-${item.id}`}
								onMouseEnter={() => setHovered(i)}
								onMouseLeave={() => setHovered(null)}
								onFocus={() => setHovered(i)}
								onBlur={() => setHovered(null)}
								onClick={(e) => {
									e.stopPropagation();
									if (item.allowed) {
										onChoose?.(i);
									}
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										if (item.allowed) {
											onChoose?.(i);
										}
									} else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
										e.preventDefault();
										move(i, 1);
									} else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
										e.preventDefault();
										move(i, -1);
									} else if (e.key === "Tab" && onChoose) {
										e.preventDefault();
										move(i, e.shiftKey ? -1 : 1);
									}
								}}
							/>
							<Icon
								aria-hidden
								className="radial-icon"
								x={at.x - ICON / 2}
								y={at.y - ICON / 2}
								width={ICON}
								height={ICON}
							/>
							<text
								className="radial-text"
								aria-hidden
								style={{ fontSize: labelSize(item.name, step) }}
							>
								<textPath
									href={`#${id}-arc-${i}`}
									startOffset="50%"
									textAnchor="middle"
								>
									{item.name}
								</textPath>
							</text>
						</g>
					);
				})}
			</svg>
			<div
				className="radial-center"
				aria-live="polite"
				// the hub's icon in the colour of the wedge pointed at
				style={
					shown !== null && items[shown]?.allowed
						? ({
								"--petal": petalColour(shown, items.length),
							} as React.CSSProperties)
						: undefined
				}
			>
				<ShownIcon
					aria-hidden
					className="radial-center-icon"
					data-testid="radial-center-icon"
					data-wedge={shown === null ? "" : items[shown]?.id}
				/>
				<div className="radial-center-name">{label}</div>
				{note && <div className="radial-center-note">{note}</div>}
			</div>
		</div>
	);
};
