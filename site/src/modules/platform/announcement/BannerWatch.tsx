import { useBannerClock } from "./bannerClock";
import { countdownText } from "./bannerTokens";
import "./bannerWatch.css";

// A seven-segment digit (12 x 20): segments a (top) to g (middle), each a
// long hexagon, with a hair of a gap between them.
const THICK = 2.2;
const HALF = THICK / 2;
const LEFT = 1.6;
const RIGHT = 10.4;
const TOP = 1.6;
const MIDDLE = 10;
const BOTTOM = 18.4;
const GAP = 0.45;

const across = (y: number, x1: number, x2: number) =>
	`${x1},${y} ${x1 + HALF},${y - HALF} ${x2 - HALF},${y - HALF} ${x2},${y} ${x2 - HALF},${y + HALF} ${x1 + HALF},${y + HALF}`;
const down = (x: number, y1: number, y2: number) =>
	`${x},${y1} ${x + HALF},${y1 + HALF} ${x + HALF},${y2 - HALF} ${x},${y2} ${x - HALF},${y2 - HALF} ${x - HALF},${y1 + HALF}`;

const SEGMENTS = {
	a: across(TOP, LEFT + GAP, RIGHT - GAP),
	b: down(RIGHT, TOP + GAP, MIDDLE - GAP),
	c: down(RIGHT, MIDDLE + GAP, BOTTOM - GAP),
	d: across(BOTTOM, LEFT + GAP, RIGHT - GAP),
	e: down(LEFT, MIDDLE + GAP, BOTTOM - GAP),
	f: down(LEFT, TOP + GAP, MIDDLE - GAP),
	g: across(MIDDLE, LEFT + GAP, RIGHT - GAP),
};
const NAMES = Object.keys(SEGMENTS) as (keyof typeof SEGMENTS)[];
/** The segments lit for 0 to 9. */
const LIT = [
	"abcdef",
	"bc",
	"abdeg",
	"abcdg",
	"bcfg",
	"acdfg",
	"acdefg",
	"abc",
	"abcdefg",
	"abcdfg",
];

/** One digit: its segments lit, the others faintly there, as on a watch's LCD. */
const Digit: React.FC<{ value: number }> = ({ value }) => (
	<svg viewBox="0 0 12 20" className="banner-watch-digit" aria-hidden>
		{NAMES.map((name) => (
			<polygon
				key={name}
				points={SEGMENTS[name]}
				data-lit={LIT[value]?.includes(name) ? "" : undefined}
			/>
		))}
	</svg>
);

const Digits: React.FC<{ value: number; width: number }> = ({
	value,
	width,
}) => (
	<>
		{Array.from(String(value).padStart(width, "0")).map((d, i) => (
			<Digit key={i} value={Number(d)} />
		))}
	</>
);

/**
 * The announcement's countdown: a digital watch's display at the banner's
 * left, before the message - days (when there are any), hours and minutes,
 * the seconds smaller beside them, the colon blinking. At zero it blinks
 * 00:00.
 */
export const BannerWatch: React.FC<{ to: string }> = ({ to }) => {
	const now = useBannerClock();
	const target = Date.parse(to);
	if (Number.isNaN(target)) {
		return null;
	}
	const left = Math.max(0, Math.floor((target - now) / 1000));
	const days = Math.floor(left / 86400);
	const hours = Math.floor((left % 86400) / 3600);
	const minutes = Math.floor((left % 3600) / 60);
	const seconds = left % 60;
	const done = left === 0;
	const when = new Date(target).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
	return (
		<span
			role="timer"
			aria-label={
				done
					? "Countdown finished"
					: `Countdown: ${countdownText({ to, format: "words", done: "" }, now)} left`
			}
			title={`Counts down to ${when}`}
			data-testid="announcement-countdown"
			data-done={done ? "" : undefined}
			className="banner-watch"
		>
			<span className="banner-watch-face">
				{days > 0 && (
					<>
						<Digits value={days} width={1} />
						<span className="banner-watch-unit">D</span>
					</>
				)}
				<Digits value={hours} width={2} />
				<span className="banner-watch-colon" aria-hidden>
					<i />
					<i />
				</span>
				<Digits value={minutes} width={2} />
				<span className="banner-watch-seconds">
					<Digits value={seconds} width={2} />
				</span>
			</span>
		</span>
	);
};
