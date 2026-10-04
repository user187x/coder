import type { BannerFields } from "#/api/platform";
import { bannerColors } from "./AnnouncementBanner";
import { BannerText } from "./BannerText";

type BannerPreviewProps = {
	banner: BannerFields;
	/** Plays the text effect; change the component's key to replay it. */
	animate?: boolean;
};

/** The announcement as developers see it, without its receipts. */
export const BannerPreview: React.FC<BannerPreviewProps> = ({
	banner,
	animate = false,
}) => {
	const { bg, fg } = bannerColors(banner);
	return (
		<div
			className="flex w-full items-center justify-center gap-3 rounded-md px-6 py-2.5 text-center text-sm"
			style={{ background: bg, color: fg }}
		>
			<BannerText banner={banner} animate={animate} />
			<span
				aria-hidden
				className="shrink-0 rounded-[7px] border border-solid border-white/60 bg-white/15 px-3.5 py-[3px] text-[13px] leading-[18px] font-semibold whitespace-nowrap"
			>
				Confirm
			</span>
		</div>
	);
};
