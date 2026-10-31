import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { WorkspaceTerminal } from "#/modules/terminal/WorkspaceTerminal";
import { MockWorkspace, MockWorkspaceAgent } from "#/testHelpers/entities";
import { AgentTerminalSection } from "./AgentTerminalSection";
import { loadLayout, terminalBounds } from "./terminalLayout";
import type * as TerminalSessionModule from "./terminalSession";
import { endSession, loadSession, loadSessions } from "./terminalSession";

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
	WorkspaceTerminal: vi.fn(
		(props: React.ComponentProps<typeof WorkspaceTerminal>) => (
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button type="button">Terminal display</button>
				</ContextMenuTrigger>
				<ContextMenuContent>{props.contextMenuItems}</ContextMenuContent>
			</ContextMenu>
		),
	),
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

beforeEach(() => {
	sessionStorage.clear();
	localStorage.clear();
	vi.clearAllMocks();
});

const renderTiles = () =>
	render(
		<AgentTerminalSection
			agent={MockWorkspaceAgent}
			workspace={MockWorkspace}
			ready
			panelId="tiles"
			initiallyOpen
		/>,
	);
const tileKey = `${MockWorkspaceAgent.id}:tiles`;

it("adds independent tiles and changes all text sizes without replacing their PTYs", async () => {
	renderTiles();
	const first = loadSessions(tileKey)[0];
	await userEvent.click(
		screen.getByRole("button", { name: "Add terminal below" }),
	);
	const sessions = loadSessions(tileKey);
	expect(sessions).toHaveLength(2);
	expect(sessions[0]).toEqual(first);
	expect(sessions[0]?.id).not.toEqual(sessions[1]?.id);
	await userEvent.click(screen.getByRole("button", { name: "Larger text" }));
	for (const session of sessions) {
		const latest = vi
			.mocked(WorkspaceTerminal)
			.mock.calls.filter(([props]) => props.reconnectionToken === session.id)
			.at(-1)?.[0];
		expect(latest?.fontSize).toBe(14);
	}
	expect(loadSessions(tileKey)).toEqual(sessions);
	await userEvent.click(
		screen.getByRole("button", { name: "Close selected terminal" }),
	);
	expect(endSession).toHaveBeenCalledWith(
		MockWorkspaceAgent.id,
		sessions[1],
		undefined,
	);
	expect(loadSessions(tileKey)).toEqual([first]);
});

it("ends every tile together when the panel is closed", async () => {
	renderTiles();
	await userEvent.click(
		screen.getByRole("button", { name: "Add terminal below" }),
	);
	const sessions = loadSessions(tileKey);
	await userEvent.click(screen.getByRole("button", { name: "Terminal" }));
	expect(loadSessions(tileKey)).toEqual([]);
	for (const session of sessions)
		expect(endSession).toHaveBeenCalledWith(
			MockWorkspaceAgent.id,
			session,
			undefined,
		);
});

it("keeps every tile across collapse and pop out when end-on-close is off", async () => {
	renderTiles();
	await userEvent.click(
		screen.getByRole("button", { name: "Add terminal below" }),
	);
	const sessions = loadSessions(tileKey);
	await userEvent.click(
		screen.getByRole("switch", { name: "End session when closed" }),
	);
	await userEvent.click(screen.getByRole("button", { name: "Terminal" }));
	await userEvent.click(screen.getByRole("button", { name: "Terminal" }));
	await userEvent.click(screen.getByRole("button", { name: "Pop out" }));
	await userEvent.click(
		screen.getByRole("button", {
			name: "Put the terminal back in the drop-down",
		}),
	);
	expect(loadSessions(tileKey)).toEqual(sessions);
	expect(endSession).not.toHaveBeenCalled();
});

it("runs the shared command in new sessions for every tile", async () => {
	renderTiles();
	await userEvent.click(
		screen.getByRole("button", { name: "Add terminal below" }),
	);
	const previous = loadSessions(tileKey);
	await userEvent.click(screen.getByRole("switch", { name: "Custom command" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Command" }), "pwd");
	await userEvent.click(screen.getByRole("button", { name: "Run all" }));
	const current = loadSessions(tileKey);
	expect(current).toHaveLength(2);
	for (const session of current) {
		expect(session.command).toBe("pwd");
		expect(previous.map(({ id }) => id)).not.toContain(session.id);
	}
	for (const session of previous)
		expect(endSession).toHaveBeenCalledWith(
			MockWorkspaceAgent.id,
			session,
			undefined,
		);
});

it("keeps the other tile alive when one shell exits", async () => {
	renderTiles();
	await userEvent.click(
		screen.getByRole("button", { name: "Add terminal below" }),
	);
	const [first, second] = loadSessions(tileKey);
	const terminal = vi
		.mocked(WorkspaceTerminal)
		.mock.calls.findLast(
			([props]) => props.reconnectionToken === first?.id,
		)?.[0];
	act(() => terminal?.onExit?.());
	expect(loadSessions(tileKey)).toEqual([second]);
	expect(endSession).toHaveBeenCalledWith(
		MockWorkspaceAgent.id,
		first,
		undefined,
	);
});

it("splits the selected pane in either direction without ending existing sessions", async () => {
	renderTiles();
	const first = loadSessions(tileKey)[0];
	await userEvent.pointer({
		keys: "[MouseRight]",
		target: screen.getByRole("button", { name: "Terminal display" }),
	});
	await userEvent.click(
		screen.getByRole("menuitem", { name: "Split vertically" }),
	);
	const [left, right] = loadSessions(tileKey);
	expect(left).toEqual(first);
	expect(left?.id).not.toEqual(right?.id);
	await userEvent.pointer({
		keys: "[MouseRight]",
		target: screen.getAllByRole("button", { name: "Terminal display" })[1],
	});
	await userEvent.click(
		screen.getByRole("menuitem", { name: "Split horizontally" }),
	);
	const current = loadSessions(tileKey);
	expect(current.slice(0, 2)).toEqual([left, right]);
	expect(current).toHaveLength(3);
	expect([...terminalBounds(loadLayout(tileKey)).values()]).toEqual([
		{ left: 0, top: 0, width: 50, height: 100 },
		{ left: 50, top: 0, width: 50, height: 50 },
		{ left: 50, top: 50, width: 50, height: 50 },
	]);
	expect(endSession).not.toHaveBeenCalled();
	await userEvent.click(
		screen.getAllByRole("button", { name: "Terminal display" })[2],
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Close selected terminal" }),
	);
	expect(loadSessions(tileKey)).toEqual([left, right]);
	expect([...terminalBounds(loadLayout(tileKey)).values()]).toEqual([
		{ left: 0, top: 0, width: 50, height: 100 },
		{ left: 50, top: 0, width: 50, height: 100 },
	]);
});
