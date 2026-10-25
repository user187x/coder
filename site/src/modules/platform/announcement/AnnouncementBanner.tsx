import { cn } from "cn";
import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type { Banner } from "#/api/platform";
import { globalLockdown } from "#/api/queries/globalLockdown";
import {
	announcementStatus,
	banner as bannerQuery,
	confirmAnnouncement,
	markAnnouncementViewed,
} from "#/api/queries/platform";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { GlobalLockdownNotice } from "#/modules/platform/globalLockdown/GlobalLockdown";
import { BannerCountdown } from "./BannerCountdown";
import { BannerScrollView } from "./BannerScrollView";
import { BannerText } from "./BannerText";
import { CloseLayers, useCloseTransition } from "./bannerClose";
import { OpenLayers, useOpenTransition } from "./bannerOpen";
import {
	confirmBackground,
	hasContent,
	LEVEL_COLORS,
	lcdInk,
	outlineColor,
	parseColors,
} from "./bannerTokens";
import "./bannerLcd.css";
import { bannerAlpha, withBannerAlpha } from "./bannerAlpha";
import { attachAnnouncementAutoScroll } from "./hoverAutoScroll";
import { useBannerLive, wasPushed } from "./useBannerLive";
import {
	type CertificateFingerprints,
	NOT_RECORDED,
	useCertificateFingerprint,
} from "./useCertificateFingerprint";

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

type BannerLcdProps = {
	/** The banner's opacity (percent): the glass fades with the card. */
	opacity?: number;
	/** The banner's colours: the screen is tinted with bg, the message lit in lcdInk. */
	bg: string;
	fg: string;
	/** The banner's corner radius: the screen's corners follow it, less the bezel. */
	radius: number;
	children: React.ReactNode;
};

/** The bezel around the screen: the banner's padding at the top, bottom and left. */
const LCD_BEZEL = 4;

/** The banner's screen (bannerLcd.css): a long LCD set into the banner, holding the message. */
export const BannerLcd: React.FC<BannerLcdProps> = ({
	opacity,
	bg,
	fg,
	radius,
	children,
}) => (
	<div
		className="banner-lcd"
		data-testid="announcement-lcd"
		style={
			{
				"--banner-bg": bg,
				"--banner-alpha": bannerAlpha(opacity),
				"--banner-lcd-ink": lcdInk(bg, fg),
				"--banner-outline": outlineColor(lcdInk(bg, fg)),
				"--banner-lcd-radius": `${Math.max(2, radius - LCD_BEZEL)}px`,
			} as React.CSSProperties
		}
	>
		{children}
	</div>
);

// The navbar's card is rounded 14px; full-width banners are square, their screen a little rounded.
const CARD_RADIUS: Record<Placement, number> = {
	navbar: 14,
	page: 0,
	login: 0,
};

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
	const lockdown = useQuery({
		...globalLockdown(),
		enabled: enabled && placement !== "login",
	});

	if (placement !== "login" && lockdown.data?.enabled) {
		return (
			<div
				className={cn(
					"overflow-hidden",
					placement === "navbar"
						? "ml-3 min-w-0 flex-1 rounded-[14px]"
						: "w-full",
				)}
			>
				<GlobalLockdownNotice />
			</div>
		);
	}

	const shown =
		banner?.enabled &&
		hasContent(banner) &&
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
	// Receipts (who viewed it, Confirm): not on the sign-in page, and only when
	// the announcement asks for them (a greeting need not).
	const receipts = placement !== "login" && banner.receipts !== false;
	const compact = placement !== "page";
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
	const card = useRef<HTMLDivElement>(null);
	// Overflow reads slowly; holding the pointer pauses without resetting the reader.
	useEffect(() => {
		const el = card.current;
		return el
			? attachAnnouncementAutoScroll(
					el,
					() => el.querySelector<HTMLElement>("[data-banner-text]"),
					compact && banner.loopText !== false,
				)
			: undefined;
	}, [banner.message, banner.loopText, compact]);

	useEffect(() => {
		if (receipts && signedIn && !viewed.has(banner.id)) {
			viewed.add(banner.id);
			reportView(banner.id);
		}
	}, [receipts, signedIn, banner.id, reportView]);

	// Confirmed already (maybe in another browser): a dismissible announcement
	// goes away here too.
	useEffect(() => {
		if (receipts && acked && banner.dismissible) {
			onDismiss();
		}
	}, [receipts, acked, banner.dismissible, onDismiss]);

	// Dismissed here (the close button, or Confirm): it goes with its close transition.
	const closeEffect = banner.closeEffect ?? "fade";
	const close = useCloseTransition(closeEffect, onDismiss);
	// Appearing (the page loads with it, or a new announcement arrives): its open transition.
	const openEffect = banner.openEffect ?? "none";
	const open = useOpenTransition(openEffect);
	const opening = open.opening && !close.closing;

	return (
		<div
			ref={card}
			id="coder-system-banner"
			role="status"
			data-closing={close.props["data-closing"]}
			data-opening={opening ? openEffect : undefined}
			onAnimationEnd={(event) => {
				open.props.onAnimationEnd(event);
				close.props.onAnimationEnd(event);
			}}
			className={cn(
				"flex items-center gap-1",
				placement === "navbar"
					? "ml-3 min-h-9 min-w-0 flex-1 gap-1.5 rounded-[14px] py-1 pl-1 pr-1.5 text-[13px] leading-[18px] shadow-[0_1px_3px_rgb(0_0_0/.2),inset_0_0_0_1px_rgb(255_255_255/.14)]"
					: "w-full p-1 text-center text-sm",
				wasPushed(banner.id) &&
					openEffect === "none" &&
					"animate-in fade-in slide-in-from-top-2 duration-300",
			)}
			style={{
				background: withBannerAlpha(bg, banner.opacity),
				color: fg,
				// Transparent: what shows through is blurred, so the text keeps reading
				...(bannerAlpha(banner.opacity) < 1
					? { backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }
					: {}),
			}}
		>
			{banner.countdown && <BannerCountdown to={banner.countdown} />}
			<BannerLcd
				bg={bg}
				fg={fg}
				radius={CARD_RADIUS[placement]}
				opacity={banner.opacity}
			>
				<BannerText
					banner={banner}
					animate
					loop={compact && banner.loopText !== false}
					className={cn(
						"min-w-0 flex-1 text-center",
						// Long announcements must leave room for the sign-in form.
						compact && "max-h-[36px] overflow-hidden [overflow-wrap:anywhere]",
					)}
				/>
			</BannerLcd>
			{/* Scroll mode: the whole message at once, without waiting for its effect - at the right, by the close */}
			{placement !== "login" && (
				<BannerScrollView banner={banner} anchor={card} colors={{ bg, fg }} />
			)}
			{opening && <OpenLayers effect={openEffect} />}
			{close.closing && <CloseLayers effect={closeEffect} />}
			{receipts && signedIn && viewedAt && <ViewedStamp viewedAt={viewedAt} />}
			{receipts && signedIn && (
				<ConfirmButton
					background={confirmBackground(bg)}
					confirmed={acked && !banner.dismissible}
					onConfirm={() => {
						confirm.mutate(banner.id);
						if (banner.dismissible) {
							close.start();
						}
					}}
				/>
			)}
			{!receipts && placement !== "login" && banner.dismissible && (
				<DismissButton onDismiss={close.start} />
			)}
		</div>
	);
};

