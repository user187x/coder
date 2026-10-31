export type SplitDirection = "vertical" | "horizontal";
type TerminalLayout =
	| string
	| { direction: SplitDirection; children: TerminalLayout[] };

/** Remove closed panes and collapse their space into the remaining siblings. */
export const reconcileLayout = (
	layout: TerminalLayout | null,
	ids: string[],
): TerminalLayout | null => {
	const remaining = new Set(ids);
	const prune = (node: TerminalLayout): TerminalLayout | null => {
		if (typeof node === "string") return remaining.delete(node) ? node : null;
		const children = node.children.map(prune).filter((child) => child !== null);
		return children.length > 1 ? { ...node, children } : (children[0] ?? null);
	};
	const existing = layout === null ? null : prune(layout);
	const children = [...(existing === null ? [] : [existing]), ...remaining];
	return children.length > 1
		? { direction: "horizontal", children }
		: (children[0] ?? null);
};

/** A vertical divider adds a pane to the right; a horizontal one adds it below. */
export const splitLayout = (
	layout: TerminalLayout,
	id: string,
	added: string,
	direction: SplitDirection,
): TerminalLayout => {
	if (layout === id) return { direction, children: [id, added] };
	if (typeof layout === "string") return layout;
	return {
		...layout,
		children: layout.children.map((child) =>
			splitLayout(child, id, added, direction),
		),
	};
};

export const replaceLayoutIds = (
	layout: TerminalLayout | null,
	ids: Map<string, string>,
): TerminalLayout | null => {
	if (layout === null) return null;
	if (typeof layout === "string") return ids.get(layout) ?? layout;
	return {
		...layout,
		children: layout.children.map(
			(child) => replaceLayoutIds(child, ids) ?? child,
		),
	};
};

type PaneBounds = { left: number; top: number; width: number; height: number };

/** Flat keyed panes keep their connections mounted when the split tree changes. */
export const terminalBounds = (
	layout: TerminalLayout | null,
	bounds: PaneBounds = { left: 0, top: 0, width: 100, height: 100 },
): Map<string, PaneBounds> => {
	if (layout === null) return new Map();
	if (typeof layout === "string") return new Map([[layout, bounds]]);
	const vertical = layout.direction === "vertical";
	return new Map(
		layout.children.flatMap((child, index) => {
			const size =
				(vertical ? bounds.width : bounds.height) / layout.children.length;
			return [
				...terminalBounds(child, {
					left: bounds.left + (vertical ? index * size : 0),
					top: bounds.top + (vertical ? 0 : index * size),
					width: vertical ? size : bounds.width,
					height: vertical ? bounds.height : size,
				}),
			];
		}),
	);
};

const validLayout = (value: unknown, depth = 0): value is TerminalLayout => {
	if (typeof value === "string") return true;
	return (
		depth < 6 &&
		typeof value === "object" &&
		value !== null &&
		"direction" in value &&
		(value.direction === "vertical" || value.direction === "horizontal") &&
		"children" in value &&
		Array.isArray(value.children) &&
		value.children.length > 0 &&
		value.children.length <= 6 &&
		value.children.every((child: unknown) => validLayout(child, depth + 1))
	);
};

export const loadLayout = (key: string): TerminalLayout | null => {
	try {
		const value: unknown = JSON.parse(
			sessionStorage.getItem(`coder-ui-terminal-layout:${key}`) ?? "null",
		);
		return validLayout(value) ? value : null;
	} catch {
		return null;
	}
};

export const saveLayout = (key: string, layout: TerminalLayout | null) => {
	try {
		if (layout === null)
			sessionStorage.removeItem(`coder-ui-terminal-layout:${key}`);
		else
			sessionStorage.setItem(
				`coder-ui-terminal-layout:${key}`,
				JSON.stringify(layout),
			);
	} catch {
		// The live layout still works when browser storage is unavailable.
	}
};
