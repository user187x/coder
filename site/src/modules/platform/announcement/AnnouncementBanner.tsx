import { cn } from "cn";
import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useLocation } from "react-router";
import type { Banner, BannerFields } from "#/api/platform";
import { globalLockdown } from "#/api/queries/globalLockdown";
import {
	announcementStatus,
	banner as bannerQuery,
	confirmAnnouncement,
	markAnnouncementViewed,
} from "#/api/queries/platform";
import { terminateSignoffs } from "#/api/queries/workspacePower";
import { workspaceByOwnerAndName } from "#/api/queries/workspaces";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { navbarPageLabel } from "#/modules/dashboard/Navbar/adminQuickLinks";
import { GlobalLockdownNotice } from "#/modules/platform/globalLockdown/GlobalLockdown";
import { SignoffLight } from "../globalLockdown/TerminateSignoff";
import {
	useWorkspaceRestricted,
	WorkspaceRestrictionNotice,
} from "../quarantine/WorkspaceRestriction";
import { AnnouncementReader } from "./AnnouncementReader";
import { BannerCountdown } from "./BannerCountdown";
import { BannerScrollView } from "./BannerScrollView";
import { BannerText } from "./BannerText";
import { CloseLayers, useCloseTransition } from "./bannerClose";
import { OpenLayers, useOpenTransition } from "./bannerOpen";
import {
	ANNOUNCEMENT_ACTION_SURFACE,
	confirmBackground,
	hasContent,
	LEVEL_COLORS,
	lcdInk,
	outlineColor,
	parseColors,
} from "./bannerTokens";
import {
	SectionSplashPill,
	SPLASH_MIN_HEIGHT_CLASS,
} from "./SectionSplashPill";
import { showSectionSplash, useSectionSplash } from "./sectionIntroductions";
import { useAnnouncementMotion } from "./useAnnouncementMotion";
import { usePulldownAllowed } from "./usePulldownAllowed";
import "./bannerLcd.css";
import { formatFingerprint } from "#/utils/pkcs12";
import { bannerAlpha, withBannerAlpha } from "./bannerAlpha";
import { attachAnnouncementAutoScroll } from "./hoverAutoScroll";
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

// The legacy key also contains dismissals that were triggered by confirmation.
const DISMISSED_KEY = "coder-banner-dismissed";

const RECEIPT_DISMISSED_KEY = "coder-banner-receipt-dismissed";

const readDismissed = (key: string): string | null => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};

const writeDismissed = (key: string, id: string) => {
	try {
		localStorage.setItem(key, id);
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
	onEdit?: () => void;
	/** Set only for administrators who can use Global Command & Control. */
	terminateAlertViewerId?: string;
};

/** The announcement published in General > Announcement. */
export const AnnouncementBanner: React.FC<AnnouncementBannerProps> = ({
	placement,
	terminateAlertViewerId,
	onEdit,
}) => {
	const { pathname } = useLocation();
	const match = pathname.match(/^\/@([^/]+)\/([^/]+)\/?$/);
	const viewed = useQuery({
		...workspaceByOwnerAndName(
			match ? decodeURIComponent(match[1]) : "",
			match ? decodeURIComponent(match[2]) : "",
		),
		enabled: Boolean(match) && placement !== "login",
	});
	const restricted = useWorkspaceRestricted(match ? viewed.data : undefined);
	const enabled = !isEmbeddedFrame();
	const live = useBannerLive(enabled);
	const { data: banner } = useQuery({ ...bannerQuery(live), enabled });
	const dismissalKey =
		banner && hasReceipts(banner, placement)
			? RECEIPT_DISMISSED_KEY
			: DISMISSED_KEY;
	const [dismissed, setDismissed] = useState(() => ({
		[DISMISSED_KEY]: readDismissed(DISMISSED_KEY),
		[RECEIPT_DISMISSED_KEY]: readDismissed(RECEIPT_DISMISSED_KEY),
	}));
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

	if (placement !== "login" && restricted && viewed.data)
		return (
			<div
				className={placement === "navbar" ? "ml-3 min-w-0 flex-1" : "w-full"}
			>
				<WorkspaceRestrictionNotice name={viewed.data.name} />
			</div>
		);

	const shown =
		banner?.enabled &&
		!(banner.dismissible && dismissed[dismissalKey] === banner.id) &&
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
			onEdit={onEdit}
			terminateAlertViewerId={
				placement === "login" ? undefined : terminateAlertViewerId
			}
			onDismiss={() => {
				writeDismissed(dismissalKey, banner.id);
				setDismissed((previous) => ({
					...previous,
					[dismissalKey]: banner.id,
				}));
			}}
		/>
	);
};

