import { createPortal } from "react-dom";
import type { BackgroundImage, BackgroundSlot } from "#/api/platform";
import { isEmbeddedFrame, usePlatformSnapshot } from "#/contexts/platformBoot";

/** CSS for a background image: how it fills the window, and how faint it is. */
export const backgroundStyle = (
	image: Pick<BackgroundImage, "url" | "opacity" | "fit">,
): React.CSSProperties => ({
	backgroundImage: `url("${image.url}")`,
	backgroundPosition: "center",
	backgroundRepeat: image.fit === "tile" ? "repeat" : "no-repeat",
	backgroundSize: image.fit === "tile" ? "auto" : image.fit,
	opacity: image.opacity,
});

/**
 * The background image of the sign-in page or of the dashboard (Admin settings
 * > Customize): one fixed layer the size of the window, faint and ignored by
 * the mouse, added to the page without touching any of its own styles. "Under"
 * lies behind the page's content (z-index -1: it shows where the page has no
 * background of its own); "over" is a watermark above it.
 */
export const PlatformBackground: React.FC<{ slot: BackgroundSlot }> = ({
	slot,
}) => {
	const image = usePlatformSnapshot().backgrounds[slot];
	// A page in another page's frame: the page around it has the background.
	if (!image || isEmbeddedFrame()) {
		return null;
	}
	return createPortal(
		<div
			aria-hidden
			data-testid="platform-background"
			data-slot={slot}
			className="pointer-events-none fixed inset-0 select-none"
			style={{
				...backgroundStyle(image),
				zIndex: image.layer === "over" ? 2147483000 : -1,
			}}
		/>,
		document.body,
	);
};
