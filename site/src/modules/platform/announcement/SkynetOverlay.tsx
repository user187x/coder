import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./skynetOverlay.css";

/** The image (site/static/skynet.webp). */
export const SKYNET_SRC = "/skynet.webp";
/** How long the glitch out takes (skynetOverlay.css: skynet-out). */
export const SKYNET_OUT_MS = 900;
/** Input this soon after it shows is the typing that summoned it, not a dismissal. */
const SETTLE_MS = 400;

type SkynetOverlayProps = {
	/** Called once it has faded out. */
	onDone: () => void;
};

/**
 * The announcement terminal's easter egg (BannerScrollView: type "skynet"):
 * the whole screen fades into Skynet. A click or any key dismisses it, and it
 * leaves with a glitch - the picture tears into shifted, colour-split slices,
 * then collapses like an old screen switching off. Without animations (the
 * setting, or reduced motion) it simply fades.
 */
export const SkynetOverlay: React.FC<SkynetOverlayProps> = ({ onDone }) => {
	const [leaving, setLeaving] = useState(false);

	useEffect(() => {
		const shown = Date.now();
		let left = false;
		let timer: number | undefined;
		const dismiss = (event: Event) => {
			if (left || Date.now() - shown < SETTLE_MS) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			left = true;
			event.preventDefault();
			event.stopPropagation();
			setLeaving(true);
			timer = window.setTimeout(onDone, SKYNET_OUT_MS);
		};
		document.addEventListener("pointerdown", dismiss, true);
		document.addEventListener("keydown", dismiss, true);
		return () => {
			document.removeEventListener("pointerdown", dismiss, true);
			document.removeEventListener("keydown", dismiss, true);
			window.clearTimeout(timer);
		};
	}, [onDone]);

	return createPortal(
		<div
			className="skynet"
			role="img"
			aria-label="Skynet"
			data-testid="skynet"
			data-leaving={leaving || undefined}
			style={{ "--skynet": `url(${SKYNET_SRC})` } as React.CSSProperties}
		>
			<img src={SKYNET_SRC} alt="" draggable={false} />
		</div>,
		document.body,
	);
};
