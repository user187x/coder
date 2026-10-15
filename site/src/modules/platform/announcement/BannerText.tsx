import { cn } from "cn";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
	Banner,
	BannerEffect,
	BannerSpeed,
	PictureFit,
} from "#/api/platform";
import { useBannerClock } from "./bannerClock";
import { bannerFontStack } from "./bannerFonts";
import "./bannerCrawl.css";
import "./bannerFx.css";
import "./bannerRoll.css";
import {
	type Block,
	type Countdown,
	countdownText,
	type InlineNode,
	parseBlocks,
	parseColors,
	parseInline,
	pictureFit,
	safeHref,
} from "./bannerTokens";

const CountdownText: React.FC<{ countdown: Countdown }> = ({ countdown }) => {
	const current = useBannerClock();
	return (
		<span role="timer" className="font-bold tabular-nums whitespace-nowrap">
			{countdownText(countdown, current)}
		</span>
	);
};

type EffectPlan = {
	/** Animates each character, each word, or the whole message. */
	unit: "char" | "word" | "whole";
	/** An animation set inline on each unit (or on the whole message). */
	animation?: (index: number, count: number, repeat: boolean) => string;
	/**
	 * A stylesheet effect (bannerFx.css): the message's class. Each letter is a
	 * <b> indexed by --i, which delays it.
	 */
	className?: string;
	/**
	 * At most this many letters' delays: a longer message's letters are indexed
	 * closer together, so its last letter does not wait half a minute.
	 */
	maxIndex?: number;
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
	pewpew: { unit: "char", className: "fx-pewpew", maxIndex: 12 },
	flap: { unit: "char", className: "fx-flap", maxIndex: 14 },
	shimmer: { unit: "whole", className: "fx-shimmer" },
};

