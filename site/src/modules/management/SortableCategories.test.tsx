import { fireEvent, render, screen } from "@testing-library/react";
import {
	orderCategories,
	type SidebarCategory,
	SortableCategories,
} from "./SortableCategories";

const category = (id: string, label: string): SidebarCategory => ({
	id,
	label,
	node: <a href={`/${id}`}>{label}</a>,
});
const categories = [
	category("security", "Security"),
	category("accounts", "Accounts"),
	category("health", "Health"),
	category("network", "Network"),
];
const shown = () =>
	screen
		.getAllByTestId("admin-category")
		.map((el) => el.getAttribute("data-category"));

describe("orderCategories", () => {
	it("lists them alphabetically without an order", () => {
		expect(orderCategories(categories, []).map((c) => c.id)).toEqual([
			"accounts",
			"health",
			"network",
			"security",
		]);
	});

	it("keeps the admin's order, then the categories never placed alphabetically, and skips unknown ones", () => {
		expect(
			orderCategories(categories, ["network", "gone", "accounts"]).map(
				(c) => c.id,
			),
		).toEqual(["network", "accounts", "health", "security"]);
	});
});

describe("SortableCategories", () => {
	it("shows the admin's order with a handle on each, and lists them alphabetically again on A-Z", () => {
		const onReorder = vi.fn();
		render(
			<SortableCategories
				categories={categories}
				order={["security", "network"]}
				onReorder={onReorder}
			/>,
		);
		expect(shown()).toEqual(["security", "network", "accounts", "health"]);
		expect(
			screen.getByRole("button", { name: "Move Security" }),
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", {
				name: "List the categories alphabetically",
			}),
		);
		expect(onReorder).toHaveBeenCalledWith([]);
	});

	it("has nothing to sort when they are already alphabetical", () => {
		render(
			<SortableCategories
				categories={categories}
				order={[]}
				onReorder={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", {
				name: "List the categories alphabetically",
			}),
		).toBeDisabled();
	});
});
