/**
 * The announcement terminal's effects (Skynet, the broken screen, the Matrix) over the whole screen: the browser's
 * fullscreen, asked for on the keypress that starts one (a browser allows it only then), left when it ends. Where it
 * is refused or missing, the effect still covers the window.
 */
export const enterFullscreen = () => {
	try {
		if (!document.fullscreenElement) {
			void document.documentElement.requestFullscreen?.()?.catch(() => {});
		}
	} catch {
		// not allowed here: the window, then
	}
};

export const leaveFullscreen = () => {
	try {
		if (document.fullscreenElement) {
			void document.exitFullscreen?.()?.catch(() => {});
		}
	} catch {
		// already left
	}
};
