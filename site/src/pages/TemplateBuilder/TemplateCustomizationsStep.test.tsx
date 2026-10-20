import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { MockOrganization } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { TemplateCustomizationsStep } from "./TemplateCustomizationsStep";
import {
	baseCustomizationDefaults,
	initialWizardState,
	PLATFORM_BASE_ID,
	type SelectedBaseMeta,
} from "./wizardState";

const base: SelectedBaseMeta = {
	id: PLATFORM_BASE_ID,
	name: "DEFAULT",
	hasParameters: true,
	hasPrerequisites: false,
};

const renderStep = () => {
	vi.spyOn(API, "getOrganizations").mockResolvedValue([MockOrganization]);
	vi.spyOn(API, "checkAuthorization").mockResolvedValue({
		[MockOrganization.id]: true,
	});
	vi.spyOn(API, "getProvisionerDaemonsByOrganization").mockResolvedValue([]);
	render(
		<TemplateCustomizationsStep
			state={{
				...initialWizardState,
				selectedBase: base,
				baseTemplateId: base.id,
				...baseCustomizationDefaults(base),
			}}
			onCreate={() => {}}
			onProvisionerStatusChange={() => {}}
		/>,
	);
};

describe("TemplateCustomizationsStep: the template's ID", () => {
	afterEach(() => vi.restoreAllMocks());

	it("follows the display name (never the base's ID), until it is edited itself", async () => {
		const user = userEvent.setup();
		renderStep();
		const id = await screen.findByLabelText(/^ID/);
		const displayName = screen.getByLabelText("Display name");
		expect(id).toHaveValue("default");

		await user.clear(displayName);
		await user.type(displayName, "TEST");
		await waitFor(() => expect(id).toHaveValue("test"));

		await user.clear(id);
		await user.type(id, "my-own");
		await user.type(displayName, " two");
		expect(id).toHaveValue("my-own");
	});
});
