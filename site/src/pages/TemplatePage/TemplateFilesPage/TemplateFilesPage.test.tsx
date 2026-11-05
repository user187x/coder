import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppProviders } from "#/App";
import { RequireAuth } from "#/contexts/auth/RequireAuth";
import { MockTemplate, MockTemplateVersion } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import { TemplateLayout } from "../TemplateLayout";
import { TemplatePageHeader } from "../TemplatePageHeader";
import TemplateFilesPage from "./TemplateFilesPage";

// Occasionally, Jest encounters HTML5 canvas errors. As the SyntaxHighlight is
// not required for these tests, we can safely mock it.
vi.mock("#/components/SyntaxHighlighter/SyntaxHighlighter", () => ({
	SyntaxHighlighter: () => <div data-testid="syntax-highlighter" />,
}));

test("displays the template files even when there is no previous version", async () => {
	server.use(
		http.get(
			"/api/v2/organizations/:organizationId/templates/:template/versions/:version/previous",
			() => {
				new HttpResponse(null, { status: 404 });
			},
		),
	);

	render(
		<AppProviders>
			<RouterProvider
				router={createMemoryRouter(
					[
						{
							element: <RequireAuth />,
							children: [
								{
									element: <TemplateLayout />,
									children: [
										{
											path: "/templates/:template/files",
											element: <TemplateFilesPage />,
										},
									],
								},
							],
						},
					],
					{
						initialEntries: [`/templates/${MockTemplate.name}/files`],
					},
				)}
			/>
		</AppProviders>,
	);

	await screen.findByTestId("syntax-highlighter");
});

test.each([
	["Create Workspace", (name: string) => `/templates/${name}/workspace`],
	["Settings", (name: string) => `/templates/${name}/settings`],
	[
		"Edit files",
		(name: string) =>
			`/templates/${name}/versions/${MockTemplateVersion.name}/edit`,
	],
	["Duplicate…", () => `/templates/new?fromTemplate=${MockTemplate.id}`],
])("template action navigates to %s", async (label, destination) => {
	const user = userEvent.setup();
	const { router } = renderWithAuth(
		<TemplatePageHeader
			template={MockTemplate}
			activeVersion={MockTemplateVersion}
			permissions={{ canUpdateTemplate: true }}
			workspacePermissions={{ createWorkspaceForUserID: true }}
			onDeleteTemplate={vi.fn()}
		/>,
		{ extraRoutes: [{ path: "/templates/*", element: <div /> }] },
	);
	await user.click(await screen.findByRole("button", { name: "Workspace" }));
	await user.click(screen.getByRole("menuitem", { name: label }));
	await waitFor(() =>
		expect(router.state.location.pathname + router.state.location.search).toBe(
			destination(MockTemplate.name),
		),
	);
});
