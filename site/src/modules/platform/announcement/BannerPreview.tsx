import { XIcon } from "lucide-react";
import { useEffect } from "react";
import type { BannerFields } from "#/api/platform";
import { BannerLcd, bannerColors } from "./AnnouncementBanner";
import { BannerText } from "./BannerText";
import { CloseLayers, useCloseTransition } from "./bannerClose";

type BannerPreviewProps = {
	banner: BannerFields;
	/** Plays the text effect; change the component's key to replay it. */
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
	const { bg, fg } = bannerColors(banner);
	const closeEffect = banner.closeEffect ?? "fade";
	const close = useCloseTransition(closeEffect, () => onClosed?.());
	const { start } = close;
	// Shown a moment first, then closed.
	useEffect(() => {
		if (!closing) {
			return;
		}
		const timer = window.setTimeout(start, 600);
		return () => window.clearTimeout(timer);
	}, [closing, start]);
	return (
		<div
			className="flex w-full items-center gap-1 rounded-md p-1 text-center text-sm"
			style={{ background: bg, color: fg }}
			{...close.props}
		>
			<BannerLcd bg={bg} fg={fg} radius={6}>
				<BannerText
					banner={banner}
					animate={animate}
					className="min-w-0 flex-1 py-1.5 text-center"
				/>
			</BannerLcd>
			{close.closing && <CloseLayers effect={closeEffect} />}
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
	);
};
