import { useEffect } from "react";

const unlockSequence = [
	"ArrowUp",
	"ArrowUp",
	"ArrowDown",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"ArrowLeft",
	"ArrowRight",
	"b",
	"a",
];

export function useDoomUnlock(
	enabled: boolean,
	anchor: React.RefObject<HTMLElement | null>,
	panel: React.RefObject<HTMLElement | null>,
	unlock: () => void,
) {
	useEffect(() => {
		if (!enabled) return;
		let matched = 0;
		let lastKeyAt = 0;
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target;
			const inPanel = target instanceof Node && panel.current?.contains(target);
			const bounds = anchor.current?.getBoundingClientRect();
			if (
				(!inPanel && (!bounds?.width || !bounds.height)) ||
				event.defaultPrevented ||
				event.repeat ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				(target instanceof Element &&
					(target.closest("input, textarea, select, [contenteditable]") ||
						(!inPanel && target.closest("[role=dialog]"))))
			) {
				matched = 0;
				return;
			}
			if (event.timeStamp - lastKeyAt > 2000) matched = 0;
			lastKeyAt = event.timeStamp;
			const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
			if (key !== unlockSequence[matched]) {
				matched = key === unlockSequence[0] ? 1 : 0;
				return;
			}
			matched++;
			if (matched === unlockSequence.length) {
				event.preventDefault();
				event.stopPropagation();
				matched = 0;
				unlock();
			}
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [enabled, anchor, panel, unlock]);
}
