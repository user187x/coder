import type { UserUIPreferences } from "#/api/platform";
export type DockPosition = NonNullable<UserUIPreferences["chat_position"]>;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Snap the rectangle to its nearest usable screen edge, retaining its position along that edge. */
export const snapDockPosition = (
	rect: { left: number; top: number; width: number; height: number },
	bounds: { width: number; height: number; top: number; bottom: number },
): DockPosition => {
	const distances: [DockPosition["edge"], number][] = [
		["left", rect.left - 16],
		["right", bounds.width - rect.left - rect.width - 16],
		["top", rect.top - bounds.top - 8],
		["bottom", bounds.height - bounds.bottom - rect.top - rect.height - 10],
	];
	distances.sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
	const edge = distances[0][0];
	return {
		edge,
		offset: clamp(
			edge === "left" || edge === "right"
				? (rect.top - bounds.top - 8) /
						Math.max(
							1,
							bounds.height - bounds.top - bounds.bottom - rect.height - 18,
						)
				: (rect.left - 16) / Math.max(1, bounds.width - rect.width - 32),
		),
	};
};

/** The content right edge follows the Settings panel in both docked sizes. */
export const chatRightEdge = () => {
	const side = document.querySelector(".settings-menu[data-settings-docked]");
	return side
		? Math.max(
				0,
				Math.min(
					document.documentElement.clientWidth,
					(
						side.querySelector(
							'.settings-resource-tray-panel[aria-hidden="false"]',
						) ?? side
					).getBoundingClientRect().left,
				),
			)
		: document.documentElement.clientWidth;
};

export const placeDock = (
	element: HTMLElement,
	position: DockPosition,
	top: number,
	bottom: number,
) => {
	const width = chatRightEdge();
	const height = window.innerHeight;
	// Opposing anchors stretch an auto-sized dock and feed the previous position into its next measurement.
	element.style.right = "auto";
	element.style.bottom = "auto";
	const rect = element.getBoundingClientRect();
	const horizontal = Math.max(0, width - rect.width - 32);
	const vertical = Math.max(0, height - top - bottom - rect.height - 18);
	const left =
		position.edge === "left"
			? 16
			: position.edge === "right"
				? 16 + horizontal
				: 16 + position.offset * horizontal;
	const y =
		position.edge === "top"
			? top + 8
			: position.edge === "bottom"
				? top + 8 + vertical
				: top + 8 + position.offset * vertical;
	element.style.left = `${left}px`;
	element.style.top = `${y}px`;
};
