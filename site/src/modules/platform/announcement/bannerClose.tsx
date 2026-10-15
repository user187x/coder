import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { BannerCloseEffect } from "#/api/platform";
import "./bannerClose.css";

/** The close transitions, as the editor offers them. */
export const CLOSE_EFFECT_OPTIONS: Record<
	BannerCloseEffect,
	{ label: string; hint: string }
> = {
	none: { label: "None", hint: "It goes at once." },
	pixelate: {
		label: "Pixelate",
		hint: "It breaks into ever bigger pixels, then fades.",
	},
	rollup: { label: "Roll up", hint: "It rolls up like a blind." },
	fade: { label: "Fade", hint: "It fades out." },
	wipe: { label: "Wipe", hint: "It is wiped away from left to right." },
	matrix: {
		label: "Matrix",
		hint: "Green code rains down over it as it dissolves.",
	},
	gaussian: { label: "Gaussian blur", hint: "It blurs away." },
	evaporate: {
		label: "Evaporate",
		hint: "It rises and evaporates from the bottom up.",
	},
};

/** The longest transition, and a little more: the banner goes then even if no animation ends. */
const CLOSE_FALLBACK_MS = 1600;

const motionOff = () =>
	(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false) ||
	document.documentElement.dataset.animations === "off";

/**
 * Plays the banner's close transition (bannerClose.css) on the element given
 * `props`, then calls onDone; at once for "none", or without motion.
 */
export const useCloseTransition = (
	effect: BannerCloseEffect,
	onDone: () => void,
) => {
	const [closing, setClosing] = useState(false);
	const done = useRef(onDone);
	useLayoutEffect(() => {
		done.current = onDone;
	});
	useEffect(() => {
		if (!closing) {
			return;
		}
		const timer = window.setTimeout(() => done.current(), CLOSE_FALLBACK_MS);
		return () => window.clearTimeout(timer);
	}, [closing]);
	const start = useCallback(() => {
		if (effect === "none" || motionOff()) {
			done.current();
			return;
		}
		setClosing(true);
	}, [effect]);
	return {
		closing,
		start,
		props: {
			"data-closing": closing ? effect : undefined,
			onAnimationEnd: (event: React.AnimationEvent<HTMLElement>) => {
				if (
					closing &&
					event.target === event.currentTarget &&
					event.animationName.startsWith("banner-close-")
				) {
					done.current();
				}
			},
		},
	};
};

const PIXEL_SIZES = [2, 4, 8, 12, 16];
const MATRIX_COLUMNS = 48;
const MATRIX_GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ";

const glyphs = (seed: number, n: number) =>
	Array.from(
		{ length: n },
		(_, i) => MATRIX_GLYPHS[(seed * 7 + i * 13) % MATRIX_GLYPHS.length],
	).join("");

/**
 * What a transition draws besides the banner itself: the pixelate's SVG
 * filters, the matrix's rain. Inside the banner, while it closes.
 */
export const CloseLayers: React.FC<{ effect: BannerCloseEffect }> = ({
	effect,
}) => {
	if (effect === "pixelate") {
		return (
			<svg aria-hidden width="0" height="0" className="absolute">
				<defs>
					{PIXEL_SIZES.map((n) => (
						<filter
							key={n}
							id={`banner-px-${n}`}
							x="0"
							y="0"
							width="100%"
							height="100%"
						>
							<feFlood x={n / 2} y={n / 2} width="1" height="1" />
							<feComposite width={n} height={n} />
							<feTile result="grid" />
							<feComposite in="SourceGraphic" in2="grid" operator="in" />
							<feMorphology operator="dilate" radius={n / 2} />
						</filter>
					))}
				</defs>
			</svg>
		);
	}
	if (effect === "matrix") {
		return (
			<span aria-hidden className="banner-matrix">
				{Array.from({ length: MATRIX_COLUMNS }, (_, i) => (
					<span
						key={i}
						style={{
							left: `${(i / MATRIX_COLUMNS) * 100}%`,
							animationDelay: `${(i * 37) % 320}ms`,
						}}
					>
						{glyphs(i, 6)}
					</span>
				))}
			</span>
		);
	}
	return null;
};
