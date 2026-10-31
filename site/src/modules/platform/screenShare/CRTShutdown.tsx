import { useEffect, useRef } from "react";
import { subscribeShareTermination } from "./media";

/** Animates the receiver shutting off after either participant ends the stream. */
export const CRTShutdown = () => {
	const screen = useRef<HTMLDivElement>(null);
	const light = useRef<HTMLDivElement>(null);
	useEffect(() => {
		let animations: Animation[] = [];
		const unsubscribe = subscribeShareTermination(() => {
			for (const animation of animations) animation.cancel();
			const reduced =
				window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
				document.documentElement.dataset.animations === "off";
			animations = [];
			if (!screen.current || !light.current) return;
			animations.push(
				screen.current.animate(
					[
						{ opacity: 1, offset: 0 },
						{ opacity: 1, offset: 0.7 },
						{ opacity: 0, offset: 1 },
					],
					{ duration: reduced ? 180 : 700, easing: "ease-out" },
				),
			);
			if (!reduced)
				animations.push(
					light.current.animate(
						[
							{ transform: "scale(1, 1)", opacity: 0.35, offset: 0 },
							{ transform: "scale(1, 0.008)", opacity: 1, offset: 0.4 },
							{ transform: "scale(0.006, 0.008)", opacity: 1, offset: 0.72 },
							{ transform: "scale(0, 0)", opacity: 0, offset: 1 },
						],
						{ duration: 500, easing: "ease-in-out" },
					),
				);
		});
		return () => {
			unsubscribe();
			for (const animation of animations) animation.cancel();
		};
	}, []);
	return (
		<div ref={screen} className="support-crt-shutdown" aria-hidden="true">
			<div ref={light} className="support-crt-shutdown-light" />
		</div>
	);
};
