import type { BackgroundDials } from "#/api/platform";

/** The dials' bounds and starting points (the platform service clamps to the same). */
export const DIALS = {
	speed: {
		min: 0.1,
		max: 4,
		step: 0.05,
		default: 1,
		label: "Speed",
		unit: "×",
	},
	hue: {
		min: -180,
		max: 180,
		step: 1,
		default: 0,
		label: "Hue shift",
		unit: "°",
	},
	saturation: {
		min: 0,
		max: 3,
		step: 0.05,
		default: 1,
		label: "Saturation",
		unit: "×",
	},
	brightness: {
		min: 0.3,
		max: 2,
		step: 0.05,
		default: 1,
		label: "Brightness",
		unit: "×",
	},
	blur: { min: 0, max: 20, step: 0.5, default: 0, label: "Blur", unit: "px" },
} as const satisfies Record<
	keyof BackgroundDials,
	{
		min: number;
		max: number;
		step: number;
		default: number;
		label: string;
		unit: string;
	}
>;

export const dial = (
	dials: BackgroundDials | undefined,
	key: keyof BackgroundDials,
) => dials?.[key] ?? DIALS[key].default;

/** The CSS filters of the hue, saturation, brightness and blur dials ("none" at their defaults). */
export const dialFilter = (dials: BackgroundDials | undefined): string => {
	const parts = [
		dial(dials, "hue") ? `hue-rotate(${dial(dials, "hue")}deg)` : "",
		dial(dials, "saturation") !== 1
			? `saturate(${dial(dials, "saturation")})`
			: "",
		dial(dials, "brightness") !== 1
			? `brightness(${dial(dials, "brightness")})`
			: "",
		dial(dials, "blur") ? `blur(${dial(dials, "blur")}px)` : "",
	].filter(Boolean);
	return parts.length ? parts.join(" ") : "none";
};

/** The frame's #fragment: the speed its animations play at, or paused (the Animations switch off). */
export const frameHash = (
	dials: BackgroundDials | undefined,
	paused: boolean,
) => `#speed=${dial(dials, "speed")}${paused ? "&paused=1" : ""}`;

/**
 * Plays every CSS / Web animation of the page at the speed in its #speed=
 * (paused with #paused=1). The platform service adds the same script to the
 * HTML backgrounds it serves (BG_HTML_CONTROLLER in ui-service.py).
 */
export const CONTROLLER =
	"<script>(()=>{const q=()=>new URLSearchParams(location.hash.slice(1));let r=1;const a=()=>{const h=q();" +
	"r=h.get('paused')==='1'?0:Math.min(4,Math.max(0.1,Number(h.get('speed'))||1));for(const x of " +
	"document.getAnimations())if(x.playbackRate!==r)x.playbackRate=r};addEventListener('hashchange',a);" +
	"addEventListener('load',a);setInterval(a,500);a()})();</script>";

/** The rules the service serves HTML backgrounds with: no network, inline styles and scripts only. */
const PREVIEW_CSP =
	"default-src 'none'; style-src 'unsafe-inline' data:; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/**
 * An unsaved HTML background for a preview frame (srcdoc, sandboxed): the same
 * rules and speed control as when the service serves it.
 */
export const previewDocument = (html: string): string => {
	const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
	const head = /<head[^>]*>/i.exec(html);
	const withMeta = head
		? html.replace(head[0], `${head[0]}${meta}`)
		: `${meta}${html}`;
	const end = withMeta.toLowerCase().lastIndexOf("</body>");
	return end >= 0
		? withMeta.slice(0, end) + CONTROLLER + withMeta.slice(end)
		: withMeta + CONTROLLER;
};
