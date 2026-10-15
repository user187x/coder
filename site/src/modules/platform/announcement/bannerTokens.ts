/**
 * The announcement's message is stored by the coder-banner service as plain
 * text. These tokens are how the dashboard carries more than plain text in it:
 *
 *   Markdown    **bold**  *italic*  ~~strike~~  `code`  [text](https://… or /path)
 *               ![alt](https://… or /path) images; and, for longer broadcasts
 *               (parseBlocks), # headings, - lists, blank lines between paragraphs
 *   Countdown   {{countdown to=2026-10-04T02:00:00Z format=dhms done="now"}}
 *   Colours     {{colors bg=#rrggbb fg=#rrggbb}} in the (otherwise unused)
 *               lead-in field: custom background and text colours
 *
 * The service stores and delivers the text unchanged, so its live push, ids
 * and dismissals keep working; the dashboard only draws it differently.
 */
import {
	type BannerLevel,
	PICTURE_FITS,
	type PictureFit,
} from "#/api/platform";

export const LEVEL_COLORS: Record<BannerLevel, { bg: string; fg: string }> = {
	info: { bg: "#1e40af", fg: "#ffffff" },
	success: { bg: "#166534", fg: "#ffffff" },
	warning: { bg: "#b45309", fg: "#ffffff" },
	critical: { bg: "#b91c1c", fg: "#ffffff" },
};

/**
 * The Confirm button's background: the banner's colour, a little grayer
 * (about half its saturation) and a touch lighter, so the button reads as part
 * of the banner yet stands out from it. `bg` is #rrggbb.
 */
export const confirmBackground = (bg: string): string => {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg);
	if (!m) {
		return "rgb(255 255 255 / 0.15)";
	}
	const [r, g, b] = [m[1], m[2], m[3]].map((x) => Number.parseInt(x, 16) / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	let h = 0;
	if (d !== 0) {
		h =
			max === r
				? ((g - b) / d) % 6
				: max === g
					? (b - r) / d + 2
					: (r - g) / d + 4;
	}
	const hue = Math.round((h * 60 + 360) % 360);
	const sat = Math.round(s * 0.5 * 100);
	const light = Math.round(Math.min(0.92, l + 0.06) * 100);
	return `hsl(${hue} ${sat}% ${light}%)`;
};

