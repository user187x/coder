import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockWorkspace } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { WorkspaceQuarantineCardView } from "./WorkspaceQuarantine";

it("selects the explicit workspace for review before any quarantine action", async () => {
	const user = userEvent.setup();
	const onSelect = vi.fn();
	render(
		<WorkspaceQuarantineCardView
			workspaces={[MockWorkspace]}
			selected=""
			onSelect={onSelect}
			onRetry={vi.fn()}
		/>,
	);
	await user.click(
		screen.getByRole("combobox", { name: "Workspace to review" }),
	);
	await user.click(
		screen.getByRole("option", {
			name: `${MockWorkspace.owner_name}/${MockWorkspace.name}`,
		}),
	);
	expect(onSelect).toHaveBeenCalledExactlyOnceWith(MockWorkspace.id);
});
