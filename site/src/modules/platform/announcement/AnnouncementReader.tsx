import { useEffect, useRef, useState } from "react";
import type { BannerFields } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { AnnouncementImage } from "./AnnouncementImage";
import { BannerCountdown } from "./BannerCountdown";
import { BannerBlocks } from "./BannerText";
import { bannerFontStack } from "./bannerFonts";
import { safeHref } from "./bannerTokens";
import { attachAnnouncementAutoScroll } from "./hoverAutoScroll";
import {
	AnnouncementMotionDisabled,
	useAnnouncementMotion,
} from "./useAnnouncementMotion";
import { usePulldownAllowed } from "./usePulldownAllowed";

/** A full-message reader that leaves the announcement's dismissal state unchanged. */
export const AnnouncementReader: React.FC<{
	banner: BannerFields;
	children: React.ReactElement;
}> = ({ banner, children }) => {
	const [open, setOpen] = useState(false);
	const pulldown = usePulldownAllowed(banner);
	if (!pulldown) {
		return (
			<AnnouncementMotionDisabled.Provider
				value={banner.animationsDisabled === true}
			>
				{children}
			</AnnouncementMotionDisabled.Provider>
		);
	}
	return (
		<AnnouncementMotionDisabled.Provider
			value={banner.animationsDisabled === true}
		>
			<ContextMenu>
				<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onSelect={() => setOpen(true)}>
						Open announcement in modal
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					className="z-[100] max-w-3xl"
					overlayClassName="z-[99] backdrop-blur-lg"
				>
					<DialogTitle>Announcement</DialogTitle>
					<AnnouncementMessage banner={banner} />
					<DialogClose asChild>
						<Button variant="outline" className="justify-self-center">
							Close
						</Button>
					</DialogClose>
				</DialogContent>
			</Dialog>
		</AnnouncementMotionDisabled.Provider>
	);
};

export const AnnouncementMessage: React.FC<{ banner: BannerFields }> = ({
	banner,
}) => (
	<AnnouncementMotionDisabled.Provider
		value={banner.animationsDisabled === true}
	>
		<AnnouncementMessageContent banner={banner} />
	</AnnouncementMotionDisabled.Provider>
);

const AnnouncementMessageContent: React.FC<{ banner: BannerFields }> = ({
	banner,
}) => {
	const motion = useAnnouncementMotion(banner.animationsDisabled);
	const body = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = body.current;
		return el && motion.effects
			? attachAnnouncementAutoScroll(el, () => el, false, banner)
			: undefined;
	}, [
		motion.effects,
		banner.message,
		banner.autoScroll,
		banner.autoScrollSpeed,
		banner.pauseOnHover,
		banner.pauseOnClick,
	]);
	return (
		<div
			ref={body}
			data-announcement-motion={motion.effects ? "on" : "off"}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the message region.
			tabIndex={0}
			role="region"
			aria-label="Announcement message"
			className="max-h-[calc(60vh/var(--app-zoom,1))] overflow-y-auto break-words rounded-lg border border-solid border-border bg-surface-secondary p-5 text-sm leading-relaxed [&>p:not(:has(br))]:mx-auto [&>p:not(:has(br))]:w-fit"
			style={{ fontFamily: bannerFontStack(banner.font) }}
		>
			{banner.picture && safeHref(banner.picture) && (
				<AnnouncementImage
					src={banner.picture}
					alt="Announcement"
					className="mx-auto mb-4 block max-h-80 w-full object-contain object-center"
				/>
			)}
			{banner.countdown && <BannerCountdown to={banner.countdown} />}
			<BannerBlocks message={banner.message} markdown={banner.markdown} />
			{banner.linkUrl && safeHref(banner.linkUrl) && (
				<a href={banner.linkUrl}>{banner.linkText || "Read more"}</a>
			)}
		</div>
	);
};
