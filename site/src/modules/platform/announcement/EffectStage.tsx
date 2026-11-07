import { cn } from "cn";
import { BannerLcd, bannerColors } from "./AnnouncementBanner";
import { useAnnouncementMotion } from "./useAnnouncementMotion";

type EffectStageProps = {
	/** Still stage: the animations are off, as in a banner that disables them. */
	animationsDisabled?: boolean;
	className?: string;
	children: React.ReactNode;
};

/**
 * The banner's own setting for a text effect outside the banner (the effect
 * gallery's tiles, the introduction's preview): the card's colours and motion
 * attribute around the same LCD, so the stylesheet effects find the screen
 * ink, the dark glass, the clipping and the positioning they get in the banner.
 */
export const EffectStage: React.FC<EffectStageProps> = ({
	animationsDisabled,
	className,
	children,
}) => {
	const motion = useAnnouncementMotion(animationsDisabled);
	const { bg, fg } = bannerColors({ title: "", level: "info" });
	return (
		<span
			data-testid="effect-stage"
			data-effect-stage=""
			data-announcement-motion={motion.effects ? "on" : "off"}
			className={cn(
				"relative flex items-stretch overflow-hidden rounded-md p-1 text-center text-sm",
				className,
			)}
			style={{ background: bg, color: fg }}
		>
			<BannerLcd bg={bg} fg={fg} radius={10}>
				{children}
			</BannerLcd>
		</span>
	);
};
