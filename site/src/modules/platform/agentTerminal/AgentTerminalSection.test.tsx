import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceTerminal } from "#/modules/terminal/WorkspaceTerminal";
import { MockWorkspace, MockWorkspaceAgent } from "#/testHelpers/entities";
import { AgentTerminalSection } from "./AgentTerminalSection";
import type * as TerminalSessionModule from "./terminalSession";
import { endSession, loadSession } from "./terminalSession";

vi.mock("react-query", () => ({
	useQuery: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("#/contexts/ProxyContext", () => ({ useProxy: () => ({ proxy: {} }) }));
vi.mock("#/hooks/useEmbeddedMetadata", () => ({
	useEmbeddedMetadata: () => ({
		metadata: { userAppearance: { available: false } },
	}),
}));
vi.mock("#/modules/terminal/WorkspaceTerminal", () => ({
	WorkspaceTerminal: vi.fn(() => null),
}));
vi.mock("./terminalSession", async (importOriginal) => ({
	...(await importOriginal<typeof TerminalSessionModule>()),
	endSession: vi.fn().mockResolvedValue(true),
}));

it("keeps added terminal sessions independent when one is removed", async () => {
	sessionStorage.clear();
	const onRemove = vi.fn();
	render(
		<>
			<AgentTerminalSection
				agent={MockWorkspaceAgent}
				workspace={MockWorkspace}
				ready
				panelId="app:first"
				initiallyOpen
				onRemove={onRemove}
			/>
			<AgentTerminalSection
				agent={MockWorkspaceAgent}
				workspace={MockWorkspace}
				ready
				panelId="app:second"
				initiallyOpen
			/>
		</>,
	);
	const first = loadSession(`${MockWorkspaceAgent.id}:app:first`);
	const second = loadSession(`${MockWorkspaceAgent.id}:app:second`);
	expect(first?.id).toBeTruthy();
	expect(second?.id).toBeTruthy();
	expect(first?.id).not.toBe(second?.id);
	expect(first?.command).toBeUndefined();
	expect(second?.command).toBeUndefined();
	expect(
		vi
			.mocked(WorkspaceTerminal)
			.mock.calls.map(([props]) => props.reconnectionToken),
	).toEqual(expect.arrayContaining([first?.id, second?.id]));
	await userEvent.click(
		screen.getByRole("button", { name: "Remove terminal panel" }),
	);
	expect(onRemove).toHaveBeenCalledOnce();
	expect(endSession).toHaveBeenCalledWith(
		MockWorkspaceAgent.id,
		first,
		undefined,
	);
	expect(loadSession(`${MockWorkspaceAgent.id}:app:second`)).toEqual(second);
});
