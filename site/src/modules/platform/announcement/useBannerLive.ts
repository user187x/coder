import { useEffect, useSyncExternalStore } from "react";
import { type QueryClient, useQueryClient } from "react-query";
import { type Banner, bannerLiveURL } from "#/api/platform";
import { bannerKey } from "#/api/queries/platform";

/**
 * The banner service pushes every change to every open tab over one WebSocket
 * (/__banner/live): the current banner on connect, then each change the
 * moment an admin publishes it. Pushed banners are written into the banner
 * query, so polling is only a safety net while the socket is up.
 *
 * One socket per page, shared by every component that shows the banner.
 */

// The service sends a heartbeat every 20 seconds: this long without a word
// means the connection died silently (laptop sleep, NAT timeout).
const SILENCE_MS = 60_000;
const WATCHDOG_MS = 10_000;

let users = 0;
let queryClient: QueryClient | null = null;
let socket: WebSocket | null = null;
let live = false;
let retries = 0;
let retryTimer: number | undefined;
let watchdogTimer: number | undefined;
let lastMessage = 0;
const liveListeners = new Set<() => void>();

const setLive = (next: boolean) => {
	if (live === next) {
		return;
	}
	live = next;
	for (const listener of liveListeners) {
		listener();
	}
};

// The last banner that replaced another by push: it draws attention to itself
// when it appears.
let pushedId: string | null = null;
export const wasPushed = (id: string): boolean => pushedId === id;

const isBannerMessage = (
	value: unknown,
): value is { type: "banner"; banner: Banner } =>
	typeof value === "object" &&
	value !== null &&
	"type" in value &&
	value.type === "banner" &&
	"banner" in value &&
	typeof value.banner === "object" &&
	value.banner !== null;

const lost = (ws: WebSocket) => {
	if (socket !== ws) {
		return;
	}
	socket = null;
	setLive(false);
	reconnectSoon();
};

// Exponential backoff with jitter, so a restart of the service does not have
// every tab reconnect at once.
const reconnectSoon = () => {
	if (retryTimer !== undefined || users === 0) {
		return;
	}
	const delay =
		Math.min(30_000, 1000 * 2 ** retries) * (0.5 + Math.random() / 2);
	retries++;
	retryTimer = window.setTimeout(() => {
		retryTimer = undefined;
		connect();
	}, delay);
};

const connect = () => {
	if (socket || users === 0) {
		return;
	}
	let ws: WebSocket;
	try {
		ws = new WebSocket(bannerLiveURL());
	} catch {
		reconnectSoon();
		return;
	}
	socket = ws;
	lastMessage = Date.now();
	ws.onmessage = (event) => {
		lastMessage = Date.now();
		retries = 0;
		setLive(true);
		let message: unknown;
		try {
			message = JSON.parse(String(event.data));
		} catch {
			return;
		}
		// Heartbeats ({"type": "hb"}) only prove the connection is alive.
		if (isBannerMessage(message) && queryClient) {
			const previous = queryClient.getQueryData<Banner>(bannerKey);
			if (previous && previous.id !== message.banner.id) {
				pushedId = message.banner.id;
			}
			queryClient.setQueryData(bannerKey, message.banner);
		}
	};
	ws.onclose = () => lost(ws);
	ws.onerror = () => lost(ws);
};

const watchdog = () => {
	const ws = socket;
	if (ws && Date.now() - lastMessage > SILENCE_MS) {
		lost(ws);
		ws.close();
	}
};

const onVisible = () => {
	if (!document.hidden) {
		connect();
	}
};

const onOnline = () => {
	retries = 0;
	connect();
};

const acquire = (client: QueryClient) => {
	queryClient = client;
	users++;
	if (users > 1) {
		return;
	}
	connect();
	watchdogTimer = window.setInterval(watchdog, WATCHDOG_MS);
	document.addEventListener("visibilitychange", onVisible);
	window.addEventListener("online", onOnline);
};

const release = () => {
	users--;
	if (users > 0) {
		return;
	}
	window.clearInterval(watchdogTimer);
	window.clearTimeout(retryTimer);
	retryTimer = undefined;
	document.removeEventListener("visibilitychange", onVisible);
	window.removeEventListener("online", onOnline);
	const ws = socket;
	socket = null;
	ws?.close();
	setLive(false);
};

/** Keeps the live channel open while mounted; true while it is connected. */
export const useBannerLive = (enabled: boolean): boolean => {
	const client = useQueryClient();
	useEffect(() => {
		if (!enabled) {
			return;
		}
		acquire(client);
		return release;
	}, [client, enabled]);
	return useSyncExternalStore(
		(listener) => {
			liveListeners.add(listener);
			return () => {
				liveListeners.delete(listener);
			};
		},
		() => live,
	);
};
