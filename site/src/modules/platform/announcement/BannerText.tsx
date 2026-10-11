import { cn } from "cn";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { Banner, BannerEffect, BannerSpeed } from "#/api/platform";
import { bannerFontStack } from "./bannerFonts";
import "./bannerCrawl.css";
import {
	type Countdown,
	countdownText,
	type InlineNode,
	parseBlocks,
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

const EFFECTS: Record<
	Exclude<BannerEffect, "none" | "starwars">,
	EffectPlan
> = {
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
	/**
	 * Typewriter with repeat: how many letters are typed so far (drawn by a
	 * timer, not a CSS animation; the others take their space but are hidden).
	 */
	typed?: number;
};

// Typewriter with repeat: type the message, hold it, clear it, type it again.
// A CSS animation cannot do it: each letter's 1 ms appearing step, repeated
// forever, made every letter blink.
const TYPE_HOLD_MS = 3000;
const TYPE_BLANK_MS = 500;

const useTypedCount = (count: number, active: boolean): number => {
	const per = stagger(count, 45, 3000);
	const [typed, setTyped] = useState(0);
	useEffect(() => {
		if (!active) {
			return;
		}
		const start = performance.now();
		const typing = count * per;
		const cycle = typing + TYPE_HOLD_MS + TYPE_BLANK_MS;
		const tick = () => {
			const t = (performance.now() - start) % cycle;
			setTyped(
				t < typing
					? Math.min(count, Math.floor(t / per) + 1)
					: t < typing + TYPE_HOLD_MS
						? count
						: 0,
			);
		};
		tick();
		const timer = window.setInterval(tick, Math.max(16, per / 2));
		return () => window.clearInterval(timer);
	}, [count, per, active]);
	return typed;
};

const segmentsOf = (text: string, unit: "char" | "word"): string[] =>
	unit === "char" ? Array.from(text) : (text.match(/\s+|\S+/g) ?? []);

const countUnits = (nodes: InlineNode[], unit: "char" | "word"): number => {
	let count = 0;
	for (const node of nodes) {
		if (node.type === "text" || node.type === "code") {
			count += segmentsOf(node.text, unit).filter((s) => s.trim()).length;
		} else if (node.type !== "countdown" && node.type !== "image") {
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
				style={
					splitter.typed !== undefined
						? { visibility: index < splitter.typed ? "visible" : "hidden" }
						: {
								animation: splitter.plan.animation(
									index,
									splitter.count,
									splitter.repeat,
								),
							}
				}
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
			case "image":
				return (
					<img
						key={key}
						src={node.src}
						alt={node.alt}
						className="inline-block h-[1.25em] w-auto max-w-[6em] rounded-[3px] align-text-bottom object-contain"
					/>
				);
		}
	});

// The crawl's pace, in pixels per second.
const CRAWL_PX_PER_SECOND: Record<BannerSpeed, number> = {
	slow: 9,
	normal: 15,
	fast: 26,
};

type CrawlProps = {
	speed: BannerSpeed;
	repeat: boolean;
	onDone: () => void;
	children: React.ReactNode;
};

/**
 * The "starwars" effect: the opening crawl. The text rises from below the
 * banner, tilted away, and recedes into the distance, fading at the top, at
 * a steady pace (CRAWL_PX_PER_SECOND), so a long broadcast takes as long as
 * it needs to be read. Without repeat it plays once, then the message stays.
 */
const Crawl: React.FC<CrawlProps> = ({ speed, repeat, onDone, children }) => {
	const view = useRef<HTMLSpanElement>(null);
	const text = useRef<HTMLSpanElement>(null);
	const [seconds, setSeconds] = useState<number>();
	useLayoutEffect(() => {
		const measure = () => {
			const travel =
				(text.current?.offsetHeight ?? 0) + (view.current?.offsetHeight ?? 0);
			if (travel > 0) {
				setSeconds(Math.max(4, travel / CRAWL_PX_PER_SECOND[speed]));
			}
		};
		measure();
		const observer = new ResizeObserver(measure);
		if (text.current) {
			observer.observe(text.current);
		}
		return () => observer.disconnect();
	}, [speed]);
	return (
		<span ref={view} className="banner-crawl" data-banner-crawl="">
			<span
				ref={text}
				className="banner-crawl-text"
				style={{
					animationDuration: `${seconds ?? 30}s`,
					animationIterationCount: repeat ? "infinite" : 1,
					visibility: seconds === undefined ? "hidden" : undefined,
				}}
				onAnimationEnd={onDone}
			>
				{children}
			</span>
		</span>
	);
};

type BannerTextProps = {
	banner: Pick<
		Banner,
		| "title"
		| "message"
		| "linkText"
		| "linkUrl"
		| "effect"
		| "repeat"
		| "speed"
		| "font"
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
	const crawl = banner.effect === "starwars";
	const [crawlDone, setCrawlDone] = useState(false);
	const effect =
		banner.effect !== "none" && banner.effect !== "starwars"
			? EFFECTS[banner.effect]
			: undefined;
	const plan = animate && effect && !prefersReducedMotion() ? effect : null;
	const count =
		plan && plan.unit !== "whole" ? countUnits(message, plan.unit) : 0;
	const timedTypewriter = banner.effect === "typewriter" && banner.repeat;
	const typed = useTypedCount(count, Boolean(plan) && timedTypewriter);
	const splitter: Splitter | null =
		plan && plan.unit !== "whole"
			? {
					plan,
					repeat: banner.repeat,
					count,
					next: 0,
					...(timedTypewriter ? { typed } : {}),
				}
			: null;
	const title = banner.title && !parseColors(banner.title) ? banner.title : "";
	const href = safeHref(banner.linkUrl);

	const fontFamily = bannerFontStack(banner.font);
	const content = (
		<>
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
		</>
	);
	if (crawl && animate && !crawlDone && !prefersReducedMotion()) {
		return (
			<span
				data-banner-text=""
				className={cn(className, "banner-crawl-host")}
				style={{ fontFamily }}
			>
				<Crawl
					speed={banner.speed ?? "normal"}
					repeat={banner.repeat}
					onDone={() => setCrawlDone(true)}
				>
					{content}
				</Crawl>
			</span>
		);
	}

	return (
		<span
			data-banner-text=""
			className={className}
			style={
				plan?.unit === "whole"
					? {
							display: "inline-block",
							fontFamily,
							animation: plan.animation(0, 1, banner.repeat),
						}
					: { fontFamily }
			}
		>
			{content}
		</span>
	);
};

/**
 * The whole message as rich text, for the banner's scroll-down view: headings,
 * lists and paragraphs (line breaks kept), with inline Markdown, emoji,
 * countdowns, links and full-size images. No effect.
 */
export const BannerBlocks: React.FC<{ message: string }> = ({ message }) => {
	return (
		<>
			{parseBlocks(message).map((block, i) => {
				const key = `b${i}`;
				switch (block.type) {
					case "heading": {
						const Tag = (["h2", "h3", "h4"] as const)[block.level - 1];
						return (
							<Tag key={key} data-level={block.level}>
								{renderNodes(block.children, null, `${key}.`)}
							</Tag>
						);
					}
					case "list": {
						const List = block.ordered ? "ol" : "ul";
						return (
							<List key={key}>
								{block.items.map((item, j) => (
									<li key={`${key}.${j}`}>
										{renderNodes(item, null, `${key}.${j}.`)}
									</li>
								))}
							</List>
						);
					}
					case "paragraph":
						return (
							<p key={key}>
								{block.lines.map((line, j) => (
									<span key={`${key}.${j}`}>
										{j > 0 && <br />}
										{renderNodes(line, null, `${key}.${j}.`)}
									</span>
								))}
							</p>
						);
				}
			})}
		</>
	);
};
