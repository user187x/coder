import type { BannerFields } from "#/api/platform";

/** A line takes several seconds, leaving time to read it before it moves away. */
export const READ_PX_PER_SECOND = 4;
export const READ_DELAY_MS = 2000;

/** Reads overflowing announcements automatically; holding the pointer pauses at the current position. */
export const attachAnnouncementAutoScroll = (
	hover: HTMLElement,
	scroller: () => HTMLElement | null = () => hover,
	loop = false,
	options: Pick<
		BannerFields,
		"autoScroll" | "autoScrollSpeed" | "pauseOnHover" | "pauseOnClick"
	> = {},
): (() => void) => {
	let frame = 0;
	let delay = 0;
	let held = false;
	let hovered = false;
	let clicked = false;
	let manual = false;
	const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
	const enabled = () =>
		options.autoScroll !== false &&
		document.documentElement.dataset.animations !== "off" &&
		!reducedMotion?.matches;
	const stop = () => {
		cancelAnimationFrame(frame);
		window.clearTimeout(delay);
		frame = 0;
	};
	const down = () => {
		const el = scroller();
		if (!el || !enabled() || held || hovered || clicked || manual) {
			return;
		}
		let last = performance.now();
		let position = el.scrollTop;
		const step = (now: number) => {
			position +=
				((options.autoScrollSpeed ?? READ_PX_PER_SECOND) *
					Math.min(now - last, 100)) /
				1000;
			last = now;
			const end = Math.max(0, el.scrollHeight - el.clientHeight);
			const source = loop
				? el.querySelector<HTMLElement>("[data-banner-loop-source]")
				: null;
			const period = source?.getBoundingClientRect().height ?? 0;
			const cycling = loop && period > el.clientHeight;
			if (cycling) position %= period;
			el.scrollTop = cycling ? position : Math.min(position, end);
			frame = cycling || position < end ? requestAnimationFrame(step) : 0;
		};
		frame = requestAnimationFrame(step);
	};
	const resume = () => {
		stop();
		if (enabled() && !held && !hovered && !clicked && !manual) {
			delay = window.setTimeout(down, READ_DELAY_MS);
		}
	};
	const pause = () => {
		if (options.pauseOnClick) return;
		held = true;
		stop();
	};
	const release = () => {
		if (held) {
			held = false;
			resume();
		}
	};
	const wheel = () => {
		manual = true;
		stop();
	};
	const enter = () => {
		if (options.pauseOnHover) {
			hovered = true;
			stop();
		}
	};
	const leave = () => {
		hovered = false;
		resume();
	};
	const click = (event: MouseEvent) => {
		if (
			!options.pauseOnClick ||
			(event.target instanceof Element &&
				event.target.closest('button, a, input, [role="button"]'))
		)
			return;
		clicked = !clicked;
		resume();
	};
	const preferenceChanged = () => resume();
	const observer = new MutationObserver(preferenceChanged);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-animations"],
	});
	hover.addEventListener("pointerenter", enter);
	hover.addEventListener("pointerleave", leave);
	hover.addEventListener("click", click);
	hover.addEventListener("pointerdown", pause);
	hover.addEventListener("wheel", wheel, { passive: true });
	hover.addEventListener("keydown", wheel);
	window.addEventListener("pointerup", release);
	window.addEventListener("pointercancel", release);
	window.addEventListener("blur", release);
	reducedMotion?.addEventListener?.("change", preferenceChanged);
	resume();
	return () => {
		stop();
		observer.disconnect();
		hover.removeEventListener("pointerenter", enter);
		hover.removeEventListener("pointerleave", leave);
		hover.removeEventListener("click", click);
		hover.removeEventListener("pointerdown", pause);
		hover.removeEventListener("wheel", wheel);
		hover.removeEventListener("keydown", wheel);
		window.removeEventListener("pointerup", release);
		window.removeEventListener("pointercancel", release);
		window.removeEventListener("blur", release);
		reducedMotion?.removeEventListener?.("change", preferenceChanged);
	};
};