/** Without receipts there is no Confirm to put a dismissible announcement away: a plain close button does. */
const DismissButton: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => (
	<button
		type="button"
		onClick={onDismiss}
		aria-label="Dismiss this announcement"
		title="Dismiss"
		data-testid="announcement-dismiss"
		className="flex size-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[9px] border border-solid border-white/30 bg-white/10 p-0 text-inherit hover:bg-white/20"
	>
		<XIcon aria-hidden className="size-4" />
	</button>
);

/** "UTC-5", "UTC+5:30", "UTC": the browser's offset from UTC at that moment. */
const utcOffset = (at: Date): string => {
	const minutes = -at.getTimezoneOffset();
	if (minutes === 0) {
		return "UTC";
	}
	const sign = minutes > 0 ? "+" : "-";
	const h = Math.floor(Math.abs(minutes) / 60);
	const m = Math.abs(minutes) % 60;
	return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
};

/**
 * The Viewed box's tooltip:
 *   Announcement Viewed:
 *   Date: October 11, 2026 @ 10:29 PM UTC-5
 *   Certificate Fingerprint: AB:CD:…   (SHA-256 of the user's certificate)
 *   MD5 HASH: 01:23:…                  (MD5 of it)
 * The two certificate lines only when the user has a certificate on file.
 */
export const viewedTooltip = (
	at: Date,
	certificate: CertificateFingerprints | null | undefined,
) => {
	const date = at.toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	});
	const time = at.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
	const lines = [
		"Announcement Viewed:",
		`Date: ${date} @ ${time} ${utcOffset(at)}`,
	];
	if (certificate) {
		lines.push(
			`Certificate Fingerprint: ${certificate.sha256 ?? NOT_RECORDED}`,
			`MD5 HASH: ${certificate.md5 ?? NOT_RECORDED}`,
		);
	}
	return lines.join("\n");
};

// The Viewed box and the Confirm button: the same size, side by side at the right.
const RECEIPT_BOX =
	"flex h-[28px] w-[6.75rem] shrink-0 items-center justify-center rounded-[9px] border border-solid";

/**
 * When this user first saw the announcement, as the admins' report records it:
 * whether or not they confirm it, both sides know it was seen.
 */
const ViewedStamp: React.FC<{ viewedAt: string }> = ({ viewedAt }) => {
	const fingerprint = useCertificateFingerprint();
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
			title={viewedTooltip(at, fingerprint)}
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
			 * The "seen and accounted for" badge: under "Viewed", a little to its right, hanging over the box's bottom
			 * edge like a sticker on the banner, its ribbons reaching past the banner into the navigation bar.
			 */}
			<img
				src="/announcement-viewed.png"
				alt=""
				data-testid="announcement-viewed-badge"
				className="pointer-events-none absolute -bottom-[14px] left-[19px] z-10 block size-[25px] drop-shadow-[0_1px_2px_rgb(0_0_0/0.55)]"
			/>
		</span>
	);
};

type ConfirmButtonProps = {
	/** A grayer shade of the banner's colour (confirmBackground). */
	background: string;
	confirmed: boolean;
	onConfirm: () => void;
};

const ConfirmButton: React.FC<ConfirmButtonProps> = ({
	background,
	confirmed,
	onConfirm,
}) => {
	return (
		<button
			type="button"
			disabled={confirmed}
			onClick={onConfirm}
			style={{ background }}
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
				"border-white/60 px-2 hover:brightness-110",
				"text-inherit text-[13px] font-semibold leading-[18px] whitespace-nowrap",
				confirmed ? "cursor-default opacity-80" : "cursor-pointer",
			)}
		>
			{confirmed ? "Confirmed ✓" : "Confirm"}
		</button>
	);
};
