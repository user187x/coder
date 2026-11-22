import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { MockStoppedWorkspace, MockWorkspace } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import {
	WorkspaceLatencies,
	workspaceLatencyPageSize,
} from "./LatencyConnections";

it("loads workspaces from the next page across accounts", async () => {
	const getWorkspaces = vi
		.spyOn(API, "getWorkspaces")
		.mockResolvedValueOnce({ workspaces: [MockWorkspace], count: 25 })
		.mockResolvedValueOnce({ workspaces: [MockStoppedWorkspace], count: 25 });
	render(<WorkspaceLatencies />);
	const cards = screen.getByRole("region", { name: "Workspace latency" });
	await userEvent.click(
		await within(cards).findByRole("button", { name: "Next page" }),
	);
	expect(getWorkspaces).toHaveBeenLastCalledWith({
		limit: workspaceLatencyPageSize,
		offset: workspaceLatencyPageSize,
	});
	const workspace = await within(cards).findByRole("link", {
		name: MockStoppedWorkspace.name,
	});
	expect(workspace).toHaveAttribute(
		"href",
		`/@${MockStoppedWorkspace.owner_name}/${MockStoppedWorkspace.name}`,
	);
	getWorkspaces.mockRestore();
});
