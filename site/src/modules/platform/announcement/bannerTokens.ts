/**
 * The announcement's message is stored by the coder-banner service as plain
 * text. These tokens are how the dashboard carries more than plain text in it:
 *
 *   Markdown    **bold**  *italic*  ~~strike~~  `code`  [text](https://… or /path)
 *   Countdown   {{countdown to=2026-10-04T02:00:00Z format=dhms done="now"}}
 *   Colours     {{colors bg=#rrggbb fg=#rrggbb}} in the (otherwise unused)
 *               lead-in field: custom background and text colours
 *
 * The service stores and delivers the text unchanged, so its live push, ids
 * and dismissals keep working; the dashboard only draws it differently.
 */
import type { BannerLevel } from "#/api/platform";

export const LEVEL_COLORS: Record<BannerLevel, { bg: string; fg: string }> = {
	info: { bg: "#1e40af", fg: "#ffffff" },
	success: { bg: "#166534", fg: "#ffffff" },
	warning: { bg: "#b45309", fg: "#ffffff" },
	critical: { bg: "#b91c1c", fg: "#ffffff" },
};

const COLORS_RE = /^\{\{colors bg=(#[0-9a-fA-F]{6}) fg=(#[0-9a-fA-F]{6})\}\}$/;
const COUNTDOWN_RE =
	/\{\{countdown\s+to=([0-9T:.\-+Z]+)(?:\s+format=(dhms|clock|words))?(?:\s+done="([^"]{0,80})")?\s*\}\}/;

export const COUNTDOWN_FORMATS = ["dhms", "clock", "words"] as const;
export type CountdownFormat = (typeof COUNTDOWN_FORMATS)[number];

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
	| { type: "countdown"; countdown: Countdown };

type Rule = {
	re: RegExp;
	toNode: (match: RegExpExecArray) => InlineNode;
	emphasis?: boolean;
};

const RULES: Rule[] = [
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

/** The message as one line of plain text: tokens shown as what they are. */
export const plainLabel = (title: string, message: string): string => {
	const text = (message || "(no message)")
		.replace(/\{\{countdown[^}]*\}\}/g, "⏱")
		.replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
		.replace(/[*_~`]/g, "");
	return title && !parseColors(title) ? `${title} ${text}` : text;
};
