import type { QueryClient } from "react-query";
import {
	changeBrowserLock,
	closeBrowserSession,
	getBrowserLock,
} from "#/api/browserSessions";

export const closeWorkspaceBrowserSession = (baseUrl: string, id: string) => ({
	mutationFn: () => closeBrowserSession(baseUrl, id),
});

const browserLockKey = (baseUrl: string) => ["browser-lock", baseUrl] as const;

/** Polled so a lock from another tab or window closes this panel's shutter too. */
export const browserLock = (baseUrl: string) => ({
	queryKey: browserLockKey(baseUrl),
	queryFn: () => getBrowserLock(baseUrl),
	refetchInterval: 5_000,
	retry: false,
});

export const changeWorkspaceBrowserLock = (
	client: QueryClient,
	baseUrl: string,
) => ({
	mutationFn: (request: Parameters<typeof changeBrowserLock>[1]) =>
		changeBrowserLock(baseUrl, request),
	onSuccess: (status: Awaited<ReturnType<typeof changeBrowserLock>>) => {
		client.setQueryData(browserLockKey(baseUrl), status);
	},
	onSettled: () =>
		client.invalidateQueries({ queryKey: browserLockKey(baseUrl) }),
});
