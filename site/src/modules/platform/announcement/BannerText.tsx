import { useSyncExternalStore } from "react";
import type { Banner, BannerEffect } from "#/api/platform";
import {
	type Countdown,
	countdownText,
	type InlineNode,
	parseColors,
	parseInline,
	safeHref,
} from "./bannerTokens";

// One ticking clock for every countdown on the page.
let now = Date.now();
const tickListeners = new Set<() => void>();
let ticker: number | undefined;

const subscribeToClock = (listener: () => void) => {
	tickListeners.add(listener);
	if (ticker === undefined) {
		ticker = window.setInterval(() => {
			now = Date.now();
			for (const l of tickListeners) {
				l();
			}
		}, 1000);
	}
	return () => {
		tickListeners.delete(listener);
		if (tickListeners.size === 0 && ticker !== undefined) {
			window.clearInterval(ticker);
			ticker = undefined;
		}
	};
};

const CountdownText: React.FC<{ countdown: Countdown }> = ({ countdown }) => {
	const current = useSyncExternalStore(subscribeToClock, () => now);
	return (
		<span role="timer" className="font-bold tabular-nums whitespace-nowrap">
			{countdownText(countdown, current)}
		</span>
	);
};

type EffectPlan = {
	/** Animates each character, each word, or the whole message. */
	unit: "char" | "word" | "whole";
	animation: (index: number, count: number, repeat: boolean) => string;
};

// Delay between letters: `per` ms, but never more than `total` ms for the
// whole message (a long message must not take half a minute to type).
const stagger = (count: number, per: number, total: number) =>
	Math.max(4, Math.min(per, total / Math.max(1, count)));

const staggered =
	(
		keyframes: string,
		duration: number,
		easing: string,
		per: number,
		total: number,
	): EffectPlan["animation"] =>
	(index, count, repeat) =>
		`${keyframes} ${duration}ms ${easing} ${Math.round(index * stagger(count, per, total))}ms ${repeat ? "infinite" : "1"} both`;

const EFFECTS: Record<Exclude<BannerEffect, "none">, EffectPlan> = {
	typewriter: {
		unit: "char",
		animation: staggered("announce-appear", 1, "linear", 45, 3000),
	},
	fade: {
		unit: "word",
		animation: staggered("announce-appear", 700, "ease-in-out", 140, 2000),
	},
	rise: {
		unit: "char",
		animation: staggered("announce-rise", 700, "ease-out", 25, 1500),
	},
	wave: {
		unit: "char",
		animation: staggered("announce-wave", 1200, "ease-in-out", 50, 1500),
	},
	bounce: {
		unit: "char",
		animation: staggered("announce-bounce", 900, "linear", 30, 1500),
	},
	flip: {
		unit: "char",
		animation: staggered("announce-flip", 600, "ease-out", 30, 1500),
	},
	shake: {
		unit: "whole",
		animation: (_index, _count, repeat) =>
			`announce-shake 1970ms ease-in-out ${repeat ? "infinite" : "1"}`,
	},
	pulse: {
		unit: "whole",
		animation: (_index, _count, repeat) =>
			`announce-pulse 1500ms ease-in-out ${repeat ? "infinite" : "3"}`,
	},
	rainbow: {
		unit: "char",
		animation: staggered("announce-rainbow", 2600, "linear", 60, 1200),
	},
};

const prefersReducedMotion = () =>
	window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

type Splitter = {
	plan: EffectPlan;
	repeat: boolean;
	count: number;
	next: number;
};

const segmentsOf = (text: string, unit: "char" | "word"): string[] =>
	unit === "char" ? Array.from(text) : (text.match(/\s+|\S+/g) ?? []);

const countUnits = (nodes: InlineNode[], unit: "char" | "word"): number => {
	let count = 0;
	for (const node of nodes) {
		if (node.type === "text" || node.type === "code") {
			count += segmentsOf(node.text, unit).filter((s) => s.trim()).length;
		} else if (node.type !== "countdown") {
			count += countUnits(node.children, unit);
		}
	}
	return count;
};

