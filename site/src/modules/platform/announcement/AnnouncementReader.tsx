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
import { BannerCountdown } from "./BannerCountdown";
import { BannerBlocks } from "./BannerText";
import { bannerFontStack } from "./bannerFonts";
import { safeHref } from "./bannerTokens";
import { attachAnnouncementAutoScroll } from "./hoverAutoScroll";

/** A full-message reader that leaves the announcement's dismissal state unchanged. */
export const AnnouncementReader: React.FC<{
	banner: BannerFields;
	children: React.ReactElement;
}> = ({ banner, children }) => {
	const [open, setOpen] = useState(false);
	return (
		<>
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
						<Button variant="outline" className="justify-self-end">
							Close
						</Button>
					</DialogClose>
				</DialogContent>
			</Dialog>
		</>
	);
};

export const AnnouncementMessage: React.FC<{ banner: BannerFields }> = ({
	banner,
}) => {
	const body = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = body.current;
		return el
			? attachAnnouncementAutoScroll(el, () => el, false, banner)
			: undefined;
	}, [
		banner.message,
		banner.autoScroll,
		banner.autoScrollSpeed,
		banner.pauseOnHover,
		banner.pauseOnClick,
	]);
	return (
		<div
			ref={body}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the message region.
			tabIndex={0}
			role="region"
			aria-label="Announcement message"
			className="max-h-[60vh] overflow-y-auto break-words rounded-lg border border-solid border-border bg-surface-secondary p-5 text-sm leading-relaxed"
			style={{ fontFamily: bannerFontStack(banner.font) }}
		>
			{banner.picture && safeHref(banner.picture) && (
				<img
					src={banner.picture}
					alt="Announcement"
					className="mb-4 max-h-80 max-w-full object-contain"
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
