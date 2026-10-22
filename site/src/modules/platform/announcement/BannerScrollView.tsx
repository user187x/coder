import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import type { Banner } from "#/api/platform";
import { BannerBlocks, PictureScreen } from "./BannerText";
import { BrokenScreenOverlay } from "./BrokenScreenOverlay";
import { bannerFontStack } from "./bannerFonts";
import { safeHref } from "./bannerTokens";
import { DotMatrixTime } from "./DotMatrixTime";
import { enterFullscreen, leaveFullscreen } from "./fullscreen";
import { MatrixOverlay } from "./MatrixOverlay";
import { SkynetOverlay } from "./SkynetOverlay";
import { startSparks } from "./sparksCursor";
import { type Answer, isRm, TerminalAnswer } from "./TerminalAnswers";
import "./bannerScrollView.css";

const CLOSE_MS = 220;
/** The longest line the prompt takes, and how many earlier commands it keeps. */
const MAX_TYPED = 64;
const MAX_HISTORY = 20;
/** Typed at the prompt: the easter egg (SkynetOverlay). */
const SKYNET = "skynet";
/** Run at the prompt (Enter): the screen breaks (BrokenScreenOverlay) - "rm -rf *", and its kin (/, ~, ., sudo). */
export const RM_RF =
	/^(sudo\s+)?rm\s+-(rf|fr|Rf|fR)\s+(\*|\/\*?|~\/?\*?|\.\/?\*?)$/;
/** Run at the prompt: the mouse pointer becomes sparks (sparksCursor) until a key is pressed. */
export const MOUSE = "/dev/mouse";
/** Run at the prompt: the time now, on a dot-matrix display (DotMatrixTime). */
export const TIME = "time";
/** Run at the prompt: the Matrix's rain over the screen (MatrixOverlay) until a key or the mouse. */
export const MATRIX = "matrix";

/** What a command run at the prompt is answered with (TerminalAnswers); "clear" and the effects print nothing. */
export const answerFor = (command: string): Answer => {
	const word = command.split(" ")[0];
	if (
		!command ||
		command === MOUSE ||
		command === MATRIX ||
		command === "clear" ||
		RM_RF.test(command)
	) {
		return "none";
	}
	if (isRm(command)) {
		return "nono";
	}
	if (command === TIME) {
		return "time";
	}
	if (word === "date" || word === "data") {
		return "date";
	}
	if (command === "whoami") {
		return "whoami";
	}
	if (word === "ls") {
		return "ls";
	}
	return "notfound";
};
type Rect = { top: number; left: number; width: number };

type BannerScrollViewProps = {
	banner: Pick<
		Banner,
		"id" | "message" | "font" | "markdown" | "picture" | "pictureFit"
	>;
	/** The banner's colours: the terminal's screen in them too (else its own dark screen). */
	colors?: { bg: string; fg: string };
	/** The banner card: the view opens just under it, at least as wide. */
	anchor: React.RefObject<HTMLElement | null>;
};

/**
 * The announcement's scroll mode, for people who do not want to wait for its
 * effect: the down arrow glued to the banner's left rolls a terminal-like view
 * of the whole message down over the page (above everything else), about a
 * quarter of the page tall and scrollable when the message is longer; rich
 * text (headings, lists, links, code, emoji, images) in the banner's font,
 * on a terminal's dark, monospaced, faintly scan-lined screen, under a title bar that says "Broadcast
 * Announcement". A click outside it, Escape or the arrow rolls it back up.
 *
 * The message is followed by the one prompt, which takes typing while the view is open (it has the focus), as a
 * terminal would: Backspace, and Enter runs the line (TerminalAnswers): "ls" lists the user's workspaces with their
 * state and uptime, "date" says the date, "whoami" says "Skynet", "clear" empties the screen, "time" prints the time
 * on a dot-matrix display (DotMatrixTime, ticking); anything starting with "rm" is answered with a wagging finger and
 * "ahh ahh ahh..." that fade away after 1.5 s (NoNoResponse); anything else is not found. The effects take the whole
 * screen (fullscreen.ts) while they last: typing "skynet" rolls the view up and fades the screen into Skynet; running
 * "rm -rf *" breaks the screen (BrokenScreenOverlay) until any key; "matrix" pours the Matrix's rain over it
 * (MatrixOverlay) until a key or the mouse; "/dev/mouse" turns the mouse pointer into sparks (sparksCursor) until any
 * key is pressed.
 */
