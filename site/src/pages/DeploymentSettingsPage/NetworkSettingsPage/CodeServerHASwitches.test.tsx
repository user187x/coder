import { fireEvent, screen, waitFor } from "@testing-library/react";
import { API } from "#/api/api";
import type { TemplateVersion } from "#/api/typesGenerated";
import {
	MockTemplate,
	MockTemplateVersion,
	MockTemplateVersionVariable1,
} from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { CodeServerHASwitches } from "./CodeServerHASwitches";

describe("CodeServerHASwitches", () => {
	const variables = [
		{ ...MockTemplateVersionVariable1, name: "code_server_ha", value: "false" },
		{ ...MockTemplateVersionVariable1, name: "namespace", value: "coder" },
	];

	it("switches a template's code-server HA on: a new version with the variable changed, made active", async () => {
		vi.spyOn(API, "getTemplates").mockResolvedValue([MockTemplate]);
		vi.spyOn(API, "getTemplateVersionVariables").mockResolvedValue(variables);
		vi.spyOn(API, "getTemplateVersion").mockImplementation(
			async (id) =>
				({
					...MockTemplateVersion,
					id,
					job: {
						...MockTemplateVersion.job,
						file_id: "file-1",
						status: "succeeded",
					},
				}) as TemplateVersion,
		);
		const create = vi.spyOn(API, "createTemplateVersion").mockResolvedValue({
			...MockTemplateVersion,
			id: "new-version",
			job: { ...MockTemplateVersion.job, status: "succeeded" },
		});
		const promote = vi
			.spyOn(API, "updateActiveTemplateVersion")
			.mockResolvedValue({ message: "ok" });

		renderWithAuth(<CodeServerHASwitches />);
		const sw = await screen.findByTestId(
			`ha-template-switch-${MockTemplate.name}`,
		);
		expect(sw).toHaveAttribute("aria-checked", "false");
		fireEvent.click(sw);
		await waitFor(() =>
			expect(promote).toHaveBeenCalledWith(MockTemplate.id, {
				id: "new-version",
			}),
		);
		expect(create).toHaveBeenCalledWith(
			MockTemplate.organization_id,
			expect.objectContaining({
				template_id: MockTemplate.id,
				file_id: "file-1",
				user_variable_values: [
					{ name: "code_server_ha", value: "true" },
					{ name: "namespace", value: "coder" },
				],
			}),
		);
	});

	it("lists only templates that have the variable", async () => {
		vi.spyOn(API, "getTemplates").mockResolvedValue([MockTemplate]);
		vi.spyOn(API, "getTemplateVersionVariables").mockResolvedValue([
			{ ...MockTemplateVersionVariable1, name: "namespace", value: "coder" },
		]);
		renderWithAuth(<CodeServerHASwitches />);
		expect(
			await screen.findByText(/No template here has code-server HA/),
		).toBeVisible();
	});
});
