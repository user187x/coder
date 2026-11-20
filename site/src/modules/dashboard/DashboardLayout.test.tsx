import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http, type PathParams } from "msw";
import type { RouteObject } from "react-router";
import { PlatformAPI } from "#/api/platform";
import type { AuthorizationRequest, Entitlements } from "#/api/typesGenerated";
import { MockBackgrounds } from "#/testHelpers/appearance";
import {
	MockDefaultOrganization,
	MockEntitlements,
	MockNoPermissions,
	MockPermissions,
} from "#/testHelpers/entities";
import {
	renderWithAuth,
	waitForLoaderToBeRemoved,
} from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import { DashboardLayout } from "./DashboardLayout";

const renderDashboardLayout = async ({
	actual,
	entitlement = "entitled",
	features,
	limit,
	permissions = MockPermissions,
	organizationChecks = false,
	warnings,
	children = [{ element: <h1>Test page</h1> }],
}: {
	actual?: number;
	entitlement?: "entitled" | "grace_period" | "not_entitled";
	features?: Partial<Entitlements["features"]>;
	limit?: number;
	permissions?: typeof MockPermissions;
	/** Answer for authorization checks keyed by organization id. */
	organizationChecks?: boolean;
	warnings?: string[];
	children?: RouteObject[];
}) => {
	server.use(
		http.get("/api/v2/entitlements", () => {
			return HttpResponse.json({
				...MockEntitlements,
				warnings: warnings ?? MockEntitlements.warnings,
				has_license: true,
				refreshed_at: new Date().toISOString(),
				features: {
					...MockEntitlements.features,
					ai_governance_user_limit: {
						entitlement,
						enabled: true,
						...(actual !== undefined ? { actual } : {}),
						...(limit !== undefined ? { limit } : {}),
					},
					...features,
				},
			});
		}),
		// The inbox request fires once the permission queries settle and has no
		// default handler.
		http.get("/api/v2/notifications/inbox", () => {
			return HttpResponse.json({ notifications: [], unread_count: 0 });
		}),
		http.post<PathParams, AuthorizationRequest>(
			"/api/v2/authcheck",
			async ({ request }) => {
				const { checks } = await request.json();
				return HttpResponse.json(
					MockDefaultOrganization.id in checks
						? Object.fromEntries(
								Object.keys(checks).map((id) => [id, organizationChecks]),
							)
						: permissions,
				);
			},
		),
	);

	const result = renderWithAuth(<DashboardLayout />, { children });
	await waitForLoaderToBeRemoved();
	return result;
};

test("Show the new Coder version notification", async () => {
	server.use(
		http.get("/api/v2/updatecheck", () => {
			return HttpResponse.json({
				current: false,
				version: "v0.12.9",
				url: "https://github.com/coder/coder/releases/tag/v0.12.9",
			});
		}),
	);
	renderWithAuth(<DashboardLayout />, {
		children: [{ element: <h1>Test page</h1> }],
	});
	await userEvent
		.setup()
		.click(await screen.findByRole("button", { name: "Dismiss" }));
	expect(localStorage.getItem("dismissedVersion")).toBe("v0.12.9");
});

test("hides AI Governance seat warnings for non-admin users", async () => {
	await renderDashboardLayout({
		actual: 110,
		limit: 100,
		permissions: MockNoPermissions,
	});

	expect(
		screen.queryByText(/AI Governance add-on seats/),
	).not.toBeInTheDocument();
});

test("shows AI Governance over-limit warning in LicenseBanner for admin users", async () => {
	await renderDashboardLayout({
		actual: 110,
		limit: 100,
		permissions: MockPermissions,
	});

	expect(
		screen.getByText(
			/110 of 100 AI Governance add-on seats \(10 over the limit\)/,
		),
	).toBeInTheDocument();
});

