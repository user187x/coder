import { cn } from "cn";
import type { Banner, IntroSize, IntroWeight } from "#/api/platform";
import { BannerText } from "./BannerText";

/** Text size by placement: the navbar's one-row banner caps it. */
const SPLASH_SIZE_CLASS: Record<
	"navbar" | "banner",
	Record<IntroSize, string>
> = {
	navbar: { normal: "", large: "text-sm", xlarge: "text-base" },
	banner: { normal: "", large: "text-lg", xlarge: "text-2xl" },
};

/** Minimum height a banner gives the pill so a larger size grows the banner, not overflows it. */
export const SPLASH_MIN_HEIGHT_CLASS: Record<IntroSize, string> = {
	normal: "",
	large: "min-h-7",
	xlarge: "min-h-9",
};

const WEIGHT_CLASS: Record<IntroWeight, string> = {
	semibold: "font-semibold",
	bold: "font-bold",
	black: "font-black",
};

type SplashLook = Pick<
	Banner,
	"introEffect" | "introSize" | "introWeight" | "font" | "animationsDisabled"
>;

type SectionSplashPillProps = {
	label: string;
	look: SplashLook;
	inNavbar?: boolean;
};

/**
 * The section's name on a blurred pill. Its text is the banner's own text
 * renderer, so the chosen effect plays as it does in the banner (and not when
 * animations are disabled or reduced).
 */
export const SectionSplashPill: React.FC<SectionSplashPillProps> = ({
	label,
	look,
	inNavbar = false,
}) => {
	const effect = look.introEffect ?? "none";
	return (
		<span
			data-testid="section-splash-pill"
			data-intro-effect={effect}
			className={cn(
				"max-w-full rounded-full bg-black/55 px-4 text-white [text-shadow:0_0_2px_rgb(0_0_0/0.9),0_0_6px_rgb(0_0_0/0.6)] supports-[backdrop-filter]:bg-black/25 supports-[backdrop-filter]:backdrop-blur-md",
				WEIGHT_CLASS[look.introWeight ?? "semibold"],
				SPLASH_SIZE_CLASS[inNavbar ? "navbar" : "banner"][
					look.introSize ?? "normal"
				],
			)}
		>
			<BannerText
				animate
				className="block max-w-full truncate"
				banner={{
					title: "",
					message: label,
					linkText: "",
					linkUrl: "",
					effect,
					repeat: false,
					markdown: false,
					align: "center",
					font: look.font,
					animationsDisabled: look.animationsDisabled,
				}}
			/>
		</span>
	);
};
