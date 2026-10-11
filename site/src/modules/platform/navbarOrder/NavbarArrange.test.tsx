import { act, fireEvent, render, screen } from "@testing-library/react";
import { NavbarArrange } from "./NavbarArrange";
import { normalizeOrder, startNavbarArrange } from "./navbarOrder";

const orderOf = (id: string) =>
	Number(
		(document.querySelector(`[data-navbar-item="${id}"]`) as HTMLElement).style
			.order,
	);

describe("normalizeOrder", () => {
	it("keeps the remembered order and adds what is missing", () => {
		expect(normalizeOrder(["hud", "banner", "x", "hud"])).toEqual([
			"hud",
			"banner",
			"workspaces",
			"latency",
		]);
		expect(normalizeOrder(null)).toEqual([
			"workspaces",
			"banner",
			"latency",
			"hud",
		]);
	});
});

describe("NavbarArrange", () => {
	beforeEach(() => localStorage.clear());

	it("arranges the buttons around a banner placeholder, then remembers", () => {
		render(
			<NavbarArrange
				items={{
					workspaces: <button type="button">Workspaces</button>,
					banner: <span>banner text</span>,
					latency: null,
					hud: <button type="button">HUD</button>,
				}}
			/>,
		);
		expect(screen.queryByTestId("navbar-banner-ghost")).toBeNull();
		fireEvent.contextMenu(screen.getByText("HUD"));
		expect(screen.getByTestId("navbar-banner-ghost")).toBeInTheDocument();
		const hud = screen.getByRole("button", { name: "Move HUD" });
		hud.focus();
		fireEvent.keyDown(hud, { key: "ArrowLeft" });
		fireEvent.keyDown(hud, { key: "ArrowLeft" });
		expect([orderOf("hud"), orderOf("workspaces"), orderOf("banner")]).toEqual([
			0, 1, 2,
		]);
		expect(hud).toHaveFocus();
		fireEvent.keyDown(hud, { key: "Enter" });
		expect(screen.queryByTestId("navbar-banner-ghost")).toBeNull();
		expect(screen.getByText("banner text")).toBeInTheDocument();
		// Latency (not shown to this user) keeps its slot; the others move around it.
		expect(
			JSON.parse(localStorage.getItem("coder-ui-navbar-order") ?? ""),
		).toEqual(["hud", "workspaces", "latency", "banner"]);
	});

	it("starts from the user menu", () => {
		render(
			<NavbarArrange
				items={{
					workspaces: <span>W</span>,
					banner: <span />,
					latency: <span>L</span>,
					hud: null,
				}}
			/>,
		);
		act(() => startNavbarArrange());
		expect(screen.getByTestId("navbar-arrange-hint")).toBeInTheDocument();
	});
});
