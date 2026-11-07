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
	| "introEffect"
	| "introSize"
	| "introWeight"
	| "introUppercase"
	| "font"
	| "animationsDisabled"
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
			data-intro-uppercase={look.introUppercase ? "" : undefined}
			className={cn(
				"relative isolate max-w-full px-4 text-white [text-shadow:0_0_2px_rgb(0_0_0/0.9),0_0_6px_rgb(0_0_0/0.6)]",
				// The backdrop is a feathered layer behind the text: its tint and blur fade out toward the edges, so the pill has no hard border.
				"before:pointer-events-none before:absolute before:-inset-x-4 before:-inset-y-2 before:-z-10 before:rounded-full before:bg-black/55 before:[mask-image:radial-gradient(closest-side,#000_55%,transparent)] supports-[backdrop-filter]:before:bg-black/30 supports-[backdrop-filter]:before:backdrop-blur-md",
				WEIGHT_CLASS[look.introWeight ?? "semibold"],
				// CSS only: the screen reader still gets the label as written.
				look.introUppercase && "uppercase",
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
