import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { platformRequest } from "#/api/platform";
import { MockDefaultOrganization } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { CreateNode } from "./CreateNode";

vi.mock("#/modules/dashboard/useDashboard", () => ({
	useDashboard: () => ({ organizations: [MockDefaultOrganization] }),
}));

it("requests one worker in the selected organization only after confirmation", async () => {
	const user = userEvent.setup();
	vi.spyOn(platformRequest, "get").mockResolvedValue({
		online: true,
		profiles: [{ id: "local", label: "Local workers", kind: "k3d" }],
		operation: null,
	});
	const post = vi
		.spyOn(platformRequest, "post")
		.mockResolvedValue({ phase: "queued" });
	render(<CreateNode />);
	await user.click(await screen.findByRole("button", { name: "Create node" }));
	await screen.findByRole("option", { name: "Local workers" });
	expect(post).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Create one node" }));
	expect(post).toHaveBeenCalledWith(
		`/__coder-ui/api/organizations/${MockDefaultOrganization.id}/node-provisioning`,
		{
			profile: "local",
			previous: null,
			id: expect.stringMatching(/^[0-9a-f-]{36}$/),
		},
	);
});
