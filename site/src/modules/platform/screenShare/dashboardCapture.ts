/** Capture only this dashboard viewport. Consent is handled before this function is called. */
export const captureDashboard = async (onError: (message: string) => void) => {
	const { default: html2canvas } = await import("html2canvas-pro");
	const canvas = document.createElement("canvas");
	if (!canvas.captureStream)
		throw new Error("Dashboard support is not available in this browser.");
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Could not capture the dashboard.");
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const paint = async () => {
		const width = innerWidth;
		const height = innerHeight;
		const frame = await html2canvas(document.documentElement, {
			x: scrollX,
			y: scrollY,
			width,
			height,
			windowWidth: width,
			windowHeight: height,
			scale: Math.min(1, 1600 / width),
			useCORS: true,
			logging: false,
			imageTimeout: 1500,
			backgroundColor: getComputedStyle(document.body).backgroundColor || null,
			onclone: (clone) => {
				for (const element of clone.querySelectorAll<HTMLElement>(
					'[data-dashboard-support-ignore],iframe,video,input[type="password"],input[type="file"],[autocomplete="one-time-code"]',
				)) {
					// Preserve geometry so the captured view and input coordinates stay aligned.
					element.style.visibility = "hidden";
				}
			},
		});
		if (stopped) return;
		if (canvas.width !== frame.width || canvas.height !== frame.height) {
			canvas.width = frame.width;
			canvas.height = frame.height;
		}
		context.drawImage(frame, 0, 0);
	};
	await paint();
	// Automatic frames remain a fallback for browsers without requestFrame.
	const stream = canvas.captureStream(5);
	const track = stream.getVideoTracks()[0];
	const publishFrame = () => {
		if (
			track &&
			"requestFrame" in track &&
			typeof track.requestFrame === "function"
		)
			track.requestFrame();
	};
	const events = ["click", "input", "change", "scroll", "resize"] as const;
	const stop = () => {
		stopped = true;
		clearTimeout(timer);
		for (const event of events)
			window.removeEventListener(event, requestPaint, true);
		for (const track of stream.getTracks()) track.stop();
	};
	let painting = false;
	let pending = false;
	const next = async () => {
		if (stopped) return;
		if (painting) {
			pending = true;
			return;
		}
		painting = true;
		clearTimeout(timer);
		try {
			await paint();
			if (!stopped) publishFrame();
		} catch {
			stop();
			onError("Dashboard capture stopped. Reconnect to try again.");
			return;
		} finally {
			painting = false;
		}
		if (stopped) return;
		if (pending) {
			pending = false;
			queueMicrotask(() => void next());
		} else timer = setTimeout(next, 250);
	};
	const requestPaint = () => queueMicrotask(() => void next());
	for (const event of events)
		window.addEventListener(event, requestPaint, true);
	publishFrame();
	timer = setTimeout(next, 250);
	return { stream, stop };
};