/** A letter's --i: its index, closer together past plan.maxIndex letters. */
const letterIndex = (plan: EffectPlan, index: number, count: number) => {
	const scale = plan.maxIndex ? Math.min(1, plan.maxIndex / count) : 1;
	return Math.round(index * scale * 1000) / 1000;
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
	if (!splitter) {
		return text;
	}
	const { plan } = splitter;
	if (plan.unit === "whole") {
		return text;
	}
	if (plan.className) {
		// A <b> per letter, each word's letters kept together: a line may
		// break between any two inline-block letters, so only the spaces may
		// break it.
		return segmentsOf(text, "word").map((word, w) =>
			word.trim() ? (
				<span key={`${key}-${w}`} className="whitespace-nowrap">
					{Array.from(word).map((letter, i) => (
						<b
							key={i}
							style={
								{
									"--i": letterIndex(plan, splitter.next++, splitter.count),
								} as React.CSSProperties
							}
						>
							{letter}
						</b>
					))}
				</span>
			) : (
				word
			),
		);
	}
	return segmentsOf(text, plan.unit).map((segment, i) => {
		if (!segment.trim()) {
			return segment;
		}
		const index = splitter.next++;
		const animation = plan.animation;
		return (
			<span
				key={`${key}-${i}`}
				className="inline-block whitespace-pre"
				style={
					splitter.typed !== undefined
						? { visibility: index < splitter.typed ? "visible" : "hidden" }
						: { animation: animation?.(index, splitter.count, splitter.repeat) }
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
	pictures?: ReadonlySet<string>,
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
						{renderNodes(node.children, splitter, `${key}.`, pictures)}
					</strong>
				);
			case "em":
				return (
					<em key={key}>
						{renderNodes(node.children, splitter, `${key}.`, pictures)}
					</em>
				);
			case "s":
				return (
					<s key={key}>
						{renderNodes(node.children, splitter, `${key}.`, pictures)}
					</s>
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
						{renderNodes(node.children, splitter, `${key}.`, pictures)}
					</a>
				);
			}
			case "countdown":
				return <CountdownText key={key} countdown={node.countdown} />;
			case "image":
				// A picture rolls through the banner's screen (PictureRoll), not in the line.
				if (pictures?.has(node.src)) {
					return null;
				}
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

/** Images at least this big (natural px, either side) are pictures; smaller ones (emoji: 64) stay in the line. */
const PICTURE_MIN_PX = 128;
/** A picture's roll through the banner's screen, in pixels per second. */
const ROLL_PX_PER_SECOND = 24;

const imagesOf = (nodes: InlineNode[]): { src: string; alt: string }[] =>
	nodes.flatMap((node) =>
		node.type === "image"
			? [{ src: node.src, alt: node.alt }]
			: "children" in node
				? imagesOf(node.children)
				: [],
	);

/** A picture on the banner's screen, behind the text, and how it fills the screen. */
type ScreenPicture = { src: string; alt: string; fit: PictureFit };

/**
 * A Markdown message's pictures: its images given a fit (Insert picture),
 * and those found, once loaded, to be at least PICTURE_MIN_PX (until then
 * they stay in the line).
 */
const usePictures = (
	images: { src: string; alt: string }[],
): ScreenPicture[] => {
	const [sizes, setSizes] = useState<Record<string, number>>({});
	const key = [...new Set(images.map((i) => i.src))].join("\n");
	useEffect(() => {
		let live = true;
		const srcs = key ? key.split("\n") : [];
		for (const src of srcs) {
			const img = new Image();
			img.onload = () => {
				if (live) {
					setSizes((s) => ({
						...s,
						[src]: Math.max(img.naturalWidth, img.naturalHeight),
					}));
				}
			};
			img.src = src;
		}
		return () => {
			live = false;
		};
	}, [key]);
	return images
		.filter(
			(image, i) =>
				(pictureFit(image.src) !== null ||
					(sizes[image.src] ?? 0) >= PICTURE_MIN_PX) &&
				images.findIndex((other) => other.src === image.src) === i,
		)
		.map((image) => ({ ...image, fit: pictureFit(image.src) ?? "span" }));
};

/** A URL for CSS url("…"): an address that passed safeHref, its quotes and backslashes dropped. */
const cssUrl = (src: string) => `url("${src.replace(/["\\\n\r]/g, "")}")`;

/**
 * The banner's screen behind the text, from its background picture (or a
 * Markdown message's pictures: the first one's fit decides). Span (the
 * default): as wide as the screen, rolling through it (PictureRoll), with
 * every other spanning picture after it. Center: the whole picture, fitted in
 * the middle. Tile: repeated across, as tall as the screen. Fill: covering the
 * screen, its middle showing. Stretch: squeezed to the screen's size. The
 * banner keeps its size whatever the fit (bannerRoll.css).
 */
const PictureScreen: React.FC<{ pictures: ScreenPicture[] }> = ({
	pictures,
}) => {
	const lead = pictures[0];
	const fit = lead.fit;
	if (fit === "span") {
		return <PictureRoll pictures={pictures.filter((p) => p.fit === "span")} />;
	}
	return (
		<span
			className="banner-picture"
			data-fit={fit}
			role="img"
			aria-label={lead.alt || "Picture"}
			data-testid="announcement-picture"
			style={{ backgroundImage: cssUrl(lead.src) }}
		/>
	);
};

/**
 * The banner's pictures, as on a rolling pin: as wide as the banner's screen,
 * rolling through it from top to bottom at a steady pace, one after another
 * and round again, behind the text. The screen shows the strip of them that
 * fits; the banner keeps its size whatever the pictures' (bannerRoll.css).
 */
const PictureRoll: React.FC<{ pictures: { src: string; alt: string }[] }> = ({
	pictures,
}) => {
	const strip = useRef<HTMLSpanElement>(null);
	const [seconds, setSeconds] = useState<number>();
	useLayoutEffect(() => {
		const measure = () => {
			// Two copies of the pictures, one after the other: the strip rolls by one.
			const height = (strip.current?.offsetHeight ?? 0) / 2;
			if (height > 0) {
				setSeconds(Math.max(4, height / ROLL_PX_PER_SECOND));
			}
		};
		measure();
		const observer = new ResizeObserver(measure);
		if (strip.current) {
			observer.observe(strip.current);
		}
		return () => observer.disconnect();
	}, []);
	return (
		<span
			className="banner-roll"
			role="img"
			aria-label={
				pictures
					.map((p) => p.alt)
					.filter(Boolean)
					.join(", ") || "Picture"
			}
			data-testid="announcement-picture-roll"
		>
			<span
				ref={strip}
				className="banner-roll-strip"
				style={{ animationDuration: `${seconds ?? 30}s` }}
			>
				{[0, 1].flatMap((copy) =>
					pictures.map((p) => (
						<img
							key={`${copy}-${p.src}`}
							src={p.src}
							alt=""
							draggable={false}
						/>
					)),
				)}
			</span>
		</span>
	);
};

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
		| "markdown"
		| "align"
		| "outline"
		| "picture"
		| "pictureFit"
	>;
	/** Plays the banner's text effect (a remount plays it again). */
	animate?: boolean;
	className?: string;
};

/**
 * The announcement's text, lined up as the admin chose, over its background
 * picture: plain text as written (the editor's), or, for announcements
 * written before it, an optional bold lead-in, the Markdown message with
 * live countdowns and pictures, and an optional link. A lead-in that carries
 * custom colours is not shown (the banner is drawn in those colours instead).
 */
export const BannerText: React.FC<BannerTextProps> = ({
	banner,
	animate = false,
	className,
}) => {
	const plain = banner.markdown === false;
	const message: InlineNode[] = plain
		? banner.message
			? [{ type: "text", text: banner.message }]
			: []
		: parseInline(banner.message);
	const inMessage = usePictures(plain ? [] : imagesOf(message));
	const pictures = new Set(inMessage.map((p) => p.src));
	const background = safeHref(banner.picture ?? "");
	const pictureList: ScreenPicture[] = background
		? [{ src: background, alt: "", fit: banner.pictureFit ?? "span" }]
		: inMessage;
	const roll = pictureList.length > 0 && (
		<PictureScreen pictures={pictureList} />
	);
	const crawl = banner.effect === "starwars";
	const [crawlDone, setCrawlDone] = useState(false);
	// A stylesheet effect on the whole message that played once: plain text.
	const [fxDone, setFxDone] = useState(false);
	const effect =
		banner.effect !== "none" && banner.effect !== "starwars"
			? EFFECTS[banner.effect]
			: undefined;
	const plan =
		animate && effect && !(fxDone && !banner.repeat) && !prefersReducedMotion()
			? effect
			: null;
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
	const textAlign = banner.align ?? "center";
	const content = (
		<>
			{title && <strong>{title} </strong>}
			{renderNodes(message, splitter, "m", pictures)}
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
			<>
				{roll}
				<span
					data-banner-text=""
					data-over-picture={roll ? "" : undefined}
					data-outline={banner.outline ? "" : undefined}
					className={cn(className, "banner-crawl-host")}
					style={{ fontFamily, textAlign }}
				>
					<Crawl
						speed={banner.speed ?? "normal"}
						repeat={banner.repeat}
						onDone={() => setCrawlDone(true)}
					>
						{content}
					</Crawl>
				</span>
			</>
		);
	}

	const wholeAnimation =
		plan?.unit === "whole" ? plan.animation?.(0, 1, banner.repeat) : undefined;
	return (
		<>
			{roll}
			<span
				data-banner-text=""
				data-over-picture={roll ? "" : undefined}
				data-outline={banner.outline ? "" : undefined}
				data-fx-once={plan?.className && !banner.repeat ? "" : undefined}
				className={cn(className, plan?.className)}
				style={
					wholeAnimation
						? {
								display: "inline-block",
								fontFamily,
								textAlign,
								animation: wholeAnimation,
							}
						: { fontFamily, textAlign }
				}
				onAnimationEnd={
					plan?.className && plan.unit === "whole"
						? (event) => {
								if (event.target === event.currentTarget) {
									setFxDone(true);
								}
							}
						: undefined
				}
			>
				{content}
			</span>
		</>
	);
};

/** Plain text as the scroll-down view's blocks: paragraphs between blank lines, their line breaks kept. */
const plainBlocks = (message: string): Block[] =>
	message
		.replace(/\r\n?/g, "\n")
		.split(/\n\s*\n/)
		.filter((paragraph) => paragraph.trim())
		.map((paragraph) => ({
			type: "paragraph",
			lines: paragraph
				.split("\n")
				.map((line): InlineNode[] => [{ type: "text", text: line }]),
		}));

/**
 * The whole message, for the banner's scroll-down view: plain text as
 * paragraphs, or a Markdown message as rich text (headings, lists and
 * paragraphs, line breaks kept, with inline Markdown, emoji, countdowns,
 * links and full-size images). No effect.
 */
export const BannerBlocks: React.FC<{
	message: string;
	markdown?: boolean;
}> = ({ message, markdown = true }) => {
	return (
		<>
			{(markdown ? parseBlocks(message) : plainBlocks(message)).map(
				(block, i) => {
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
				},
			)}
		</>
	);
};
