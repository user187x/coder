import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { RequirePermission } from "./RequirePermission";

describe("RequirePermission", () => {
	it("replaces an inaccessible landing page with Workspaces", async () => {
		const restrictedPage = vi.fn(() => null);
		const RestrictedPage = restrictedPage;
		const router = createMemoryRouter(
			[
				{ path: "/login", element: null },
				{ path: "/workspaces", element: null },
				{
					path: "/deployment/users",
					element: (
						<RequirePermission isFeatureVisible={false}>
							<RestrictedPage />
						</RequirePermission>
					),
				},
			],
			{ initialEntries: ["/login", "/deployment/users"], initialIndex: 1 },
		);
		render(<RouterProvider router={router} />);

		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/workspaces"),
		);
		expect(restrictedPage).not.toHaveBeenCalled();
		await router.navigate(-1);
		expect(router.state.location.pathname).toBe("/login");
	});

	it("preserves an authorized user's intended destination", () => {
		const authorizedPage = vi.fn(() => null);
		const AuthorizedPage = authorizedPage;
		const router = createMemoryRouter(
			[
				{
					path: "/deployment/users",
					element: (
						<RequirePermission isFeatureVisible>
							<AuthorizedPage />
						</RequirePermission>
					),
				},
			],
			{ initialEntries: ["/deployment/users"] },
		);
		render(<RouterProvider router={router} />);

		expect(router.state.location.pathname).toBe("/deployment/users");
		expect(authorizedPage).toHaveBeenCalled();
	});
});
