import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { API } from "#/api/api";
import {
	previousTemplateVersion,
	templateFiles,
	templateVersionByName,
} from "#/api/queries/templates";
import type { TemplateFiles } from "#/modules/templates/TemplateFiles/TemplateFiles";
import { useTemplateLayoutContext } from "#/pages/TemplatePage/TemplateLayout";
import { MockTemplate, MockTemplateVersion } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import TemplateFilesPage from "./TemplateFilesPage";

vi.mock("#/pages/TemplatePage/TemplateLayout", () => ({
	useTemplateLayoutContext: vi.fn(),
	TemplateLayout: () => null,
}));
vi.mock("#/modules/dashboard/useDashboard", () => ({
	useDashboard: () => ({ showOrganizations: false }),
}));
vi.mock("#/modules/templates/TemplateFiles/TemplateFiles", () => ({
	TemplateFiles: ({ actions }: React.ComponentProps<typeof TemplateFiles>) => (
		<div>{actions}</div>
	),
}));
vi.mock("#/modules/templates/TemplateFiles/GlobalFiles", () => ({
	GlobalFiles: () => null,
}));
vi.mock("./UploadTemplateFiles", () => ({ UploadTemplateFiles: () => null }));

afterEach(() => vi.restoreAllMocks());

it.each([false, true])(
	"opens Developer mode for the displayed template version (historical: %s)",
	async (historical) => {
		const user = userEvent.setup();
		const version = historical
			? { ...MockTemplateVersion, id: "older-version", name: "older" }
			: MockTemplateVersion;
		vi.mocked(useTemplateLayoutContext).mockReturnValue({
			template: MockTemplate,
			activeVersion: MockTemplateVersion,
			permissions: { canUpdateTemplate: true },
		});
		vi.spyOn(API, "getTemplateVersionResources").mockResolvedValue([]);
		const client = new QueryClient({
			defaultOptions: {
				queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			},
		});
		client.setQueryData(templateFiles(version.job.file_id).queryKey, {
			"main.tf": "terraform {}",
		});
		client.setQueryData(
			previousTemplateVersion("default", MockTemplate.name, version.name)
				.queryKey,
			null,
		);
		if (historical) {
			client.setQueryData(
				templateVersionByName("default", MockTemplate.name, version.name)
					.queryKey,
				version,
			);
		}
		const router = createMemoryRouter(
			[
				{ path: "/templates/:template/files", element: <TemplateFilesPage /> },
				{ path: "/templates/:template/versions/:version/edit", element: null },
			],
			{
				initialEntries: [
					`/templates/${MockTemplate.name}/files${historical ? `?version=${version.name}` : ""}`,
				],
			},
		);
		renderComponent(
			<QueryClientProvider client={client}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		);
		await user.click(
			await screen.findByRole("link", { name: "Developer mode" }),
		);
		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				`/templates/${MockTemplate.name}/versions/${version.name}/edit`,
			),
		);
		client.clear();
	},
);