export const BannerScrollView: React.FC<BannerScrollViewProps> = ({
	banner,
	anchor,
	colors,
}) => {
	// Platform: the banner's background picture (an animated GIF too) across the terminal's screen as well
	const picture = safeHref(banner.picture ?? "");
	const [open, setOpen] = useState(false);
	const [closing, setClosing] = useState(false);
	const [rect, setRect] = useState<Rect>();
	const [typed, setTyped] = useState("");
	const [history, setHistory] = useState<{ command: string; answer: Answer }[]>(
		[],
	);
	// "clear": the screen empty, the message too, until the view is opened again
	const [cleared, setCleared] = useState(false);
	const [skynet, setSkynet] = useState(false);
	const [broken, setBroken] = useState(false);
	const [matrix, setMatrix] = useState(false);
	const panel = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const toggle = useRef<HTMLButtonElement>(null);
	// Platform: each effect over the whole screen while it lasts (fullscreen.ts)
	const endSkynet = useCallback(() => {
		setSkynet(false);
		leaveFullscreen();
	}, []);
	const endBroken = useCallback(() => {
		setBroken(false);
		leaveFullscreen();
	}, []);
	const endMatrix = useCallback(() => {
		setMatrix(false);
		leaveFullscreen();
	}, []);

	const place = () => {
		const r = anchor.current?.getBoundingClientRect();
		if (!r) {
			return;
		}
		const width = Math.min(window.innerWidth - 16, Math.max(r.width, 560));
		const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
		setRect({ top: r.bottom + 6, left, width });
	};

	const close = () => {
		if (!open || closing) {
			return;
		}
		setClosing(true);
		window.setTimeout(() => {
			setOpen(false);
			setClosing(false);
		}, CLOSE_MS);
	};

	useLayoutEffect(() => {
		if (open) {
			place();
		}
	}, [open]);

	// Open: the prompt takes the keyboard, starting empty.
	useEffect(() => {
		if (open && rect) {
			panel.current?.focus({ preventScroll: true });
		}
		if (!open) {
			setTyped("");
			setHistory([]);
			setCleared(false);
		}
	}, [open, rect]);

	// Typing shows at the bottom, where the prompt is.
	useLayoutEffect(() => {
		if (body.current && (typed || history.length)) {
			body.current.scrollTop = body.current.scrollHeight;
		}
	}, [typed, history]);

	const onPromptKey = (event: React.KeyboardEvent) => {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		if (event.key === "Backspace") {
			setTyped((t) => t.slice(0, -1));
		} else if (event.key === "Enter") {
			const command = typed.trim().replace(/\s+/g, " ");
			setTyped("");
			if (command === "clear") {
				setHistory([]);
				setCleared(true);
			} else {
				setHistory((h) =>
					[...h, { command, answer: answerFor(command) }].slice(-MAX_HISTORY),
				);
			}
			if (RM_RF.test(command)) {
				enterFullscreen();
				setBroken(true);
				close();
			} else if (command === MATRIX) {
				enterFullscreen();
				setMatrix(true);
				close();
			} else if (command === MOUSE) {
				close();
				// after this Enter: the sparks stop at the next key
				window.setTimeout(startSparks, 0);
			}
		} else if (event.key.length === 1) {
			const next = (typed + event.key).slice(0, MAX_TYPED);
			if (next.trim().toLowerCase() === SKYNET) {
				setTyped("");
				enterFullscreen();
				setSkynet(true);
				close();
			} else {
				setTyped(next);
			}
		} else {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
	};

	useEffect(() => {
		if (!open) {
			return;
		}
		const onPointer = (event: PointerEvent) => {
			const target = event.target as Node;
			if (panel.current?.contains(target) || toggle.current?.contains(target)) {
				return;
			}
			close();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				close();
				toggle.current?.focus();
			}
		};
		const onResize = () => place();
		document.addEventListener("pointerdown", onPointer, true);
		document.addEventListener("keydown", onKey);
		window.addEventListener("resize", onResize);
		return () => {
			document.removeEventListener("pointerdown", onPointer, true);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", onResize);
		};
	});

	return (
		<>
			<button
				ref={toggle}
				type="button"
				aria-label={
					open ? "Close the full announcement" : "Read the whole announcement"
				}
				aria-expanded={open && !closing}
				title={open ? "Close" : "Read the whole announcement"}
				data-testid="announcement-scroll-toggle"
				onClick={() => (open ? close() : setOpen(true))}
				// At the banner's right, beside its close button and like it.
				className="flex size-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[9px] border border-solid border-white/30 bg-white/10 p-0 text-inherit hover:bg-white/20"
			>
				<ChevronDownIcon
					aria-hidden
					className={cn(
						"size-4 transition-transform duration-200",
						open && !closing && "rotate-180",
					)}
				/>
			</button>
			{open &&
				rect &&
				createPortal(
					<div
						ref={panel}
						role="dialog"
						aria-label="Announcement"
						data-testid="announcement-scroll-view"
						data-closing={closing || undefined}
						tabIndex={-1}
						onKeyDown={onPromptKey}
						className="banner-scroll"
						data-picture={picture ? "" : undefined}
						style={
							{
								top: rect.top,
								left: rect.left,
								width: rect.width,
								...(colors
									? {
											"--banner-scroll-screen": colors.bg,
											"--banner-scroll-ink": colors.fg,
										}
									: {}),
							} as React.CSSProperties
						}
					>
						{picture && (
							<div
								className="banner-scroll-picture"
								aria-hidden
								data-testid="announcement-scroll-picture"
							>
								<PictureScreen
									pictures={[
										{
											src: picture,
											alt: "",
											fit: banner.pictureFit ?? "span",
										},
									]}
								/>
							</div>
						)}
						<div
							className="banner-scroll-bar"
							data-testid="announcement-scroll-title"
							aria-hidden
						>
							<b>Broadcast Announcement</b>
						</div>
						<div ref={body} className="banner-scroll-body">
							{!cleared && (
								<div
									className="banner-scroll-text"
									style={{ fontFamily: bannerFontStack(banner.font) }}
								>
									<BannerBlocks
										message={banner.message}
										markdown={banner.markdown !== false}
									/>
								</div>
							)}
							{history.map(({ command, answer }, i) => (
								<div key={i} className="banner-scroll-prompt" aria-hidden>
									<i>root@platform</i>:<em>~</em># {command}
									<TerminalAnswer
										answer={answer}
										command={command}
										time={<DotMatrixTime />}
									/>
								</div>
							))}
							<div
								className="banner-scroll-prompt"
								data-testid="announcement-scroll-prompt"
								aria-hidden
							>
								<i>root@platform</i>:<em>~</em># {typed}
								<span className="banner-scroll-cursor" />
							</div>
						</div>
					</div>,
					document.body,
				)}
			{skynet && <SkynetOverlay onDone={endSkynet} />}
			{broken && <BrokenScreenOverlay onDone={endBroken} />}
			{matrix && <MatrixOverlay onDone={endMatrix} />}
		</>
	);
};
