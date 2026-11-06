import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Link, Outlet } from "react-router";
import { AnnouncementBanner } from "#/modules/platform/announcement/AnnouncementBanner";
import { MockBanner } from "#/testHelpers/platform";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import DeploymentSettingsLayout from "./DeploymentSettingsLayout";

it("hides and restores the category links without resetting the current page", async () => {
	const user = userEvent.setup();
	renderWithAuth(<DeploymentSettingsLayout />, {
		path: "/deployment",
		route: "/deployment/users",
		children: [
			{ path: "users", element: <input aria-label="Account search" /> },
		],
	});
	const search = await screen.findByRole("textbox", { name: "Account search" });
	await user.type(search, "demo");
	const category = screen.getByRole("button", { name: "Accounts" });
	await user.click(screen.getByTitle("Hide categories"));
	await user.click(screen.getByTitle("Show categories"));
	await user.click(category);
	expect(category).toHaveAttribute("aria-expanded", "true");
	await user.dblClick(category);
	expect(screen.queryByRole("link", { name: "Accounts" })).toBeNull();
	const toggle = screen.getByRole("button", { name: "Accounts" });
	expect(toggle).toHaveFocus();
	await user.keyboard("{Enter}");
	expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute(
		"href",
		"/deployment/users",
	);
	expect(search).toHaveValue("demo");
});

describe("section introductions", () => {
	class SilentWebSocket {
		close() {}
	}

	const renderSections = (introductions: boolean) => {
		server.use(
			http.get("/__banner/banner.json", () =>
				HttpResponse.json({ ...MockBanner, introductions }),
			),
		);
		return renderWithAuth(<DeploymentSettingsLayout />, {
			path: "/deployment",
			route: "/deployment/users",
			children: [
				{
					element: (
						<>
							<AnnouncementBanner placement="navbar" />
							<Outlet />
						</>
					),
					children: [
						{
							path: "users",
							element: <Link to="/deployment/customize?tab=1">Go</Link>,
						},
						{
							path: "customize",
							element: <Link to="/deployment/customize?tab=2">Stay</Link>,
						},
					],
				},
			],
		});
	};

	beforeEach(() => {
		localStorage.clear();
		vi.stubGlobal("WebSocket", SilentWebSocket);
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("names the new section for 2 seconds, once per change of section", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderSections(true);
		const splash = await screen.findByTestId("section-splash");
		expect(splash).toHaveTextContent("");
		await user.click(await screen.findByRole("link", { name: "Go" }));
		await waitFor(() => expect(splash).toHaveTextContent("Appearance"));
		await act(() => vi.advanceTimersByTimeAsync(1900));
		expect(splash).toHaveTextContent("Appearance");
		await act(() => vi.advanceTimersByTimeAsync(200));
		expect(splash).toHaveTextContent("");
		// Same section, new query string: no splash.
		await user.click(screen.getByRole("link", { name: "Stay" }));
		expect(splash).toHaveTextContent("");
	});

	it("shows no splash when the setting is off", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderSections(false);
		await screen.findByText("Scheduled maintenance:", { exact: false });
		await user.click(await screen.findByRole("link", { name: "Go" }));
		await screen.findByRole("link", { name: "Stay" });
		expect(screen.queryByTestId("section-splash")).toBeNull();
	});
});
