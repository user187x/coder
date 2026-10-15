import { XIcon } from "lucide-react";
import type { BannerFields } from "#/api/platform";
import { BannerLcd, bannerColors } from "./AnnouncementBanner";
import { BannerText } from "./BannerText";

type BannerPreviewProps = {
	banner: BannerFields;
	/** Plays the text effect; change the component's key to replay it. */
	animate?: boolean;
};

/** The announcement as developers see it: its Confirm, or its close button without receipts. */
export const BannerPreview: React.FC<BannerPreviewProps> = ({
	banner,
	animate = false,
}) => {
	const { bg, fg } = bannerColors(banner);
	return (
		<div
			className="flex w-full items-center gap-1 rounded-md p-1 text-center text-sm"
			style={{ background: bg, color: fg }}
		>
			<BannerLcd bg={bg} fg={fg} radius={6}>
				<BannerText
					banner={banner}
					animate={animate}
					className="min-w-0 flex-1 py-1.5 text-center"
				/>
			</BannerLcd>
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
