import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "#/testHelpers/renderHelpers";
import { MockResearchSandbox } from "#/testHelpers/researchSandbox";
import { ResearchSandboxButton } from "./ResearchSandboxButton";

it("opens workspace setup with the research image and guest resources", async () => {
	const user = userEvent.setup();
	const { router } = render(
		<ResearchSandboxButton sandbox={MockResearchSandbox} />,
	);
	await user.click(
		screen.getByRole("button", { name: "Deploy research sandbox" }),
	);
	await user.click(
		screen.getByRole("button", { name: "Continue to workspace setup" }),
	);
	expect(router.state.location.pathname).toBe("/templates/default/workspace");
	expect(
		Object.fromEntries(new URLSearchParams(router.state.location.search)),
	).toEqual({
		name: "research-sandbox",
		"param.workspace_image": "custom",
		"param.workspace_image_custom": MockResearchSandbox.image,
		"param.cpu": "2",
		"param.memory": "4",
	});
});

it("does not navigate without a configured research image", async () => {
	const user = userEvent.setup();
	const { router } = render(<ResearchSandboxButton sandbox={null} />);
	const before = router.state.location;
	await user.click(
		screen.getByRole("button", { name: "Deploy research sandbox" }),
	);
	await user.click(
		screen.getByRole("button", { name: "Continue to workspace setup" }),
	);
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(router.state.location).toEqual(before);
});
