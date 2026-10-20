import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { PlatformAPI } from "#/api/platform";
import { MockNoPermissions, MockPermissions } from "#/testHelpers/entities";
import { escapeOpensWheel, popupOpen, RadialMenu } from "./RadialMenu";

const auth = { permissions: MockPermissions };
vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => auth,
}));

const escapeKey = (over: Partial<KeyboardEvent> = {}) =>
	({
		key: "Escape",
		repeat: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		shiftKey: false,
		...over,
	}) as KeyboardEvent;

const renderWheel = () =>
	render(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter initialEntries={["/workspaces"]}>
				<Routes>
					<Route path="/workspaces" element={<div>Workspaces page</div>} />
					<Route path="/templates" element={<div>Templates page</div>} />
					<Route path="/hud" element={<div>HUD page</div>} />
				</Routes>
				<RadialMenu />
			</MemoryRouter>
		</QueryClientProvider>,
	);

const press = () => fireEvent.keyDown(window, { key: "Escape" });

describe("escapeOpensWheel", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});
	// jsdom lays nothing out: an element counts as shown when it has boxes
	const shown = (html: string) => {
		document.body.innerHTML = html;
		for (const el of document.body.querySelectorAll("*")) {
			(el as HTMLElement).getClientRects = () => [{}] as unknown as DOMRectList;
		}
	};

	it("opens on Escape always: a field focused, a menu or dialog open", () => {
		expect(escapeOpensWheel(escapeKey())).toBe(true);
		expect(escapeOpensWheel(escapeKey({ shiftKey: true }))).toBe(true);
		expect(escapeOpensWheel(escapeKey({ repeat: true }))).toBe(false);
		expect(escapeOpensWheel(escapeKey({ ctrlKey: true }))).toBe(false);
		expect(escapeOpensWheel(escapeKey({ key: "Enter" }))).toBe(false);
		shown(
			'<input /><div role="dialog" data-state="open"></div><div data-radix-popper-content-wrapper><div role="menu"></div></div>',
		);
		document.querySelector("input")?.focus();
		expect(escapeOpensWheel(escapeKey())).toBe(true);
	});

	it("leaves a terminal its Escape (vim, less); Shift+Escape opens it there", () => {
		shown('<div class="xterm"><textarea></textarea></div>');
		document.querySelector("textarea")?.focus();
		expect(escapeOpensWheel(escapeKey())).toBe(false);
		expect(escapeOpensWheel(escapeKey({ shiftKey: true }))).toBe(true);
		// Ghostty's terminal, in the dashboard's terminal
		shown('<div class="workspace-terminal"><textarea></textarea></div>');
		document.querySelector("textarea")?.focus();
		expect(escapeOpensWheel(escapeKey())).toBe(false);
	});
});

describe("popupOpen", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});
	const shown = (html: string) => {
		document.body.innerHTML = html;
		for (const el of document.body.querySelectorAll("*")) {
			(el as HTMLElement).getClientRects = () => [{}] as unknown as DOMRectList;
		}
	};

	it("sees a menu, dialog or popover open over the page (they close on the same Escape)", () => {
		for (const html of [
			'<div data-radix-popper-content-wrapper><div role="menu"></div></div>',
			'<div role="dialog" data-state="open"></div>',
			'<div role="alertdialog"></div>',
		]) {
			shown(html);
			expect(popupOpen()).toBe(true);
		}
	});

	it("does not count what is simply on the page, a tooltip, or the wheel", () => {
		shown(
			'<div role="listbox"></div><div role="menu"></div><div role="dialog" aria-label="Chat with greg"></div><input role="combobox" aria-expanded="true" cmdk-input />',
		);
		expect(popupOpen()).toBe(false);
		shown(
			'<div data-radix-popper-content-wrapper><div role="tooltip">Hi</div></div>',
		);
		expect(popupOpen()).toBe(false);
		shown('<div role="dialog" aria-modal="true" data-radial-menu></div>');
		expect(popupOpen()).toBe(false);
	});
});

describe("RadialMenu", () => {
	beforeEach(() => {
		document.documentElement.dataset.animations = "off";
		auth.permissions = MockPermissions;
		// no wedges arranged: the default wheel
		vi.spyOn(PlatformAPI, "getQuickMenu").mockResolvedValue({
			items: null,
			wedges: [3, 12],
		});
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

	it("shows the wedge pointed at in the hub: its icon above its name, centred", async () => {
		renderWheel();
		press();
		// the hub's icon is the pointed-at wedge's (a new element per icon)
		const hub = () => screen.getByTestId("radial-center-icon");
		await waitFor(() =>
			expect(hub()).toHaveAttribute("data-wedge", "workspaces"),
		);
		fireEvent.mouseEnter(screen.getByTestId("radial-templates"));
		expect(hub()).toHaveAttribute("data-wedge", "templates");
		expect(hub()).toHaveAttribute("aria-hidden", "true");
		expect(hub().tagName.toLowerCase()).toBe("svg");
		const center = hub().parentElement as HTMLElement;
		expect(center).toHaveClass("radial-center");
		expect(center.firstElementChild).toBe(hub());
		expect(center.querySelector(".radial-center-name")).toHaveTextContent(
			"Templates",
		);
		// nothing pointed at: the wheel's own icon and "Menu"
		fireEvent.mouseLeave(screen.getByTestId("radial-templates"));
		fireEvent.blur(screen.getByTestId("radial-workspaces"));
		await waitFor(() => expect(hub()).toHaveAttribute("data-wedge", ""));
		expect(
			screen
				.getByTestId("radial-center-icon")
				.parentElement?.querySelector(".radial-center-name"),
		).toHaveTextContent("Menu");
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

	it("has the wedges admins arranged (Admin Settings > Quick Menu)", async () => {
		vi.spyOn(PlatformAPI, "getQuickMenu").mockResolvedValue({
			items: ["security", "images", "health"],
			wedges: [3, 12],
		});
		renderWheel();
		await waitFor(() => expect(PlatformAPI.getQuickMenu).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		press();
		await screen.findByTestId("radial-menu");
		await waitFor(() =>
			expect(
				screen
					.getAllByRole("menuitem")
					.map((m) => m.getAttribute("data-testid")),
			).toEqual(["radial-security", "radial-images", "radial-health"]),
		);
	});

	it("closes on a click off the wheel", async () => {
		renderWheel();
		press();
		fireEvent.click(await screen.findByTestId("radial-menu"));
		expect(screen.queryByTestId("radial-menu")).toBeNull();
	});
});
