import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { MockNoPermissions, MockPermissions } from "#/testHelpers/entities";
import { escapeOpensWheel, RadialMenu } from "./RadialMenu";

const auth = { permissions: MockPermissions };
vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => auth,
}));

const escapeKey = (over: Partial<KeyboardEvent> = {}) =>
	({
		key: "Escape",
		repeat: false,
		defaultPrevented: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		shiftKey: false,
		...over,
	}) as KeyboardEvent;

const renderWheel = () =>
	render(
		<MemoryRouter initialEntries={["/workspaces"]}>
			<Routes>
				<Route path="/workspaces" element={<div>Workspaces page</div>} />
				<Route path="/templates" element={<div>Templates page</div>} />
				<Route path="/hud" element={<div>HUD page</div>} />
			</Routes>
			<RadialMenu />
		</MemoryRouter>,
	);

const press = () => fireEvent.keyDown(window, { key: "Escape" });

describe("escapeOpensWheel", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("opens on a plain Escape with nothing else open", () => {
		expect(escapeOpensWheel(escapeKey())).toBe(true);
		expect(escapeOpensWheel(escapeKey({ shiftKey: true }))).toBe(false);
		expect(escapeOpensWheel(escapeKey({ repeat: true }))).toBe(false);
		expect(escapeOpensWheel(escapeKey({ key: "Enter" }))).toBe(false);
	});

	it("leaves the Escape to a dialog, a menu or a field", () => {
		document.body.innerHTML = '<div role="menu"></div>';
		expect(escapeOpensWheel(escapeKey())).toBe(false);
		document.body.innerHTML = '<div role="dialog"></div>';
		expect(escapeOpensWheel(escapeKey())).toBe(false);
		document.body.innerHTML = "<input />";
		document.querySelector("input")?.focus();
		expect(escapeOpensWheel(escapeKey())).toBe(false);
		// the wheel itself, fading out, does not count
		document.body.innerHTML =
			'<div role="dialog" data-radial-menu><div role="menu"></div></div>';
		expect(escapeOpensWheel(escapeKey())).toBe(true);
	});
});

describe("RadialMenu", () => {
	beforeEach(() => {
		document.documentElement.dataset.animations = "off";
		auth.permissions = MockPermissions;
	});
	afterEach(() => {
		delete document.documentElement.dataset.animations;
	});

	it("opens on Escape, closes on Escape, and goes straight to a wedge's page", async () => {
		renderWheel();
		expect(screen.queryByTestId("radial-menu")).toBeNull();
		press();
		expect(await screen.findByTestId("radial-menu")).toBeInTheDocument();
		expect(screen.getAllByRole("menuitem")).toHaveLength(8);
		await waitFor(() =>
			expect(screen.getByTestId("radial-workspaces")).toHaveFocus(),
		);
		press();
		expect(screen.queryByTestId("radial-menu")).toBeNull();

		press();
		fireEvent.click(await screen.findByTestId("radial-templates"));
		expect(await screen.findByText("Templates page")).toBeInTheDocument();
		expect(screen.queryByTestId("radial-menu")).toBeNull();

		press();
		fireEvent.keyDown(await screen.findByTestId("radial-hud"), {
			key: "Enter",
		});
		expect(await screen.findByText("HUD page")).toBeInTheDocument();
	});

	it("says which pages are admins' to a member, and does not go there", async () => {
		auth.permissions = MockNoPermissions;
		renderWheel();
		press();
		const hud = await screen.findByTestId("radial-hud");
		expect(hud).toHaveAttribute("aria-disabled", "true");
		expect(hud).toHaveAttribute("aria-label", "HUD (Admins only)");
		fireEvent.mouseEnter(hud);
		expect(screen.getByText("Admins only")).toBeInTheDocument();
		fireEvent.click(hud);
		expect(screen.getByText("Workspaces page")).toBeInTheDocument();
		expect(screen.getByTestId("radial-menu")).toBeInTheDocument();
	});

	it("closes on a click off the wheel", async () => {
		renderWheel();
		press();
		fireEvent.click(await screen.findByTestId("radial-menu"));
		expect(screen.queryByTestId("radial-menu")).toBeNull();
	});
});
