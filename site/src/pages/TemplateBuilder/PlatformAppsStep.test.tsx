import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { PlatformAppsStep } from "./PlatformAppsStep";

const renderStep = (canRename: boolean, onRenamed = vi.fn()) => {
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<PlatformAppsStep
				name="UBUNTU"
				iconUrl="/icon/ubuntu.svg"
				values={{}}
				onChangeValues={() => {}}
				templateId="7dd1d090-3e23-4ada-8894-3945affcad42"
				canRename={canRename}
				onRenamed={onRenamed}
			/>
		</QueryClientProvider>,
	);
	return onRenamed;
};

describe("PlatformAppsStep", () => {
	afterEach(() => vi.restoreAllMocks());

	it("lets an admin rename the base template (its display name)", async () => {
		const update = vi
			.spyOn(API, "updateTemplateMeta")
			.mockResolvedValue({} as never);
		const renamed = renderStep(true);
		fireEvent.click(screen.getByTestId("platform-base-rename"));
		const input = screen.getByTestId("platform-base-name-input");
		fireEvent.change(input, { target: { value: "  Workstation " } });
		fireEvent.click(screen.getByTestId("platform-base-rename-save"));
		await waitFor(() =>
			expect(update).toHaveBeenCalledWith(
				"7dd1d090-3e23-4ada-8894-3945affcad42",
				{ display_name: "Workstation" },
			),
		);
		await waitFor(() => expect(renamed).toHaveBeenCalledWith("Workstation"));
	});

	it("shows no Rename to others", () => {
		renderStep(false);
		expect(screen.getByTestId("platform-base-name")).toHaveTextContent(
			"UBUNTU",
		);
		expect(screen.queryByTestId("platform-base-rename")).toBeNull();
	});
});
