import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Banner } from "#/api/platform";
import { BannerBlocks } from "./BannerText";
import { bannerFontStack } from "./bannerFonts";
import "./bannerScrollView.css";

const CLOSE_MS = 220;

type Rect = { top: number; left: number; width: number };

type BannerScrollViewProps = {
	banner: Pick<Banner, "id" | "message" | "font">;
	/** The banner card: the view opens just under it, at least as wide. */
	anchor: React.RefObject<HTMLElement | null>;
};

/**
 * The announcement's scroll mode, for people who do not want to wait for its
 * effect: the down arrow glued to the banner's left rolls a terminal-like view
 * of the whole message down over the page (above everything else), about a
 * quarter of the page tall and scrollable when the message is longer; rich
 * text (headings, lists, links, code, emoji, images) in the banner's font,
 * on a terminal's dark, monospaced, faintly scan-lined screen. A click outside
 * it, Escape or the arrow rolls it back up.
 */
export const BannerScrollView: React.FC<BannerScrollViewProps> = ({
	banner,
	anchor,
}) => {
	const [open, setOpen] = useState(false);
	const [closing, setClosing] = useState(false);
	const [rect, setRect] = useState<Rect>();
	const panel = useRef<HTMLDivElement>(null);
	const toggle = useRef<HTMLButtonElement>(null);

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
				className="flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-solid border-white/60 bg-white/15 p-0 text-inherit"
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
						className="banner-scroll"
						style={{ top: rect.top, left: rect.left, width: rect.width }}
					>
						<div className="banner-scroll-bar" aria-hidden>
							<span />
							<span />
							<span />
							<b>announcement — broadcast.md</b>
						</div>
						<div className="banner-scroll-body">
							<div className="banner-scroll-prompt" aria-hidden>
								<i>root@platform</i>:<em>~</em># cat broadcast.md
							</div>
							<div
								className="banner-scroll-text"
								style={{ fontFamily: bannerFontStack(banner.font) }}
							>
								<BannerBlocks message={banner.message} />
							</div>
							<div className="banner-scroll-prompt" aria-hidden>
								<i>root@platform</i>:<em>~</em>#{" "}
								<span className="banner-scroll-cursor" />
							</div>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
};
