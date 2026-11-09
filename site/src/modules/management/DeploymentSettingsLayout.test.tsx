import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Link, Outlet } from "react-router";
import type { Banner } from "#/api/platform";
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
	await user.click(screen.getByTitle("Hide categories"));
	await user.click(screen.getByTitle("Show categories"));
	// The breadcrumb moved back into the list's header: the toggle there kept the focus.
	const category = screen.getByRole("button", { name: "Accounts" });
	expect(category).toHaveFocus();
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

	const renderSections = (
		introductions: boolean,
		look: Partial<Banner> = {},
	) => {
		server.use(
			http.get("/__banner/banner.json", () =>
				HttpResponse.json({ ...MockBanner, introductions, ...look }),
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

	it("keeps the splash for the configured duration", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderSections(true, { introDurationMs: 6000 });
		const splash = await screen.findByTestId("section-splash");
		await user.click(await screen.findByRole("link", { name: "Go" }));
		await waitFor(() => expect(splash).toHaveTextContent("Appearance"));
		await act(() => vi.advanceTimersByTimeAsync(5800));
		expect(splash).toHaveTextContent("Appearance");
		await act(() => vi.advanceTimersByTimeAsync(400));
		expect(splash).toHaveTextContent("");
	});

	it("renders the splash with the chosen effect, size and weight", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderSections(true, {
			introEffect: "pewpew",
			introSize: "xlarge",
			introWeight: "black",
		});
		const splash = await screen.findByTestId("section-splash");
		await user.click(await screen.findByRole("link", { name: "Go" }));
		await waitFor(() => expect(splash).toHaveTextContent("Appearance"));
		expect(within(splash).getByTestId("section-splash-pill")).toHaveAttribute(
			"data-intro-effect",
			"pewpew",
		);
	});

	it("names the section when the page mounts a settings layout of its own", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		server.use(
			http.get("/__banner/banner.json", () =>
				HttpResponse.json({ ...MockBanner, introductions: true }),
			),
		);
		renderWithAuth(
			<>
				<AnnouncementBanner placement="navbar" />
				<Outlet />
			</>,
			{
				path: "/",
				route: "/deployment/users",
				children: [
					{
						path: "deployment",
						element: <DeploymentSettingsLayout />,
						children: [
							{
								path: "users",
								element: <Link to="/templates">Open the list</Link>,
							},
						],
					},
					{
						// As in the router: a level deeper than the deployment pages, so its layout is a new one.
						path: "templates",
						children: [
							{
								element: <DeploymentSettingsLayout />,
								children: [{ index: true, element: <h1>Templates list</h1> }],
							},
						],
					},
				],
			},
		);
		const splash = await screen.findByTestId("section-splash");
		await user.click(
			await screen.findByRole("link", { name: "Open the list" }),
		);
		await screen.findByRole("heading", { name: "Templates list" });
		await waitFor(() => expect(splash).toHaveTextContent("Templates"));
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