const renderText = (
	text: string,
	splitter: Splitter | null,
	key: string,
): React.ReactNode => {
	if (!splitter || splitter.plan.unit === "whole") {
		return text;
	}
	return segmentsOf(text, splitter.plan.unit).map((segment, i) => {
		if (!segment.trim()) {
			return segment;
		}
		const index = splitter.next++;
		return (
			<span
				key={`${key}-${i}`}
				className="inline-block whitespace-pre"
				style={{
					animation: splitter.plan.animation(
						index,
						splitter.count,
						splitter.repeat,
					),
				}}
			>
				{segment}
			</span>
		);
	});
};

const renderNodes = (
	nodes: InlineNode[],
	splitter: Splitter | null,
	prefix: string,
): React.ReactNode[] =>
	nodes.map((node, i) => {
		const key = `${prefix}${i}`;
		switch (node.type) {
			case "text":
				return <span key={key}>{renderText(node.text, splitter, key)}</span>;
			case "code":
				return (
					<code key={key} className="font-mono bg-white/20 px-1 rounded">
						{renderText(node.text, splitter, key)}
					</code>
				);
			case "strong":
				return (
					<strong key={key}>
						{renderNodes(node.children, splitter, `${key}.`)}
					</strong>
				);
			case "em":
				return (
					<em key={key}>{renderNodes(node.children, splitter, `${key}.`)}</em>
				);
			case "s":
				return (
					<s key={key}>{renderNodes(node.children, splitter, `${key}.`)}</s>
				);
			case "link": {
				const external = /^https?:/i.test(node.href);
				return (
					<a
						key={key}
						href={node.href}
						className="text-inherit underline font-semibold"
						{...(external
							? { target: "_blank", rel: "noopener noreferrer" }
							: {})}
					>
						{renderNodes(node.children, splitter, `${key}.`)}
					</a>
				);
			}
			case "countdown":
				return <CountdownText key={key} countdown={node.countdown} />;
		}
	});

type BannerTextProps = {
	banner: Pick<
		Banner,
		"title" | "message" | "linkText" | "linkUrl" | "effect" | "repeat"
	>;
	/** Plays the banner's text effect (a remount plays it again). */
	animate?: boolean;
	className?: string;
};

/**
 * The announcement's text: an optional bold lead-in, the Markdown message
 * with live countdowns, and an optional link. A lead-in that carries custom
 * colours is not shown (the banner is drawn in those colours instead).
 */
export const BannerText: React.FC<BannerTextProps> = ({
	banner,
	animate = false,
	className,
}) => {
	const message = parseInline(banner.message);
	const effect = banner.effect !== "none" ? EFFECTS[banner.effect] : undefined;
	const plan = animate && effect && !prefersReducedMotion() ? effect : null;
	const splitter: Splitter | null =
		plan && plan.unit !== "whole"
			? {
					plan,
					repeat: banner.repeat,
					count: countUnits(message, plan.unit),
					next: 0,
				}
			: null;
	const title = banner.title && !parseColors(banner.title) ? banner.title : "";
	const href = safeHref(banner.linkUrl);

	return (
		<span
			data-banner-text=""
			className={className}
			style={
				plan?.unit === "whole"
					? {
							display: "inline-block",
							animation: plan.animation(0, 1, banner.repeat),
						}
					: undefined
			}
		>
			{title && <strong>{title} </strong>}
			{renderNodes(message, splitter, "m")}
			{href && (
				<>
					{" "}
					<a
						href={href}
						className="text-inherit underline font-semibold"
						{...(/^https?:/i.test(href)
							? { target: "_blank", rel: "noopener noreferrer" }
							: {})}
					>
						{banner.linkText || href}
					</a>
				</>
			)}
		</span>
	);
};
