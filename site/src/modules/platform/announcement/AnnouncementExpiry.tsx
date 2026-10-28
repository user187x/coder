import { useCallback, useEffect, useState } from "react";
import { useQuery } from "react-query";
import type { Banner } from "#/api/platform";
import { banner as bannerQuery } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import { Dialog, DialogContent, DialogTitle } from "#/components/Dialog/Dialog";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { AnnouncementMessage } from "./AnnouncementReader";
import { useBannerClock } from "./bannerClock";
import { useBannerLive } from "./useBannerLive";
import "./announcementExpiry.css";

const DISMISSED_EVENT = "coder-announcement-expiry-dismissed";

export const AnnouncementExpiry: React.FC = () => {
	const { user } = useAuthenticated();
	const live = useBannerLive(true);
	const { data: banner } = useQuery(bannerQuery(live));
	if (
		!banner?.enabled ||
		!banner.countdown ||
		!banner.countdownAction ||
		banner.countdownAction === "none"
	)
		return null;
	return (
		<AnnouncementExpiryNotice
			key={`${user.id}:${banner.id}:${banner.countdown}:${banner.countdownAction}`}
			banner={banner}
			userId={user.id}
		/>
	);
};

export const AnnouncementExpiryNotice: React.FC<{
	banner: Banner;
	userId: string;
}> = ({ banner, userId }) => {
	const now = useBannerClock();
	const target = Date.parse(banner.countdown ?? "");
	const token = `${banner.id}:${banner.countdown}:${banner.countdownAction}`;
	const storageKey = `coder:announcement-expiry:${userId}`;
	const [dismissed, setDismissed] = useState(() => {
		try {
			return localStorage.getItem(storageKey) === token;
		} catch {
			return false;
		}
	});
	const active =
		banner.enabled &&
		Number.isFinite(target) &&
		now >= target &&
		!dismissed &&
		(banner.countdownAction === "shake" || banner.countdownAction === "focus");
	const dismiss = useCallback(() => {
		setDismissed(true);
		try {
			localStorage.setItem(storageKey, token);
		} catch {
			/* The current page still remembers dismissal. */
		}
		window.dispatchEvent(new Event(DISMISSED_EVENT));
	}, [storageKey, token]);
	useEffect(() => {
		const sync = () => {
			try {
				if (localStorage.getItem(storageKey) === token) setDismissed(true);
			} catch {
				/* Storage can be unavailable in private browsing. */
			}
		};
		window.addEventListener("storage", sync);
		window.addEventListener(DISMISSED_EVENT, sync);
		return () => {
			window.removeEventListener("storage", sync);
			window.removeEventListener(DISMISSED_EVENT, sync);
		};
	}, [storageKey, token]);
	useEffect(() => {
		if (!active || banner.countdownAction !== "shake") return;
		document.documentElement.classList.add("announcement-expiry-shake");
		window.addEventListener("pointerdown", dismiss, true);
		window.addEventListener("keydown", dismiss, true);
		return () => {
			document.documentElement.classList.remove("announcement-expiry-shake");
			window.removeEventListener("pointerdown", dismiss, true);
			window.removeEventListener("keydown", dismiss, true);
		};
	}, [active, banner.countdownAction, dismiss]);
	if (!active) return null;
	if (banner.countdownAction === "shake")
		return (
			<div
				role="status"
				className="fixed bottom-16 left-1/2 z-[100] -translate-x-1/2 rounded-lg border border-solid border-border bg-surface-primary p-3 shadow-lg"
			>
				Announcement countdown finished. Click or press any key to stop.
			</div>
		);
	return (
		<Dialog open>
			<DialogContent
				className="z-[100] max-w-3xl"
				overlayClassName="z-[99] backdrop-blur-lg"
				onEscapeKeyDown={(event) => event.preventDefault()}
				onInteractOutside={(event) => event.preventDefault()}
				aria-describedby={undefined}
			>
				<DialogTitle>Announcement</DialogTitle>
				<AnnouncementMessage banner={banner} />
				<Button onClick={dismiss} className="justify-self-end">
					Dismiss
				</Button>
			</DialogContent>
		</Dialog>
	);
};