test("renders a skip link before navigation content", async () => {
	renderWithAuth(<DashboardLayout />, {
		children: [{ element: <h1>Test page</h1> }],
	});
	await waitForLoaderToBeRemoved();

	const skipToContentLink = screen.getByRole("link", {
		name: "Skip to main content",
	});
	const navigation = screen.getAllByRole("navigation")[0];
	const mainContent = document.getElementById("main-content");

	expect(skipToContentLink).toHaveAttribute("href", "#main-content");
	expect(mainContent).toHaveAttribute("tabindex", "-1");
	expect(
		skipToContentLink.compareDocumentPosition(navigation) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
});

test("moves focus to main content when skip link is clicked", async () => {
	renderWithAuth(<DashboardLayout />, {
		children: [{ element: <h1>Test page</h1> }],
	});
	await waitForLoaderToBeRemoved();

	const user = userEvent.setup();
	const skipToContentLink = screen.getByRole("link", {
		name: "Skip to main content",
	});
	const mainContent = document.getElementById("main-content");

	expect(mainContent).not.toBeNull();
	await user.click(skipToContentLink);
	expect(mainContent).toHaveFocus();
});

test("opens the shared background editor from exposed dashboard space", async () => {
	const getBackgrounds = vi
		.spyOn(PlatformAPI, "getBackgrounds")
		.mockResolvedValue(MockBackgrounds);
	const save = vi
		.spyOn(PlatformAPI, "saveBackground")
		.mockResolvedValue({ ok: true, set: true });
	const componentMenu = vi.fn();
	const user = userEvent.setup();
	await renderDashboardLayout({
		children: [
			{
				index: true,
				element: (
					<section aria-label="Workspace card" onContextMenu={componentMenu}>
						<div
							data-dashboard-background=""
							role="group"
							aria-label="Card body"
						/>
					</section>
				),
			},
		],
	});
	const cardBody = await screen.findByRole("group", { name: "Card body" });
	const nativeMenu = vi.fn((event: MouseEvent) => event.defaultPrevented);
	window.addEventListener("contextmenu", nativeMenu, { once: true });
	await user.pointer({
		target: cardBody,
		keys: "[MouseRight]",
	});
	expect(componentMenu).toHaveBeenCalledOnce();
	expect(nativeMenu).toHaveReturnedWith(false);
	expect(getBackgrounds).not.toHaveBeenCalled();

	await user.pointer({
		target: screen.getByRole("main"),
		keys: "[MouseRight]",
	});
	await user.click(
		await screen.findByRole("menuitem", { name: "Change background image" }),
	);
	const editor = within(
		await screen.findByRole("dialog", { name: "Change background image" }),
	);
	await user.selectOptions(
		await editor.findByRole("combobox", { name: "Fit" }),
		"span",
	);
	await user.click(editor.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledExactlyOnceWith(
			"dashboard",
			expect.objectContaining({ fit: "span" }),
		),
	);
});

test("keeps the browser context menu for members without deployment edit access", async () => {
	const user = userEvent.setup();
	await renderDashboardLayout({ permissions: MockNoPermissions });
	const nativeMenu = vi.fn((event: MouseEvent) => event.defaultPrevented);
	window.addEventListener("contextmenu", nativeMenu, { once: true });
	await user.pointer({
		target: screen.getByRole("main"),
		keys: "[MouseRight]",
	});
	expect(nativeMenu).toHaveReturnedWith(false);
});

test("opens the background menu from main content with Shift+F10", async () => {
	const user = userEvent.setup();
	await renderDashboardLayout({});
	const main = screen.getByRole("main");
	await user.click(screen.getByRole("link", { name: "Skip to main content" }));
	await user.keyboard("{Shift>}{F10}{/Shift}");
	await user.keyboard("{ArrowDown}");
	const change = await screen.findByRole("menuitem", {
		name: "Change background image",
	});
	expect(change).toHaveFocus();
	await user.keyboard("{Escape}");
	await waitFor(() => expect(main).toHaveFocus());
});
