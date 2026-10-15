import { useBannerClock } from "./bannerClock";
import { countdownText } from "./bannerTokens";
import "./bannerCountdown.css";

/** One plate of the clock: a black rounded square, split across the middle; its character flips in when it changes. */
const Plate: React.FC<{ value: string; unit?: boolean }> = ({
	value,
	unit = false,
}) => (
	<span
		className="banner-flapclock-plate"
		data-unit={unit ? "" : undefined}
		data-flap=""
	>
		{/* A new key for a new character: it flips in (bannerCountdown.css). */}
		<span key={value} className="banner-flapclock-char">
			{value}
		</span>
	</span>
);

const Plates: React.FC<{ value: number; width: number }> = ({
	value,
	width,
}) => (
	<>
		{Array.from(String(value).padStart(width, "0")).map((digit, i) => (
			<Plate key={i} value={digit} />
		))}
	</>
);

const Colon: React.FC = () => (
	<span className="banner-flapclock-colon" aria-hidden>
		<i />
		<i />
	</span>
);

/**
 * The announcement's countdown: a split-flap clock at the banner's left,
 * before the message - days (when there are any), hours, minutes and seconds,
 * each digit on its own black rounded plate, flipping as it changes. At zero
 * it blinks 00:00:00.
 */
export const BannerCountdown: React.FC<{ to: string }> = ({ to }) => {
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
			className="banner-flapclock"
		>
			{days > 0 && (
				<>
					<Plates value={days} width={1} />
					<Plate value="D" unit />
				</>
			)}
			<Plates value={hours} width={2} />
			<Colon />
			<Plates value={minutes} width={2} />
			<Colon />
			<Plates value={seconds} width={2} />
		</span>
	);
};
