import { cn } from "cn";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type { Banner } from "#/api/platform";
import {
	announcementStatus,
	banner as bannerQuery,
	confirmAnnouncement,
	markAnnouncementViewed,
} from "#/api/queries/platform";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { BannerText } from "./BannerText";
import { LEVEL_COLORS, parseColors } from "./bannerTokens";
import { useBannerLive, wasPushed } from "./useBannerLive";

/**
 * Where the banner is drawn:
 *   navbar   docked in the (sticky) navbar as a rounded card, so it stays in
 *            view while the page scrolls
 *   page     full width under the navbar (narrow screens)
 *   login    full width on the sign-in page, when the admin allowed it; no
 *            Confirm button there, because a confirmation must be attributable
 */
type Placement = "navbar" | "page" | "login";

// The coder-banner service's own key for the dismissed announcement, kept so
// dismissals made before this dashboard version still count.
const DISMISSED_KEY = "coder-banner-dismissed";

const readDismissed = (): string | null => {
	try {
		return localStorage.getItem(DISMISSED_KEY);
	} catch {
		return null;
	}
};

const writeDismissed = (id: string) => {
	try {
		localStorage.setItem(DISMISSED_KEY, id);
	} catch {
		// Storage unavailable: the banner returns on the next page load.
	}
};

// Views are reported once per announcement and page load.
const viewed = new Set<string>();

export const bannerColors = (banner: Pick<Banner, "title" | "level">) =>
	parseColors(banner.title) ?? LEVEL_COLORS[banner.level] ?? LEVEL_COLORS.info;

type AnnouncementBannerProps = {
	placement: Placement;
};

/** The announcement published in General > Announcement. */
export const AnnouncementBanner: React.FC<AnnouncementBannerProps> = ({
	placement,
}) => {
	const enabled = !isEmbeddedFrame();
	const live = useBannerLive(enabled);
	const { data: banner } = useQuery({ ...bannerQuery(live), enabled });
	const [dismissedId, setDismissedId] = useState(readDismissed);

	const shown =
		banner?.enabled &&
		banner.message &&
		!(banner.dismissible && dismissedId === banner.id) &&
		(placement !== "login" || banner.showOnLoginPage);

	if (!banner || !shown) {
		return null;
	}

	return (
		<AnnouncementCard
			// A new announcement (or changed text) starts afresh: its effect
			// plays again and its receipt is its own.
			key={`${banner.id}:${banner.message}:${banner.effect}`}
			banner={banner}
			placement={placement}
			onDismiss={() => {
				writeDismissed(banner.id);
				setDismissedId(banner.id);
			}}
		/>
	);
};

type AnnouncementCardProps = {
	banner: Banner;
	placement: Placement;
	onDismiss: () => void;
};

const AnnouncementCard: React.FC<AnnouncementCardProps> = ({
	banner,
	placement,
	onDismiss,
}) => {
	const queryClient = useQueryClient();
	const receipts = placement !== "login";
	const statusQuery = useQuery({
		...announcementStatus(banner.id),
		enabled: receipts,
	});
	const markViewed = useMutation(markAnnouncementViewed());
	const confirm = useMutation(confirmAnnouncement(queryClient));
	const status = statusQuery.data;
	const signedIn = status?.signedIn === true;
	const acked = status?.signedIn === true && status.acked;
	const { bg, fg } = bannerColors(banner);
	const { mutate: reportView } = markViewed;

	useEffect(() => {
		if (signedIn && !viewed.has(banner.id)) {
			viewed.add(banner.id);
			reportView(banner.id);
		}
	}, [signedIn, banner.id, reportView]);

	// Confirmed already (maybe in another browser): a dismissible announcement
	// goes away here too.
	useEffect(() => {
		if (acked && banner.dismissible) {
			onDismiss();
		}
	}, [acked, banner.dismissible, onDismiss]);

	return (
		<div
			id="coder-system-banner"
			role="status"
			className={cn(
				"flex items-center gap-3",
				placement === "navbar"
					? "ml-3 min-h-9 min-w-0 flex-1 rounded-[10px] py-1 pr-1 pl-3.5 text-[13px] leading-[18px] shadow-[0_1px_3px_rgb(0_0_0/.2),inset_0_0_0_1px_rgb(255_255_255/.14)]"
					: "w-full justify-center px-6 py-2.5 text-center text-sm",
				placement === "navbar" && !signedIn && "pr-3.5",
				wasPushed(banner.id) &&
					"animate-in fade-in slide-in-from-top-2 duration-300",
			)}
			style={{ background: bg, color: fg }}
			onMouseEnter={(event) => {
				// The full text on hover, but only when it is cut short.
				const text =
					event.currentTarget.querySelector<HTMLElement>("[data-banner-text]");
				if (!text) {
					return;
				}
				if (text.scrollHeight > text.clientHeight + 1) {
					text.title = text.textContent?.replace(/\s+/g, " ").trim() ?? "";
				} else {
					text.removeAttribute("title");
				}
			}}
		>
			<BannerText
				banner={banner}
				animate
				className={cn(
					placement === "navbar" &&
						"min-w-0 flex-1 overflow-hidden [overflow-wrap:anywhere] line-clamp-2",
				)}
			/>
			{receipts && signedIn && (
				<ConfirmButton
					confirmed={acked && !banner.dismissible}
					onConfirm={() => {
						confirm.mutate(banner.id);
						if (banner.dismissible) {
							onDismiss();
						}
					}}
				/>
			)}
		</div>
	);
};

type ConfirmButtonProps = {
	confirmed: boolean;
	onConfirm: () => void;
};

const ConfirmButton: React.FC<ConfirmButtonProps> = ({
	confirmed,
	onConfirm,
}) => {
	return (
		<button
			type="button"
			disabled={confirmed}
			onClick={onConfirm}
			aria-label={
				confirmed
					? "You confirmed this announcement"
					: "Confirm that you have read this announcement"
			}
			title={
				confirmed ? undefined : "Confirm that you have read this announcement"
			}
			className={cn(
				"min-h-7 shrink-0 rounded-[7px] border border-solid border-white/60 bg-white/15 px-3.5 py-[3px]",
				"text-inherit text-[13px] font-semibold leading-[18px] whitespace-nowrap",
				confirmed ? "cursor-default opacity-80" : "cursor-pointer",
			)}
		>
			{confirmed ? "Confirmed ✓" : "Confirm"}
		</button>
	);
};