const hasReceipts = (banner: Banner, placement: Placement) =>
	placement !== "login" && banner.receipts !== false && hasContent(banner);

type AnnouncementCardProps = {
	terminateAlertViewerId?: string;
	banner: Banner;
	placement: Placement;
	onDismiss: () => void;
	onEdit?: () => void;
};

const AnnouncementCard: React.FC<AnnouncementCardProps> = ({
	banner,
	placement,
	onDismiss,
	onEdit,
	terminateAlertViewerId,
}) => {
	const { data: terminateRound } = useQuery({
		...terminateSignoffs(),
		enabled: Boolean(terminateAlertViewerId) && !isEmbeddedFrame(),
	});
	const activeSignoffs =
		terminateAlertViewerId && !isEmbeddedFrame()
			? terminateRound?.signoffs
			: undefined;
	const leftSignoff = activeSignoffs?.[0];
	const rightSignoff = activeSignoffs?.[1] ?? leftSignoff;
	const motion = useAnnouncementMotion(banner.animationsDisabled);
	const showSections = placement !== "login";
	const introductions = banner.introductions === true && showSections;
	const sectionSplash = useSectionSplash(introductions);
	const splash = showSections ? sectionSplash : null;
	const showSplash = introductions || Boolean(splash);
	const queryClient = useQueryClient();
	// Receipts (who viewed it, Confirm): not on the sign-in page, and only when
	// the announcement asks for them (a greeting need not).
	// A blank banner has nothing to read or confirm, and announces nothing.
	const blank = !hasContent(banner);
	const receipts = hasReceipts(banner, placement);
	const compact = placement !== "page";
	const inNavbar = placement === "navbar";
	const { pathname } = useLocation();
	const showCurrentView = () => {
		const label = navbarPageLabel(pathname) ?? document.title.split(" - ")[0];
		showSectionSplash(label || "Coder", banner.introDurationMs);
	};
	const onBannerClick = (event: React.MouseEvent) => {
		if (
			event.detail !== 1 ||
			(event.target instanceof Element &&
				event.target.closest("button, a, input, [role=button]"))
		)
			return;
		showCurrentView();
	};
	const statusQuery = useQuery({
		...announcementStatus(banner.id),
		enabled: receipts,
	});
	const markViewed = useMutation(markAnnouncementViewed(queryClient));
	const confirm = useMutation(confirmAnnouncement(queryClient));
	const status = statusQuery.data;
	const signedIn = status?.signedIn === true;
	const pulldown = usePulldownAllowed(banner);
	const acked = status?.signedIn === true && status.acked;
	const viewedAt =
		status?.signedIn === true ? (status.viewedAt ?? undefined) : undefined;
	const { bg, fg } = bannerColors(banner);
	const { mutate: reportView } = markViewed;
	const card = useRef<HTMLDivElement>(null);
	// Overflow reads slowly; holding the pointer pauses without resetting the reader.
	useEffect(() => {
		const el = card.current;
		return el && motion.effects
			? attachAnnouncementAutoScroll(
					el,
					() => el.querySelector<HTMLElement>("[data-banner-text]"),
					compact && banner.loopText !== false,
					banner,
				)
			: undefined;
	}, [
		motion.effects,
		banner.message,
		banner.loopText,
		banner.autoScroll,
		banner.autoScrollSpeed,
		banner.pauseOnHover,
		banner.pauseOnClick,
		compact,
	]);

	useEffect(() => {
		if (receipts && signedIn && !viewed.has(banner.id)) {
			viewed.add(banner.id);
			reportView(banner.id);
		}
	}, [receipts, signedIn, banner.id, reportView]);

	const closeEffect = motion.effects ? (banner.closeEffect ?? "fade") : "none";
	const close = useCloseTransition(closeEffect, onDismiss);
	// Appearing (the page loads with it, or a new announcement arrives): its open transition.
	const openEffect = motion.effects ? (banner.openEffect ?? "none") : "none";
	const open = useOpenTransition(openEffect);
	const opening = motion.effects && open.opening && !close.closing;

	return (
		<AnnouncementReader banner={banner} navbarMove={inNavbar} onEdit={onEdit}>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: the screen button below provides the keyboard action. */}
			<div
				ref={card}
				id="coder-system-banner"
				onClick={showSections ? onBannerClick : undefined}
				data-announcement-motion={motion.effects ? "on" : "off"}
				role={blank ? undefined : "status"}
				data-closing={motion.effects ? close.props["data-closing"] : undefined}
				data-opening={opening ? openEffect : undefined}
				onAnimationEnd={(event) => {
					open.props.onAnimationEnd(event);
					close.props.onAnimationEnd(event);
				}}
				className={cn(
					"flex items-center gap-1",
					placement === "navbar"
						? "ml-3 min-h-9 min-w-0 flex-1 gap-1.5 rounded-[14px] py-1 pl-1 pr-1.5 text-[13px] leading-[18px] shadow-[0_1px_3px_rgb(0_0_0/.2),inset_0_0_0_1px_rgb(255_255_255/.14)]"
						: "min-h-9 w-full p-1 text-center text-sm",
					motion.effects &&
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
					{showSections && (
						<button
							type="button"
							aria-label="Show current view name"
							onClick={showCurrentView}
							className="absolute inset-0 cursor-pointer rounded-[inherit] border-0 bg-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-link"
						/>
					)}
					{leftSignoff && (
						<span className="relative z-10 ml-2 flex shrink-0 items-center">
							<SignoffLight signoff={leftSignoff} />
						</span>
					)}
					<BannerText
						banner={banner}
						animate
						loop={compact && !inNavbar && banner.loopText !== false}
						className={cn(
							"min-w-0 flex-1 text-center",
							// The navbar stays one row: the message shrinks to one line and ends in an ellipsis.
							inNavbar && "truncate",
							// Long announcements must leave room for the sign-in form.
							compact &&
								!inNavbar &&
								"max-h-[36px] overflow-hidden [overflow-wrap:anywhere]",
							// The section splash replaces the message while it shows: none of it peeks out beside the pill.
							showSplash &&
								motion.effects &&
								"transition-opacity duration-300 motion-reduce:transition-none",
							splash && "opacity-0",
							splash &&
								!inNavbar &&
								SPLASH_MIN_HEIGHT_CLASS[banner.introSize ?? "normal"],
						)}
					/>
					{rightSignoff && (
						<span className="relative z-10 flex shrink-0 items-center">
							<SignoffLight signoff={rightSignoff} />
						</span>
					)}
					{/* The section's name over whatever the banner shows, on a blurred pill. */}
					{showSplash && (
						<span
							aria-live="polite"
							data-testid="section-splash"
							className={cn(
								"pointer-events-none absolute inset-0 flex items-center justify-center px-3",
								motion.effects &&
									"transition-opacity duration-300 motion-reduce:transition-none",
								splash ? "opacity-100" : "opacity-0",
							)}
						>
							{splash && (
								<SectionSplashPill
									key={splash}
									label={splash}
									look={banner}
									inNavbar={inNavbar}
								/>
							)}
						</span>
					)}
				</BannerLcd>
				{/* Scroll mode: the whole message at once, without waiting for its effect - at the right, by the close */}
				{placement !== "login" && pulldown && (
					<BannerScrollView banner={banner} anchor={card} colors={{ bg, fg }} />
				)}
				{opening && <OpenLayers effect={openEffect} />}
				{motion.effects && close.closing && (
					<CloseLayers effect={closeEffect} />
				)}
				{receipts && signedIn && viewedAt && (
					<ViewedStamp
						viewedAt={viewedAt}
						fingerprint={
							status?.signedIn ? status.certificateFingerprint : undefined
						}
					/>
				)}
				{receipts && signedIn && (
					<ConfirmButton
						background={confirmBackground(bg)}
						confirmed={acked}
						onConfirm={() => confirm.mutate(banner.id)}
					/>
				)}
				{(!receipts || acked) &&
					placement !== "login" &&
					banner.dismissible && <DismissButton onDismiss={close.start} />}
			</div>
		</AnnouncementReader>
	);
};

/** A separate close button keeps dismissal independent of confirmation. */
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

/** The date and certificate evidence recorded by the server for the first view. */
export const viewedTooltip = (at: Date, fingerprint?: string | null) => {
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
	if (fingerprint) {
		lines.push(
			`Certificate Fingerprint (SHA-256): ${formatFingerprint(fingerprint)}`,
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
const ViewedStamp: React.FC<{
	viewedAt: string;
	fingerprint?: string | null;
}> = ({ viewedAt, fingerprint }) => {
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

/** What the introduction preview draws: the banner's look and the introduction's settings. */
export type IntroductionPreviewLook = Pick<
	BannerFields,
	| "title"
	| "level"
	| "opacity"
	| "receipts"
	| "dismissible"
	| "introEffect"
	| "introSize"
	| "introWeight"
	| "introUppercase"
	| "font"
	| "animationsDisabled"
>;

/**
 * The navbar's announcement banner as it shows a section introduction, for the admin's preview: its card, colours,
 * opacity, screen and Confirm or close button exactly as developers see them, as wide as its container.
 */
export const BannerIntroductionPreview: React.FC<{
	banner: IntroductionPreviewLook;
	label: string;
}> = ({ banner, label }) => {
	const { bg, fg } = bannerColors(banner);
	const receipts = banner.receipts !== false;
	const motion = useAnnouncementMotion(banner.animationsDisabled);
	return (
		<div
			data-testid="introduction-banner-preview"
			data-announcement-motion={motion.effects ? "on" : "off"}
			className="flex min-h-9 w-full min-w-0 items-center gap-1.5 rounded-[14px] py-1 pr-1.5 pl-1 text-[13px] leading-[18px] shadow-[0_1px_3px_rgb(0_0_0/.2),inset_0_0_0_1px_rgb(255_255_255/.14)]"
			style={{ background: withBannerAlpha(bg, banner.opacity), color: fg }}
		>
			<BannerLcd
				bg={bg}
				fg={fg}
				radius={CARD_RADIUS.navbar}
				opacity={banner.opacity}
			>
				<span className="flex min-w-0 flex-1 items-center justify-center px-3">
					<SectionSplashPill key={label} label={label} look={banner} inNavbar />
				</span>
			</BannerLcd>
			{receipts ? (
				<span
					aria-hidden
					style={{ background: confirmBackground(bg) }}
					className={cn(
						RECEIPT_BOX,
						ANNOUNCEMENT_ACTION_SURFACE,
						"px-2 text-[13px] font-semibold leading-[18px] whitespace-nowrap",
					)}
				>
					Confirm
				</span>
			) : (
				banner.dismissible && (
					<span
						aria-hidden
						className="flex size-[28px] shrink-0 items-center justify-center rounded-[9px] border border-solid border-white/30 bg-white/10"
					>
						<XIcon className="size-4" />
					</span>
				)
			)}
		</div>
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
				ANNOUNCEMENT_ACTION_SURFACE,
				"px-2",
				"text-inherit text-[13px] font-semibold leading-[18px] whitespace-nowrap",
				confirmed ? "cursor-default opacity-80" : "cursor-pointer",
			)}
		>
			{confirmed ? "Confirmed ✓" : "Confirm"}
		</button>
	);
};
