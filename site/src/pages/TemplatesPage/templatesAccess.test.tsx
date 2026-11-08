import { screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { RequireTemplatesAccess } from "./templatesAccess";

const auth = vi.hoisted(() => ({ createTemplates: false }));
vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => ({
		permissions: {
			createTemplates: auth.createTemplates,
			updateTemplates: false,
		},
	}),
}));

const open = (path: string) =>
	renderWithRouter(
		createMemoryRouter(
			[
				{
					path: "/templates/:template",
					children: [
						{
							element: <RequireTemplatesAccess fallback="workspace" />,
							children: [
								{ path: "settings", element: <p>Template settings</p> },
							],
						},
						{ path: "workspace", element: <p>New workspace</p> },
					],
				},
			],
			{ initialEntries: [path] },
		),
	);

afterEach(() => {
	auth.createTemplates = false;
});

it("sends a member from a template's pages to creating a workspace from it", async () => {
	const { router } = open("/templates/docker/settings");
	expect(await screen.findByText("New workspace")).toHaveTextContent(
		"New workspace",
	);
	expect(router.state.location.pathname).toBe("/templates/docker/workspace");
});

it("lets a template maker open a template's pages", async () => {
	auth.createTemplates = true;
	const { router } = open("/templates/docker/settings");
	expect(await screen.findByText("Template settings")).toHaveTextContent(
		"Template settings",
	);
	expect(router.state.location.pathname).toBe("/templates/docker/settings");
});
