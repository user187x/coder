import { XIcon } from "lucide-react";
import { useEffect } from "react";
import type { BannerFields } from "#/api/platform";
import { BannerLcd, bannerColors } from "./AnnouncementBanner";
import { AnnouncementReader } from "./AnnouncementReader";
import { BannerCountdown } from "./BannerCountdown";
import { BannerText } from "./BannerText";
import { withBannerAlpha } from "./bannerAlpha";
import { CloseLayers, useCloseTransition } from "./bannerClose";
import { OpenLayers, useOpenTransition } from "./bannerOpen";
import { useAnnouncementMotion } from "./useAnnouncementMotion";

type BannerPreviewProps = {
	banner: BannerFields;
	/** Plays the open transition and the text effect; change the component's key to replay them. */
	animate?: boolean;
	/** Plays its close transition as soon as it is shown, then calls onClosed. */
	closing?: boolean;
	onClosed?: () => void;
};

/** The announcement as developers see it: its Confirm, or its close button without receipts. */
export const BannerPreview: React.FC<BannerPreviewProps> = ({
	banner,
	animate = false,
	closing = false,
	onClosed,
}) => {
	const motion = useAnnouncementMotion(banner.animationsDisabled);
	const { bg, fg } = bannerColors(banner);
	const closeEffect = motion.effects ? (banner.closeEffect ?? "fade") : "none";
	const close = useCloseTransition(closeEffect, () => onClosed?.());
	const { start } = close;
	const openEffect =
		animate && motion.effects ? (banner.openEffect ?? "none") : "none";
	const open = useOpenTransition(openEffect);
	const opening = motion.effects && open.opening && !close.closing;
	// Shown a moment first, then closed.
	useEffect(() => {
		if (!closing) {
			return;
		}
		const timer = window.setTimeout(start, 600);
		return () => window.clearTimeout(timer);
	}, [closing, start]);
	return (
		<AnnouncementReader banner={banner}>
			<div
				data-announcement-motion={motion.effects ? "on" : "off"}
				className="flex w-full items-center gap-1 rounded-md p-1 text-center text-sm"
				style={{ background: withBannerAlpha(bg, banner.opacity), color: fg }}
				data-closing={motion.effects ? close.props["data-closing"] : undefined}
				data-opening={opening ? openEffect : undefined}
				onAnimationEnd={(event) => {
					open.props.onAnimationEnd(event);
					close.props.onAnimationEnd(event);
				}}
			>
				{banner.countdown && <BannerCountdown to={banner.countdown} />}
				<BannerLcd bg={bg} fg={fg} radius={6} opacity={banner.opacity}>
					<BannerText
						banner={banner}
						animate={animate}
						className="min-w-0 flex-1 py-1.5 text-center"
					/>
				</BannerLcd>
				{opening && <OpenLayers effect={openEffect} />}
				{motion.effects && close.closing && (
					<CloseLayers effect={closeEffect} />
				)}
				{banner.receipts !== false ? (
					<span
						aria-hidden
						className="shrink-0 rounded-[7px] border border-solid border-white/60 bg-white/15 px-3.5 py-[3px] text-[13px] leading-[18px] font-semibold whitespace-nowrap"
					>
						Confirm
					</span>
				) : (
					banner.dismissible && (
						<span
							aria-hidden
							className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border border-solid border-white/60 bg-white/15"
						>
							<XIcon className="size-4" />
						</span>
					)
				)}
			</div>
		</AnnouncementReader>
	);
};
