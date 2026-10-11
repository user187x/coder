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
	const markViewed = useMutation(markAnnouncementViewed(queryClient));
	const confirm = useMutation(confirmAnnouncement(queryClient));
	const status = statusQuery.data;
	const signedIn = status?.signedIn === true;
	const acked = status?.signedIn === true && status.acked;
	const viewedAt =
		status?.signedIn === true ? (status.viewedAt ?? undefined) : undefined;
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
						"min-w-0 flex-1 overflow-hidden text-center [overflow-wrap:anywhere] line-clamp-2",
				)}
			/>
			{receipts && signedIn && viewedAt && <ViewedStamp viewedAt={viewedAt} />}
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

// The Viewed box and the Confirm button: the same size, side by side at the right.
const RECEIPT_BOX =
	"flex h-[30px] w-[6.75rem] shrink-0 items-center justify-center rounded-[7px] border border-solid";

/**
 * When this user first saw the announcement, as the admins' report records it:
 * whether or not they confirm it, both sides know it was seen.
 */
const ViewedStamp: React.FC<{ viewedAt: string }> = ({ viewedAt }) => {
	const at = new Date(viewedAt);
	if (Number.isNaN(at.getTime())) {
		return null;
	}
	const date = at.toLocaleDateString(undefined, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	const time = at.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
	const full = at.toLocaleString(undefined, {
		dateStyle: "full",
		timeStyle: "medium",
	});
	return (
		<span
			role="note"
			data-testid="announcement-viewed"
			aria-label={`You viewed this announcement on ${full}`}
			title={`You viewed this announcement on ${full}. Your administrators can see that you have seen it, even if you do not confirm it.`}
			className={cn(
				RECEIPT_BOX,
				"relative flex-col border-dashed border-white/45 px-1.5 text-[9.5px] leading-[12px] tabular-nums whitespace-nowrap",
				// Very faint diagonal zebra lines on a faint wash.
				"bg-white/[0.06] bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.09)_0_1.5px,transparent_1.5px_5px)]",
			)}
		>
			{/* Each line justified: the label at the left edge, the value at the right. */}
			<span className="flex w-full justify-between gap-1">
				<span>Viewed</span>
				<span>{date}</span>
			</span>
			<span className="flex w-full justify-between gap-1">
				<span />
				<span>{time}</span>
			</span>
			{/*
			 * The "seen and accounted for" badge: centred under "Viewed" and hanging over the box's bottom edge,
			 * like a sticker on the banner.
			 */}
			<img
				src="/announcement-viewed.png"
				alt=""
				data-testid="announcement-viewed-badge"
				className="pointer-events-none absolute -bottom-[7px] left-[12px] z-10 block size-[18px] drop-shadow-[0_1px_1.5px_rgb(0_0_0/0.5)]"
			/>
		</span>
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
				RECEIPT_BOX,
				"border-white/60 bg-white/15 px-2",
				"text-inherit text-[13px] font-semibold leading-[18px] whitespace-nowrap",
				confirmed ? "cursor-default opacity-80" : "cursor-pointer",
			)}
		>
			{confirmed ? "Confirmed ✓" : "Confirm"}
		</button>
	);
};
