import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import {
	MockTemplate,
	MockTemplateVersion,
	MockTemplateVersion2,
} from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { VersionsSidebar } from "./VersionsSidebar";

const renderSidebar = (canUpdate: boolean) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<VersionsSidebar
				template={{
					...MockTemplate,
					active_version_id: MockTemplateVersion.id,
				}}
				canUpdate={canUpdate}
				shownVersionName={MockTemplateVersion.name}
				onSelect={() => {}}
			/>
		</QueryClientProvider>,
	);

describe("VersionsSidebar", () => {
	afterEach(() => vi.restoreAllMocks());

	it("deletes a version that is not the active one, after asking", async () => {
		vi.spyOn(API, "getTemplateVersions").mockResolvedValue([
			MockTemplateVersion,
			MockTemplateVersion2,
		]);
		const del = vi.spyOn(API, "deleteTemplateVersion").mockResolvedValue();
		renderSidebar(true);
		const other = await screen.findByTestId(
			`sidebar-version-${MockTemplateVersion2.name}`,
		);
		const active = screen.getByTestId(
			`sidebar-version-${MockTemplateVersion.name}`,
		);
		expect(within(active).queryByTestId("delete-version")).toBeNull();
		fireEvent.click(within(other).getByTestId("delete-version"));
		fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
		await waitFor(() =>
			expect(del).toHaveBeenCalledWith(MockTemplateVersion2.id),
		);
	});

	it("offers no delete to those who may not update the template", async () => {
		vi.spyOn(API, "getTemplateVersions").mockResolvedValue([
			MockTemplateVersion,
			MockTemplateVersion2,
		]);
		renderSidebar(false);
		await screen.findByTestId(`sidebar-version-${MockTemplateVersion2.name}`);
		expect(screen.queryByTestId("delete-version")).toBeNull();
	});
});
