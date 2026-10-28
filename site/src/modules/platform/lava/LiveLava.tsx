import { useEffect, useRef, useState } from "react";
import { animated, useAnimationSettings } from "../animations/animations";
import { lavaRenderer } from "./drawLava";
import { type LavaSettings, lavaVariation } from "./lava";

type Painter = (now: number) => void;

/** One frame loop for every copy on the page, at most 30 frames a second. */
const painters = new Set<Painter>();
let frame = 0;
let last = 0;
const FRAME_MS = 1000 / 30;
const loop = (now: number) => {
	frame = painters.size > 0 ? requestAnimationFrame(loop) : 0;
	if (now - last < FRAME_MS) {
		return;
	}
	last = now;
	for (const paint of painters) {
		paint(now);
	}
};
const play = (paint: Painter) => {
	painters.add(paint);
	if (!frame) {
		frame = requestAnimationFrame(loop);
	}
	return () => {
		painters.delete(paint);
	};
};

/** Drawn at most this many pixels across, however large it shows. */
const MAX_PX = 768;
/** The size a lava picture shows at when nothing else sizes it, as its picture would (lavaPicture). */
const NATURAL_PX = 256;
/**
 * The canvas's first size: unlikely to be one its class names give, so a box
 * this size means nothing sized it and it takes NATURAL_PX, as a picture would.
 * (A canvas's pixels are also its size where nothing else sizes it.)
 */
const UNSIZED_PX = 257;

/**
 * Platform: one copy of a lava lamp, drawn live in a square canvas at the size
 * it shows. With vary on, each copy is its own (lavaVariation from a seed of
 * its own); without, copies are alike and in step (time counts from the
 * page's start for all). It moves only while on screen and while animated
 * pictures are on (Animations).
 */
export const LiveLava: React.FC<{
	settings: LavaSettings;
	/** Width and height in CSS pixels; without, the class names size it. */
	size?: number;
	/** This copy's variation; without, one of its own at random. */
	seed?: number;
	alt?: string;
	className?: string;
	style?: React.CSSProperties;
}> = ({ settings, size, seed: givenSeed, alt, className, style }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [ownSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
	const seed = givenSeed ?? ownSeed;
	const moving = animated(useAnimationSettings(), "gifs");

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) {
			return;
		}
		const variation = settings.vary ? lavaVariation(settings, seed) : undefined;
		let draw: ReturnType<typeof lavaRenderer> | undefined;
		let px = 0;
		let seconds = 0;
		const paint = (now: number) => {
			seconds = now / 1000;
			draw?.(ctx, settings, seconds, variation);
		};
		const resize = (width: number, height: number) => {
			const next = Math.min(
				MAX_PX,
				Math.max(16, Math.round(Math.max(width, height) * devicePixelRatio)),
			);
			if (next === px) {
				return;
			}
			px = next;
			canvas.width = px;
			canvas.height = px;
			try {
				draw = lavaRenderer(px);
			} catch {
				draw = undefined;
			}
			draw?.(ctx, settings, seconds, variation);
		};
		const box = canvas.getBoundingClientRect();
		if (
			!size &&
			Math.round(box.width) === UNSIZED_PX &&
			Math.round(box.height) === UNSIZED_PX
		) {
			canvas.style.height = `${NATURAL_PX}px`;
		}
		resize(size ?? box.width, size ?? box.height);
		paint(moving ? performance.now() : 0);
		const sized = new ResizeObserver(([entry]) =>
			resize(entry.contentRect.width, entry.contentRect.height),
		);
		sized.observe(canvas);
		if (!moving) {
			return () => sized.disconnect();
		}
		let stop: (() => void) | undefined;
		const seen = new IntersectionObserver(([entry]) => {
			if (entry.isIntersecting) {
				stop ??= play(paint);
			} else {
				stop?.();
				stop = undefined;
			}
		});
		seen.observe(canvas);
		return () => {
			sized.disconnect();
			seen.disconnect();
			stop?.();
		};
	}, [settings, seed, moving, size]);

	return (
		<canvas
			ref={canvasRef}
			width={UNSIZED_PX}
			height={UNSIZED_PX}
			role="img"
			aria-label={alt || undefined}
			aria-hidden={alt ? undefined : true}
			className={className}
			style={size ? { width: size, height: size, ...style } : style}
		/>
	);
};
