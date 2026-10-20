import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { MockTemplate, MockTemplateVersion } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { TemplateParametersCard } from "./TemplateParametersCard";

describe("TemplateParametersCard", () => {
	beforeEach(() => {
		vi.spyOn(API, "getTemplateVersion").mockResolvedValue(MockTemplateVersion);
	});
	afterEach(() => vi.restoreAllMocks());

	it("shows dynamic parameters on, with no deprecation warning, for a template that uses them", async () => {
		const update = vi
			.spyOn(API, "updateTemplateMeta")
			.mockResolvedValue({ ...MockTemplate, use_classic_parameter_flow: true });
		renderWithAuth(
			<TemplateParametersCard
				template={{ ...MockTemplate, use_classic_parameter_flow: false }}
				canUpdate
			/>,
		);
		const toggle = await screen.findByTestId(
			"switch-use_classic_parameter_flow",
		);
		expect(toggle).toHaveAttribute("aria-pressed", "true");
		expect(toggle).toHaveAccessibleName("Dynamic parameters");
		expect(screen.queryByText(/deprecated/i)).not.toBeInTheDocument();

		// turning them off is turning compatibility mode on
		await userEvent.click(toggle);
		await waitFor(() =>
			expect(update).toHaveBeenCalledWith(MockTemplate.id, {
				use_classic_parameter_flow: true,
			}),
		);
	});

	it("warns only when the template uses the deprecated compatibility mode", async () => {
		const update = vi
			.spyOn(API, "updateTemplateMeta")
			.mockResolvedValue({
				...MockTemplate,
				use_classic_parameter_flow: false,
			});
		renderWithAuth(
			<TemplateParametersCard
				template={{ ...MockTemplate, use_classic_parameter_flow: true }}
				canUpdate
			/>,
		);
		const toggle = await screen.findByTestId(
			"switch-use_classic_parameter_flow",
		);
		expect(toggle).toHaveAttribute("aria-pressed", "false");
		expect(
			screen.getByText("Compatibility mode (deprecated)"),
		).toBeInTheDocument();
		expect(
			screen.getByText(/uses parameter compatibility mode/),
		).toBeInTheDocument();

		await userEvent.click(toggle);
		await waitFor(() =>
			expect(update).toHaveBeenCalledWith(MockTemplate.id, {
				use_classic_parameter_flow: false,
			}),
		);
	});
});
