import axios from "axios";

/** The browser gateway's PIN lock, as its control endpoint reports it. */
export type BrowserLockStatus = {
	configured: boolean;
	locked: boolean;
	/** Seconds until another PIN attempt is accepted. */
	retryAfter: number;
};

type BrowserLockAction =
	| { action: "pin-set"; pin: string }
	| { action: "pin-unlock"; pin: string }
	| { action: "pin-clear"; pin: string }
	| { action: "pin-lock" };

const controlUrl = (baseUrl: string) =>
	new URL("control", new URL(baseUrl, window.location.origin)).href;

/** End only the browser process group owned by this panel. */
export const closeBrowserSession = async (baseUrl: string, id: string) => {
	const control = controlUrl(baseUrl);
	const { data } = await axios.get<{ csrf: string }>(control);
	await axios.post(
		control,
		{ id },
		{ headers: { "X-Browser-CSRF": data.csrf } },
	);
};

export const getBrowserLock = async (baseUrl: string) => {
	const { data } = await axios.get<{ pin: BrowserLockStatus }>(
		controlUrl(baseUrl),
	);
	return data.pin;
};

/** The gateway keeps the unlock grant in an HttpOnly cookie; no PIN or token is stored in the page. */
export const changeBrowserLock = async (
	baseUrl: string,
	request: BrowserLockAction,
) => {
	const control = controlUrl(baseUrl);
	const { data } = await axios.get<{ csrf: string }>(control);
	const { data: status } = await axios.post<BrowserLockStatus>(
		control,
		request,
		{ headers: { "X-Browser-CSRF": data.csrf } },
	);
	return status;
};
