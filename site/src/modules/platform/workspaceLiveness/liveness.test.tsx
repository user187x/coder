import { act, render, screen } from "@testing-library/react";
import { TooltipProvider } from "#/components/Tooltip/Tooltip";
import { AgentBorderFx } from "#/modules/platform/agentBorder/AgentBorderFx";
import { toBars } from "#/modules/resources/MetadataHistogram";
import { WorkspaceStatusIndicator } from "#/modules/workspaces/WorkspaceStatusIndicator/WorkspaceStatusIndicator";
import { MockWorkspace } from "#/testHelpers/entities";
import {
	setWorkspaceContact,
	useWorkspaceContactLost,
	workspaceContactLostAt,
} from "./liveness";

const running = {
	...MockWorkspace,
	latest_build: { ...MockWorkspace.latest_build, status: "running" as const },
	health: { healthy: true, failing_agents: [] },
};

const Probe: React.FC<{ id: string }> = ({ id }) => (
	<output data-testid="lost">{String(useWorkspaceContactLost(id))}</output>
);

describe("contact with Coder about a workspace", () => {
	afterEach(() => act(() => setWorkspaceContact(running.id, true)));

	it("is in contact until the page says otherwise, and remembers since when", () => {
		render(<Probe id={running.id} />);
		expect(screen.getByTestId("lost")).toHaveTextContent("null");
		act(() => setWorkspaceContact(running.id, false));
		const since = workspaceContactLostAt(running.id);
		expect(since).toBeGreaterThan(0);
		act(() => setWorkspaceContact(running.id, false)); // still lost: the same since
		expect(workspaceContactLostAt(running.id)).toBe(since);
		act(() => setWorkspaceContact(running.id, true));
		expect(screen.getByTestId("lost")).toHaveTextContent("null");
		expect(workspaceContactLostAt(undefined)).toBeNull();
	});

	it("turns the running light grey and still, and says no contact instead of running", () => {
		render(
			<TooltipProvider>
				<WorkspaceStatusIndicator workspace={running} runningLight />
			</TooltipProvider>,
		);
		const light = screen.getByTestId("workspace-running-light");
		expect(light).not.toHaveAttribute("data-lost");
		expect(screen.getByText("Running")).toBeInTheDocument();
		act(() => setWorkspaceContact(running.id, false));
		expect(screen.getByTestId("workspace-running-light")).toHaveAttribute(
			"data-lost",
			"true",
		);
		expect(screen.getByText("No contact")).toBeInTheDocument();
		expect(screen.queryByText("Running")).toBeNull();
	});

	it("gives the agent card a still grey border", () => {
		const { container } = render(
			<AgentBorderFx state="lost">
				<div>card</div>
			</AgentBorderFx>,
		);
		expect(container.querySelector(".agent-fx-lost")).not.toBeNull();
		expect(container.querySelector(".agent-fx-electric")).toBeNull();
		expect(container.querySelector(".agent-fx-pulse")).toBeNull();
	});

	it("keeps the graphs as they were when the card stopped", () => {
		const stoppedAt = 1_000_000;
		const samples = [
			{ at: "", t: stoppedAt - 1000, value: 40, text: "40" },
			{ at: "", t: stoppedAt - 3000, value: 20, text: "20" },
		];
		// a minute later, drawn at the stop: the same bars, the newest still at the right
		const atStop = toBars(samples, 1, 0, stoppedAt);
		expect(atStop[atStop.length - 2]?.value).toBe(40);
		expect(toBars(samples, 1, 0, stoppedAt)).toEqual(atStop);
		expect(toBars(samples, 1, 0, stoppedAt + 60_000).every((b) => !b)).toBe(
			true,
		);
	});
});
