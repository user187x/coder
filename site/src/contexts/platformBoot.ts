/**
 * What the platform service tells every page before the dashboard starts.
 * index.html loads /__coder-ui/boot.js ahead of the dashboard's own code; it
 * sets the globals below so the logo, avatars and classification marking are
 * right from the first paint. Without the service the globals stay unset and
 * Coder's own logo and avatars show.
 *
 * The values are kept in a small store so that uploading a new logo or avatar
 * updates every place that shows it without a page reload.
 */
import { useSyncExternalStore } from "react";
import type { ClassificationSettings } from "#/api/platform";

type PlatformSnapshot = {
	logoURL: string;
	avatars: Readonly<Record<string, string>>;
	defaultAvatarURL: string;
	defaultAvatarUsers: ReadonlySet<string>;
};

const AVATAR_USERS_STORAGE_KEY = "coder-ui-avatar-users";

let snapshot: PlatformSnapshot = {
	logoURL: window.__cuiLogo ?? "",
	avatars: window.__cuiAvatars ?? {},
	defaultAvatarURL: window.__cuiAvatarDefault ?? "",
	defaultAvatarUsers: window.__cuiAvatarUsers ?? new Set(),
};

const listeners = new Set<() => void>();

const update = (patch: Partial<PlatformSnapshot>) => {
	snapshot = { ...snapshot, ...patch };
	for (const listener of listeners) {
		listener();
	}
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const getPlatformSnapshot = (): PlatformSnapshot => snapshot;

export const usePlatformSnapshot = (): PlatformSnapshot =>
	useSyncExternalStore(subscribe, getPlatformSnapshot);

export const getBootClassification = (): ClassificationSettings | undefined =>
	window.__cuiClassification;

export const setLogoURL = (url: string | null) => {
	update({ logoURL: url ?? "" });
	applyFavicons(url ?? "");
};

export const setUserAvatar = (username: string, url: string | null) => {
	const avatars = { ...snapshot.avatars };
	if (url) {
		avatars[username] = url;
	} else {
		delete avatars[username];
	}
	update({ avatars });
};

export const setDefaultAvatarUsers = (users: readonly string[]) => {
	update({ defaultAvatarUsers: new Set(users) });
	try {
		localStorage.setItem(AVATAR_USERS_STORAGE_KEY, JSON.stringify(users));
	} catch {
		// Not remembered: the next page load asks again.
	}
};

/**
 * The picture to show for a user: one they uploaded, else the default avatar
 * when they have none of their own (neither uploaded nor from Coder / OIDC).
 */
export const resolvePlatformAvatar = (
	state: PlatformSnapshot,
	username: string,
	ownSrc: string | undefined,
): string | undefined => {
	if (Object.hasOwn(state.avatars, username)) {
		return state.avatars[username];
	}
	if (
		!ownSrc &&
		state.defaultAvatarURL &&
		state.defaultAvatarUsers.has(username)
	) {
		return state.defaultAvatarURL;
	}
	return undefined;
};

const originalFavicons = new Map<HTMLLinkElement, string>();

/** The browser tab icon follows the uploaded logo. */
const applyFavicons = (logoURL: string) => {
	for (const link of document.head.querySelectorAll<HTMLLinkElement>(
		"link[rel~='icon']",
	)) {
		if (!originalFavicons.has(link)) {
			originalFavicons.set(link, link.href);
		}
		link.href = logoURL || originalFavicons.get(link) || link.href;
	}
};

if (snapshot.logoURL) {
	applyFavicons(snapshot.logoURL);
}

const EMBED_ATTRIBUTE = "platformEmbed";

/**
 * True for a dashboard page shown inside another dashboard page's frame (the
 * Agents view in General, for example). The page around it already shows the
 * classification marking, the announcement and the chat.
 */
export const isEmbeddedFrame = (): boolean => {
	try {
		return window.frameElement instanceof HTMLIFrameElement
			? window.frameElement.dataset[EMBED_ATTRIBUTE] !== undefined
			: false;
	} catch {
		return false;
	}
};

/** Data attributes that mark a frame as an embedded dashboard page. */
export const embedFrameAttributes = (homePath: string) => ({
	"data-platform-embed": homePath,
});

/**
 * In an embedded page, links that leave the embedded section navigate the
 * dashboard around it instead of the frame. Runs in the capture phase, before
 * React Router's own click handling.
 */
const installEmbeddedNavigation = () => {
	const frame = window.frameElement;
	if (!(frame instanceof HTMLIFrameElement)) {
		return;
	}
	const home = frame.dataset[EMBED_ATTRIBUTE] || "/";
	window.addEventListener(
		"click",
		(event) => {
			const anchor =
				event.target instanceof Element
					? event.target.closest<HTMLAnchorElement>("a[href]")
					: null;
			if (
				!anchor ||
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey ||
				anchor.target === "_blank"
			) {
				return;
			}
			const url = new URL(anchor.href, location.href);
			if (
				url.origin !== location.origin ||
				url.pathname === home ||
				url.pathname.startsWith(`${home}/`)
			) {
				return;
			}
			event.preventDefault();
			const target = url.pathname + url.search + url.hash;
			if (window.parent.__platformNavigate) {
				window.parent.__platformNavigate(target);
			} else {
				window.parent.location.href = url.href;
			}
		},
		true,
	);
};

if (isEmbeddedFrame()) {
	installEmbeddedNavigation();
}