/** Relative luminance (WCAG) of #rrggbb, or null for anything else. */
const luminance = (hex: string): number | null => {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!m) {
		return null;
	}
	const [r, g, b] = [m[1], m[2], m[3]].map((x) => {
		const c = Number.parseInt(x, 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * The colour the message is lit in on the banner's screen, which is dark: the
 * banner's text colour, unless that is dark too (custom colours such as black
 * on yellow); then the banner's own colour if it is light, else white.
 */
export const lcdInk = (bg: string, fg: string): string => {
	const light = (hex: string) => (luminance(hex) ?? 1) >= 0.18;
	if (light(fg)) {
		return fg;
	}
	return light(bg) ? bg : "#ffffff";
};

const COLORS_RE = /^\{\{colors bg=(#[0-9a-fA-F]{6}) fg=(#[0-9a-fA-F]{6})\}\}$/;
const COUNTDOWN_RE =
	/\{\{countdown\s+to=([0-9T:.\-+Z]+)(?:\s+format=(dhms|clock|words))?(?:\s+done="([^"]{0,80})")?\s*\}\}/;

export const COUNTDOWN_FORMATS = ["dhms", "clock", "words"] as const;
type CountdownFormat = (typeof COUNTDOWN_FORMATS)[number];

const isCountdownFormat = (
	value: string | undefined,
): value is CountdownFormat =>
	COUNTDOWN_FORMATS.some((format) => format === value);

type CustomColors = { bg: string; fg: string };

export const parseColors = (title: string | undefined): CustomColors | null => {
	const match = COLORS_RE.exec((title ?? "").trim());
	return match ? { bg: match[1], fg: match[2] } : null;
};

export const colorsToken = ({ bg, fg }: CustomColors): string =>
	`{{colors bg=${bg} fg=${fg}}}`;

export type Countdown = {
	to: string;
	format: CountdownFormat;
	done: string;
};

export const countdownToken = ({ to, format, done }: Countdown): string => {
	const safeDone = done.replace(/["{}]/g, "").slice(0, 80);
	return `{{countdown to=${to} format=${format} done="${safeDone}"}}`;
};

export const parseCountdown = (
	text: string,
): (Countdown & { index: number; length: number }) | null => {
	const match = COUNTDOWN_RE.exec(text);
	if (!match) {
		return null;
	}
	return {
		to: match[1],
		format: isCountdownFormat(match[2]) ? match[2] : "dhms",
		done: match[3] ?? "now",
		index: match.index,
		length: match[0].length,
	};
};

const pad = (n: number) => String(n).padStart(2, "0");

const formatRemaining = (ms: number, format: CountdownFormat): string => {
	let s = Math.max(0, Math.floor(ms / 1000));
	const d = Math.floor(s / 86400);
	s -= d * 86400;
	const h = Math.floor(s / 3600);
	s -= h * 3600;
	const m = Math.floor(s / 60);
	s -= m * 60;
	if (format === "clock") {
		return `${pad(d * 24 + h)}:${pad(m)}:${pad(s)}`;
	}
	if (format === "words") {
		const parts = (
			[
				[d, "day"],
				[h, "hour"],
				[m, "minute"],
				[s, "second"],
			] as const
		)
			.filter(([n]) => n > 0)
			.slice(0, 2);
		return parts.length
			? parts.map(([n, unit]) => `${n} ${unit}${n === 1 ? "" : "s"}`).join(", ")
			: "0 seconds";
	}
	return `${d ? `${d}d ` : ""}${pad(h)}h ${pad(m)}m ${pad(s)}s`;
};

export const countdownText = (countdown: Countdown, now: number): string => {
	const left = Date.parse(countdown.to) - now;
	if (Number.isNaN(left)) {
		return "(invalid date)";
	}
	return left > 0 ? formatRemaining(left, countdown.format) : countdown.done;
};

/** Only http(s) URLs and same-site paths are linked. */
export const safeHref = (url: string): string =>
	/^(https?:\/\/|\/(?!\/))/i.test(url) ? url : "";

export type InlineNode =
	| { type: "text"; text: string }
	| { type: "code"; text: string }
	| { type: "strong" | "em" | "s"; children: InlineNode[] }
	| { type: "link"; href: string; children: InlineNode[] }
	| { type: "image"; src: string; alt: string }
	| { type: "countdown"; countdown: Countdown };

type Rule = {
	re: RegExp;
	toNode: (match: RegExpExecArray) => InlineNode;
	emphasis?: boolean;
};

const RULES: Rule[] = [
	{
		re: /^!\[([^\]]*)\]\(([^)\s]+)\)/,
		toNode: (match) => {
			const src = safeHref(match[2]);
			return src
				? { type: "image", src, alt: match[1] }
				: { type: "text", text: match[0] };
		},
	},
	{
		re: /^\{\{countdown\s[^}]*\}\}/,
		toNode: (match) => {
			const countdown = parseCountdown(match[0]);
			return countdown
				? { type: "countdown", countdown }
				: { type: "text", text: match[0] };
		},
	},
	{ re: /^`([^`]+)`/, toNode: (match) => ({ type: "code", text: match[1] }) },
	{
		re: /^\*\*(.+?)\*\*/,
		toNode: (match) => ({ type: "strong", children: parseInline(match[1]) }),
	},
	{
		re: /^__(.+?)__/,
		toNode: (match) => ({ type: "strong", children: parseInline(match[1]) }),
	},
	{
		re: /^~~(.+?)~~/,
		toNode: (match) => ({ type: "s", children: parseInline(match[1]) }),
	},
	{
		re: /^\*([^*\s](?:[^*]*[^*\s])?)\*/,
		toNode: (match) => ({ type: "em", children: parseInline(match[1]) }),
		emphasis: true,
	},
	{
		re: /^_([^_\s](?:[^_]*[^_\s])?)_(?![A-Za-z0-9])/,
		toNode: (match) => ({ type: "em", children: parseInline(match[1]) }),
		emphasis: true,
	},
	{
		re: /^\[([^\]]+)\]\(([^)\s]+)\)/,
		toNode: (match) => {
			const href = safeHref(match[2]);
			return href
				? { type: "link", href, children: parseInline(match[1]) }
				: { type: "text", text: match[0] };
		},
	},
];

/** The rule that starts `text` at position `i`, if any. */
const matchRule = (
	text: string,
	i: number,
): { node: InlineNode; length: number } | null => {
	const rest = text.slice(i);
	for (const rule of RULES) {
		const match = rule.re.exec(rest);
		// A word character right before * or _ makes it part of a word
		// (snake_case, 2*3), not emphasis.
		if (match && !(rule.emphasis && /[A-Za-z0-9]/.test(text[i - 1] ?? ""))) {
			return { node: rule.toNode(match), length: match[0].length };
		}
	}
	return null;
};

/** The inline Markdown subset of announcements, as a tree. Never HTML. */
export const parseInline = (text: string): InlineNode[] => {
	const out: InlineNode[] = [];
	let plain = "";
	let i = 0;
	const flush = () => {
		if (plain) {
			out.push({ type: "text", text: plain });
			plain = "";
		}
	};
	while (i < text.length) {
		const matched = matchRule(text, i);
		if (matched) {
			flush();
			out.push(matched.node);
			i += matched.length;
		} else if (text[i] === "\\" && /[\\`*_~[\]{}()]/.test(text[i + 1] ?? "")) {
			plain += text[i + 1];
			i += 2;
		} else {
			plain += text[i];
			i += 1;
		}
	}
	flush();
	return out;
};

export type Block =
	| { type: "heading"; level: 1 | 2 | 3; children: InlineNode[] }
	| { type: "list"; ordered: boolean; items: InlineNode[][] }
	| { type: "paragraph"; lines: InlineNode[][] };

/**
 * A longer broadcast as blocks: "# " to "### " headings, "- " / "* " / "1. "
 * list items, and paragraphs (separated by blank lines; their line breaks
 * kept). Inline Markdown inside each.
 */
export const parseBlocks = (message: string): Block[] => {
	const blocks: Block[] = [];
	let paragraph: InlineNode[][] | null = null;
	let list: { ordered: boolean; items: InlineNode[][] } | null = null;
	const end = () => {
		if (paragraph) {
			blocks.push({ type: "paragraph", lines: paragraph });
		}
		if (list) {
			blocks.push({ type: "list", ...list });
		}
		paragraph = null;
		list = null;
	};
	for (const raw of message.replace(/\r\n?/g, "\n").split("\n")) {
		const line = raw.trimEnd();
		const heading = /^(#{1,3})\s+(.*)$/.exec(line);
		const item = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/.exec(line);
		if (!line.trim()) {
			end();
		} else if (heading) {
			end();
			blocks.push({
				type: "heading",
				level: heading[1].length as 1 | 2 | 3,
				children: parseInline(heading[2]),
			});
		} else if (item) {
			const ordered = Boolean(item[2]);
			if (paragraph || (list && list.ordered !== ordered)) {
				end();
			}
			list ??= { ordered, items: [] };
			list.items.push(parseInline(item[3]));
		} else {
			if (list) {
				end();
			}
			paragraph ??= [];
			paragraph.push(parseInline(line));
		}
	}
	end();
	return blocks;
};

/** The announcement has something to show: a message, a background picture or a countdown (it may be only a picture). */
export const hasContent = (banner: {
	message: string;
	picture?: string;
	countdown?: string;
}): boolean =>
	Boolean(banner.message.trim() || banner.picture || banner.countdown);

/** A picture's fit, from its address (`…#fit=tile`); none given: null. */
export const pictureFit = (src: string): PictureFit | null => {
	const fit = /#(?:.*&)?fit=([a-z]+)/.exec(src)?.[1];
	return PICTURE_FITS.find((f) => f === fit) ?? null;
};

/** A moment as the banner service takes it: UTC, to the second ("2026-10-20T18:00:00Z"); invalid: "". */
export const utcSeconds = (moment: string | Date): string => {
	const date = moment instanceof Date ? moment : new Date(moment);
	return Number.isNaN(date.getTime())
		? ""
		: date.toISOString().replace(/\.\d{3}Z$/, "Z");
};

/** A Markdown message as the plain editor keeps it: its text, its first countdown and its first picture. */
type PlainMessage = {
	message: string;
	/** The first {{countdown}}'s moment (utcSeconds); "" none. */
	countdown: string;
	/** The first picture's address, without its #fit; "" none. */
	picture: string;
	pictureFit: PictureFit;
};

/**
 * An announcement written in Markdown, as plain text: the first countdown
 * and the first picture taken out of it (the editor shows them as the
 * banner's countdown and background), the others dropped, emphasis and
 * code marks removed, links as "text (address)", headings without their #.
 */
export const fromMarkdown = (markdown: string): PlainMessage => {
	let countdown = "";
	let picture = "";
	let fit: PictureFit = "span";
	// Escaped characters (\*) are kept out of the way, then put back as themselves.
	const escaped: string[] = [];
	const message = markdown
		.replace(/\r\n?/g, "\n")
		.replace(
			/\\([\\`*_~[\]{}()])/g,
			(_escape, char: string) => `\uE000${escaped.push(char) - 1}\uE000`,
		)
		.replace(/\{\{countdown\s[^}]*\}\}/g, (token) => {
			const parsed = parseCountdown(token);
			if (parsed && !countdown) {
				countdown = utcSeconds(parsed.to);
			}
			return "";
		})
		.replace(/!\[[^\]]*\]\(([^)\s]+)\)/g, (_token, src: string) => {
			if (!picture && safeHref(src)) {
				picture = src.replace(/#.*$/, "");
				fit = pictureFit(src) ?? "span";
			}
			return "";
		})
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/__(.+?)__/g, "$1")
		.replace(/~~(.+?)~~/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/(^|[^A-Za-z0-9])\*([^*\s](?:[^*]*[^*\s])?)\*/g, "$1$2")
		.replace(
			/(^|[^A-Za-z0-9])_([^_\s](?:[^_]*[^_\s])?)_(?![A-Za-z0-9])/g,
			"$1$2",
		)
		.replace(/^#{1,3}\s+/gm, "")
		.replace(/\uE000(\d+)\uE000/g, (_mark, i: string) => escaped[Number(i)])
		.split("\n")
		.map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
		.join("\n")
		.trim();
	return { message, countdown, picture, pictureFit: fit };
};

/** The message as one line of plain text: tokens shown as what they are. */
export const plainLabel = (title: string, message: string): string => {
	const text = (message || "(no message)")
		.replace(/\{\{countdown[^}]*\}\}/g, "⏱")
		.replace(/!\[([^\]]*)\]\([^)\s]+\)/g, "🖼 $1")
		.replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
		.replace(/[*_~`]/g, "");
	return title && !parseColors(title) ? `${title} ${text}` : text;
};
