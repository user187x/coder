import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { BackgroundImage, BackgroundSlot } from "#/api/platform";
import { isEmbeddedFrame, usePlatformSnapshot } from "#/contexts/platformBoot";
import { useBackgroundAnimated } from "../animations/animations";
import { dial, dialFilter, frameHash } from "./backgroundHtml";

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
		if (image?.layer !== "under" || image.kind === "html") {
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
 * Room beneath the page for an HTML background's frame: the page's colour moves
 * from body to html (it looks the same), so a layer at z-index -1 shows where
 * the page has no background of its own. Undone when it goes.
 */
const useRoomBeneath = (active: boolean) => {
	useEffect(() => {
		if (!active) {
			return;
		}
		const html = document.documentElement;
		const body = document.body;
		const saved = [html.style.backgroundColor, body.style.backgroundColor];
		const apply = () => {
			// The page's colour for the current theme, as the page itself sets it.
			html.style.backgroundColor = saved[0];
			body.style.backgroundColor = saved[1];
			html.style.backgroundColor = getComputedStyle(body).backgroundColor;
			body.style.backgroundColor = "transparent";
		};
		apply();
		const observer = new MutationObserver((records) => {
			// Our own change to html's style is not a theme change.
			if (records.some((r) => r.attributeName !== "style")) {
				apply();
			}
		});
		observer.observe(html, {
			attributes: true,
			attributeFilter: ["class", "data-theme"],
		});
		return () => {
			observer.disconnect();
			html.style.backgroundColor = saved[0];
			body.style.backgroundColor = saved[1];
		};
	}, [active]);
};

/**
 * The background image of the sign-in page or of the dashboard (Admin settings
 * > Customize), faint and ignored by the mouse. "Under" lies beneath every
 * element of the page: it is part of the page's own background (the picture
 * under a veil of the page's colour), so it shows only where the page has no
 * background of its own, and nothing else about the page changes. "Over" is a
 * separate layer above it, a watermark.
 *
 * An HTML background (the Particles preset, or HTML / CSS an admin pasted) is
 * a frame of its own page, sandboxed: it can't reach Coder's page, its cookies
 * or the network. Its dials set its animations' speed (paused while
 * Animations > Moving background is off) and its colour filters.
 */
export const PlatformBackground: React.FC<{ slot: BackgroundSlot }> = ({
	slot,
}) => {
	const image = usePlatformSnapshot().backgrounds[slot];
	// A page in another page's frame: the page around it has the background.
	const shown = image && !isEmbeddedFrame() ? image : null;
	const animations = useBackgroundAnimated();
	useUnderlay(shown);
	useRoomBeneath(shown?.kind === "html" && shown.layer === "under");
	if (shown?.kind === "html") {
		return createPortal(
			<iframe
				aria-hidden
				tabIndex={-1}
				title="Background"
				data-testid="platform-background"
				data-slot={slot}
				sandbox="allow-scripts"
				src={`${shown.url}${frameHash(shown.params, !animations)}`}
				className="pointer-events-none fixed inset-0 h-full w-full select-none border-0"
				style={{
					opacity: shown.opacity,
					filter: dialFilter(shown.params),
					zIndex: shown.layer === "over" ? 2147483000 : -1,
					// A blurred edge would show the page behind it.
					transform: dial(shown.params, "blur") ? "scale(1.05)" : undefined,
				}}
			/>,
			document.body,
		);
	}
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
