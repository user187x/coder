/**
 * Returns true if the current platform is macOS.
 *
 * Note: iPadOS 13+ also reports `navigator.platform === "MacIntel"`.
 */
export function isMac(): boolean {
	return Boolean(navigator.platform.match("Mac"));
}
