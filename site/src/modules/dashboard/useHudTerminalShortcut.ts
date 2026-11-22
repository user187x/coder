import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { hudTerminalPath } from "#/modules/navigation";

const keys = [
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

export function useHudTerminalShortcut(enabled: boolean) {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	useEffect(() => {
		if (!enabled || pathname === hudTerminalPath) return;
		let matched = 0;
		let lastKeyAt = 0;
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.repeat ||
				event.defaultPrevented ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				(event.target instanceof Element &&
					event.target.closest(
						"input, textarea, select, [contenteditable], [role=dialog]",
					))
			) {
				matched = 0;
				return;
			}
			if (event.timeStamp - lastKeyAt > 2000) matched = 0;
			lastKeyAt = event.timeStamp;
			const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
			if (key !== keys[matched]) {
				matched = key === keys[0] ? 1 : 0;
				return;
			}
			matched++;
			if (matched === keys.length) {
				event.preventDefault();
				matched = 0;
				void navigate(hudTerminalPath);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled, navigate, pathname]);
}
