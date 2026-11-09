import { orderCards } from "./SortableCards";

const card = (id: string) => ({ id, label: id, node: null });

describe("orderCards", () => {
	it("puts the saved order first and new cards after it in their own order", () => {
		const cards = ["workspaces", "gpu", "memory", "network"].map(card);
		expect(
			orderCards(cards, ["network", "memory", "gone"]).map((c) => c.id),
		).toEqual(["network", "memory", "workspaces", "gpu"]);
	});
});
