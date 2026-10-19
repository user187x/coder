import { screen } from "@testing-library/react";
import { API } from "#/api/api";
import { MockFailedWorkspace, MockWorkspace } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import WorkspaceHealthPage from "./WorkspaceHealthPage";

const withWorkspaces = (workspaces: (typeof MockWorkspace)[]) =>
	vi
		.spyOn(API, "getWorkspaces")
		.mockResolvedValue({ workspaces, count: workspaces.length });

describe("WorkspaceHealthPage", () => {
	afterEach(() => vi.restoreAllMocks());

	it("says it in one line when nothing needs triage, without an empty table", async () => {
		withWorkspaces([MockWorkspace]);
		render(<WorkspaceHealthPage />);
		expect(
			await screen.findByTestId("workspace-health-clear"),
		).toHaveTextContent("Nothing to triage");
		expect(
			screen.queryByRole("table", { name: "Unhealthy or failed workspaces" }),
		).toBeNull();
		expect(screen.queryByText(/Select a workspace/)).toBeNull();
	});

	it("lists the workspaces that need attention", async () => {
		withWorkspaces([MockWorkspace, MockFailedWorkspace]);
		render(<WorkspaceHealthPage />);
		expect(
			await screen.findByText(
				`${MockFailedWorkspace.owner_name} / ${MockFailedWorkspace.name}`,
			),
		).toBeInTheDocument();
		expect(screen.queryByTestId("workspace-health-clear")).toBeNull();
		expect(screen.getByText(/Select a workspace/)).toBeInTheDocument();
	});
});
