import { useBannerClock } from "./bannerClock";
import "./dotMatrixTime.css";

/** 5x7 dot-matrix glyphs, a row a string ("1" lit), for the time's digits; the colon is a column of its own. */
const GLYPHS: Record<string, readonly string[]> = {
	"0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
	"1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
	"2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
	"3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
	"4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
	"5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
	"6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
	"7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
	"8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
	"9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
	":": ["0", "0", "1", "0", "1", "0", "0"],
};
const ROWS = 7;
/** Dot pitch and radius (px). */
const PITCH = 7;
const DOT = 2.6;

const two = (n: number) => String(n).padStart(2, "0");

/** The time as the terminal shows it: "HH:MM:SS", 24-hour, this browser's time zone. */
export const timeText = (at: number) => {
	const d = new Date(at);
	return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

/**
 * The announcement terminal's answer to "time": the time now on a dot-matrix display - every dot of each 5x7
 * character there, the lit ones glowing in the terminal's ink, the colons blinking with the seconds - ticking live,
 * with the date and time zone under it.
 */
export const DotMatrixTime: React.FC = () => {
	const now = useBannerClock();
	const text = timeText(now);
	const blink = Math.floor(now / 1000) % 2 === 1;
	// each character's columns, a blank column between characters
	const columns: { lit: boolean[]; colon: boolean }[] = [];
	for (const [i, ch] of Array.from(text).entries()) {
		const glyph = GLYPHS[ch];
		const width = glyph[0].length;
		for (let x = 0; x < width; x++) {
			columns.push({
				lit: glyph.map((row) => row[x] === "1"),
				colon: ch === ":",
			});
		}
		if (i < text.length - 1) {
			columns.push({ lit: Array(ROWS).fill(false), colon: false });
		}
	}
	const zone =
		new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
			.formatToParts(now)
			.find((p) => p.type === "timeZoneName")?.value ?? "";
	const date = new Date(now).toLocaleDateString(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
	});
	return (
		<div className="dot-matrix-time" data-testid="announcement-scroll-time">
			<svg
				role="img"
				aria-label={`The time: ${text}`}
				data-time={text}
				width={columns.length * PITCH}
				height={ROWS * PITCH}
				viewBox={`0 0 ${columns.length * PITCH} ${ROWS * PITCH}`}
			>
				{columns.flatMap((column, x) =>
					column.lit.map((lit, y) => {
						const on = lit && !(column.colon && blink);
						return (
							<circle
								// a dot is its place on the display
								key={`${x}-${y}`}
								cx={x * PITCH + PITCH / 2}
								cy={y * PITCH + PITCH / 2}
								r={DOT}
								className={on ? "dot-matrix-on" : "dot-matrix-off"}
							/>
						);
					}),
				)}
			</svg>
			<div className="dot-matrix-caption">
				{date}
				{zone && ` · ${zone}`}
			</div>
		</div>
	);
};
