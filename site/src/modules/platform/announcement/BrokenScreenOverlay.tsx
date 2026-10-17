import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { breakScreen } from "./brokenScreen";
import "./brokenScreen.css";

/** How long the screen takes to break (brokenScreen.css), and to come back. */
export const BREAK_MS = 2600;
export const RESTORE_MS = 700;

const motionless = () =>
	document.documentElement.dataset.animations === "off" ||
	(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/**
 * The announcement terminal's other easter egg (BannerScrollView: "rm -rf *"): the screen breaks like a struck LCD
 * panel - a white flash and a shake, glass cracks running out from the impact to the edges, then black ink bleeding
 * from it and dead pixel columns down the panel, the page behind flickering. A console note says what happened, and
 * its button (Restore screen) puts everything back as it was: nothing was removed. Nothing on the page can be used
 * meanwhile. Without animations (the setting, or reduced motion) the screen is simply broken, and simply restored.
 */
export const BrokenScreenOverlay: React.FC<{ onDone: () => void }> = ({
	onDone,
}) => {
	const [restoring, setRestoring] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const still = useMemo(motionless, []);
	const screen = useMemo(
		() => breakScreen(window.innerWidth, window.innerHeight),
		[],
	);
	const [broken, setBroken] = useState(still);

	// The page behind it shakes and flickers while it breaks (a class on the root, removed after).
	useEffect(() => {
		const root = document.documentElement;
		root.dataset.screenBroken = "true";
		const done = window.setTimeout(() => setBroken(true), still ? 0 : BREAK_MS);
		return () => {
			window.clearTimeout(done);
			delete root.dataset.screenBroken;
		};
	}, [still]);

	useEffect(() => {
		if (broken) {
			button.current?.focus({ preventScroll: true });
		}
	}, [broken]);

	const restore = () => {
		if (restoring) {
			return;
		}
		setRestoring(true);
		window.setTimeout(onDone, still ? 0 : RESTORE_MS);
	};

	return createPortal(
		<div
			className="broken-screen"
			data-testid="broken-screen"
			data-still={still || undefined}
			data-restoring={restoring || undefined}
			role="alertdialog"
			aria-modal="true"
			aria-label="The screen is broken"
		>
			<div className="broken-screen-flash" aria-hidden />
			{screen.lines.map((line, i) => (
				<span
					key={`l${i}`}
					aria-hidden
					className="broken-screen-line"
					style={{
						left: line.x,
						width: line.width,
						background: line.color,
						color: line.color,
						animationDelay: `${900 + i * 140}ms`,
					}}
				/>
			))}
			{screen.blots.map((blot, i) => (
				<span
					key={`b${i}`}
					aria-hidden
					className="broken-screen-ink"
					style={{
						left: blot.x - blot.r,
						top: blot.y - blot.r,
						width: blot.r * 2,
						height: blot.r * 2,
						animationDelay: `${700 + i * 260}ms`,
					}}
				/>
			))}
			<svg
				aria-hidden
				className="broken-screen-glass"
				width="100%"
				height="100%"
				viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
				preserveAspectRatio="none"
			>
				{screen.cracks.map((d, i) => (
					<g
						key={`c${i}`}
						style={{ "--d": `${120 + (i % 17) * 22}ms` } as React.CSSProperties}
					>
						<path d={d} pathLength={1} className="broken-screen-crack-shadow" />
						<path d={d} pathLength={1} className="broken-screen-crack" />
					</g>
				))}
				{screen.rings.map((d, i) => (
					<path
						key={`r${i}`}
						d={d}
						pathLength={1}
						className="broken-screen-crack broken-screen-ring"
						style={{ "--d": `${260 + i * 18}ms` } as React.CSSProperties}
					/>
				))}
				<circle
					cx={screen.impact.x}
					cy={screen.impact.y}
					r={9}
					className="broken-screen-impact"
				/>
			</svg>
			{broken && (
				<div className="broken-screen-note">
					<pre>
						{`root@platform:~# rm -rf *
rm: removing everything... done.
Segmentation fault (screen dumped)`}
					</pre>
					<p>Just kidding: nothing was removed.</p>
					<button ref={button} type="button" onClick={restore}>
						Restore screen
					</button>
				</div>
			)}
		</div>,
		document.body,
	);
};
