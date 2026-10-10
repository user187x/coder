const ORDER_KEY = "coder-ui-hud-order";

/** The metric ids in the order the user put them (clicked ones first), or []. */
export const readHudOrder = (): string[] => {
	try {
		const raw = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]");
		return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
	} catch {
		return [];
	}
};

export const writeHudOrder = (order: readonly string[]) => {
	try {
		if (order.length) {
			localStorage.setItem(ORDER_KEY, JSON.stringify(order));
		} else {
			localStorage.removeItem(ORDER_KEY);
		}
	} catch {
		// Not remembered.
	}
};

/** Moves id to the front. */
export const elevate = (order: readonly string[], id: string): string[] => [
	id,
	...order.filter((x) => x !== id),
];

/** The items in the user's order; those not in it keep their own order, after. */
export const applyOrder = <T extends { id: string }>(
	items: readonly T[],
	order: readonly string[],
): T[] => {
	const rank = new Map(order.map((id, i) => [id, i]));
	return items
		.map((item, i) => ({ item, i }))
		.sort(
			(a, b) =>
				(rank.get(a.item.id) ?? order.length + a.i) -
				(rank.get(b.item.id) ?? order.length + b.i),
		)
		.map(({ item }) => item);
};
