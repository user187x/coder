import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { BackgroundImage, BackgroundSlot } from "#/api/platform";
import { isEmbeddedFrame, usePlatformSnapshot } from "#/contexts/platformBoot";

const size = (fit: BackgroundImage["fit"]) => (fit === "tile" ? "auto" : fit);
const repeat = (fit: BackgroundImage["fit"]) =>
	fit === "tile" ? "repeat" : "no-repeat";

/** CSS for a background image on its own layer: how it fills it, and how faint it is. */
export const backgroundStyle = (
	image: Pick<BackgroundImage, "url" | "opacity" | "fit">,
): React.CSSProperties => ({
	backgroundImage: `url("${image.url}")`,
	backgroundPosition: "center",
	backgroundRepeat: repeat(image.fit),
	backgroundSize: size(image.fit),
	opacity: image.opacity,
});

/** "rgb(9, 9, 11)" / "rgba(…)" as [r, g, b, a]; null when it is not one. */
export const parseRGB = (
	color: string,
): [number, number, number, number] | null => {
	const m =
		/^rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\)$/.exec(
			color.trim(),
		);
	return m
		? [
				Number(m[1]),
				Number(m[2]),
				Number(m[3]),
				m[4] === undefined ? 1 : Number(m[4]),
			]
		: null;
};

/**
 * The page's own background with the picture under it: a veil of the page's
 * colour, `1 - opacity` opaque, over the picture, so it shows at `opacity`
 * wherever the page has no background of its own.
 */
export const underlayLayers = (
	image: Pick<BackgroundImage, "url" | "opacity" | "fit">,
	pageColor: [number, number, number],
) => {
	const [r, g, b] = pageColor;
	const veil = `rgba(${r}, ${g}, ${b}, ${Math.round((1 - image.opacity) * 1000) / 1000})`;
	return {
		backgroundImage: `linear-gradient(${veil}, ${veil}), url("${image.url}")`,
		backgroundSize: `auto, ${size(image.fit)}`,
		backgroundRepeat: `no-repeat, ${repeat(image.fit)}`,
		backgroundPosition: "center, center",
		backgroundAttachment: "fixed, fixed",
	};
};

const UNDERLAY_PROPERTIES = [
	"backgroundImage",
	"backgroundSize",
	"backgroundRepeat",
	"backgroundPosition",
	"backgroundAttachment",
] as const;

/** Lays the picture under the page's own background (body), following the theme; undone when it goes. */
const useUnderlay = (image: BackgroundImage | null) => {
	useEffect(() => {
		if (image?.layer !== "under") {
			return;
		}
		const body = document.body;
		const saved = UNDERLAY_PROPERTIES.map((p) => body.style[p]);
		const apply = () => {
			for (const p of UNDERLAY_PROPERTIES) {
				body.style[p] = "";
			}
			// Coder's page colour for the current theme (nothing of ours set yet).
			const own = parseRGB(getComputedStyle(body).backgroundColor);
			const color: [number, number, number] =
				own && own[3] > 0
					? [own[0], own[1], own[2]]
					: document.documentElement.classList.contains("light")
						? [255, 255, 255]
						: [9, 9, 11];
			Object.assign(body.style, underlayLayers(image, color));
		};
		apply();
		// The theme changes the page's colour: the veil follows it.
		const observer = new MutationObserver(apply);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "data-theme"],
		});
		return () => {
			observer.disconnect();
			UNDERLAY_PROPERTIES.forEach((p, i) => {
				body.style[p] = saved[i];
			});
		};
	}, [image]);
};

/**
 * The background image of the sign-in page or of the dashboard (Admin settings
 * > Customize), faint and ignored by the mouse. "Under" lies beneath every
 * element of the page: it is part of the page's own background (the picture
 * under a veil of the page's colour), so it shows only where the page has no
 * background of its own, and nothing else about the page changes. "Over" is a
 * separate layer above it, a watermark.
 */
export const PlatformBackground: React.FC<{ slot: BackgroundSlot }> = ({
	slot,
}) => {
	const image = usePlatformSnapshot().backgrounds[slot];
	// A page in another page's frame: the page around it has the background.
	const shown = image && !isEmbeddedFrame() ? image : null;
	useUnderlay(shown);
	if (shown?.layer !== "over") {
		return null;
	}
	return createPortal(
		<div
			aria-hidden
			data-testid="platform-background"
			data-slot={slot}
			className="pointer-events-none fixed inset-0 select-none"
			style={{ ...backgroundStyle(shown), zIndex: 2147483000 }}
		/>,
		document.body,
	);
};
