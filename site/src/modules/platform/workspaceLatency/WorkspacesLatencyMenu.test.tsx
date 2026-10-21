import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { API } from "#/api/api";
import type { Workspace } from "#/api/typesGenerated";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { MockWorkspace, MockWorkspaceAgent } from "#/testHelpers/entities";
import {
	HOLD_MS,
	WorkspacesLatencyMenu,
	workspaceLatency,
} from "./WorkspacesLatencyMenu";

const withLatency = (
	name: string,
	ms: number | null,
	status = "running",
): Workspace => ({
	...MockWorkspace,
	id: name,
	name,
	latest_build: {
		...MockWorkspace.latest_build,
		status: status as Workspace["latest_build"]["status"],
		resources: [
			{
				...MockWorkspace.latest_build.resources[0],
				agents: [
					{
						...MockWorkspaceAgent,
						latency:
							ms === null
								? {}
								: {
										"Coder Embedded Relay": { latency_ms: ms, preferred: true },
									},
					},
				],
			},
		],
	},
});

const renderMenu = (onOpenChange = vi.fn(), onOther = vi.fn()) =>
	render(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<DropdownMenu open onOpenChange={onOpenChange}>
					<DropdownMenuTrigger>menu</DropdownMenuTrigger>
					<DropdownMenuContent>
						<WorkspacesLatencyMenu open />
						<DropdownMenuItem onSelect={onOther}>Other</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</MemoryRouter>
		</QueryClientProvider>,
	);

const mockWorkspaces = () =>
	vi.spyOn(API, "getWorkspaces").mockResolvedValue({
		workspaces: [withLatency("ggg", 7.2), withLatency("old", null, "stopped")],
		count: 2,
	});

const isOpen = (list: HTMLElement) =>
	list.getAttribute("data-state") === "open" && !list.hasAttribute("inert");

describe("WorkspacesLatencyMenu", () => {
	afterEach(() => vi.restoreAllMocks());

	it("takes a workspace's latency from its agents' preferred region", () => {
		expect(workspaceLatency(withLatency("a", 12.4))).toBe(12.4);
		expect(workspaceLatency(withLatency("b", null))).toBeUndefined();
	});

	it("is one centred pill - the icon, the word and the count, the count in its own pill", async () => {
		const get = mockWorkspaces();
		renderMenu();
		await waitFor(() => expect(get).toHaveBeenCalledWith({ q: "owner:me" }));
		const row = await screen.findByTestId("workspaces-latency");
		expect(row).toHaveAttribute("role", "menuitem");
		expect(row).toHaveClass("justify-center");
		const pill = within(row).getByTestId("workspaces-latency-pill");
		expect(pill).toHaveClass("rounded-full");
		expect(pill.firstElementChild?.tagName.toLowerCase()).toBe("svg");
		expect(pill).toHaveTextContent(/^Workspaces/);
		const count = within(pill).getByTestId("workspaces-latency-count");
		await waitFor(() => expect(count).toHaveTextContent("2"));
		expect(count).toHaveClass("rounded-full");
		expect(count).toHaveAttribute("title", "1 running");
	});

	it("shows each workspace's latency only while the mouse button is held down on it", async () => {
		mockWorkspaces();
		renderMenu();
		const row = await screen.findByTestId("workspaces-latency");
		const list = screen.getByTestId("workspaces-latency-list");
		expect(isOpen(list)).toBe(false);
		expect(row).toHaveAttribute("aria-expanded", "false");

		fireEvent.pointerDown(row, { button: 0, pointerId: 1 });
		expect(isOpen(list)).toBe(true);
		expect(row).toHaveAttribute("aria-expanded", "true");
		expect(
			await within(list).findByTestId("workspace-latency-ggg"),
		).toHaveTextContent("7ms");
		expect(within(list).getByTestId("workspace-latency-old")).toHaveTextContent(
			"stopped",
		);
		expect(within(list).getByTestId("workspace-latency-ggg")).toHaveAttribute(
			"href",
			`/@${MockWorkspace.owner_name}/ggg`,
		);

		// let go anywhere: it slides closed, and the menu stays
		fireEvent.pointerUp(document.body, { button: 0, pointerId: 1 });
		expect(isOpen(list)).toBe(false);
		expect(row).toHaveAttribute("aria-expanded", "false");
		expect(screen.getByRole("menu")).toBeInTheDocument();

		// another button than the main one opens nothing
		fireEvent.pointerDown(row, { button: 2, pointerId: 1 });
		expect(isOpen(list)).toBe(false);
	});

	it("chooses nothing when the press ends on another item, and opens a workspace it ends on", async () => {
		mockWorkspaces();
		const onOpenChange = vi.fn();
		const onOther = vi.fn();
		renderMenu(onOpenChange, onOther);
		const row = await screen.findByTestId("workspaces-latency");
		const list = screen.getByTestId("workspaces-latency-list");

		fireEvent.pointerDown(row, { button: 0, pointerId: 1 });
		const other = screen.getByRole("menuitem", { name: "Other" });
		fireEvent.pointerUp(other, { button: 0, pointerId: 1 });
		expect(isOpen(list)).toBe(false);
		expect(onOther).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalled();

		fireEvent.pointerDown(row, { button: 0, pointerId: 1 });
		const workspace = await within(list).findByTestId("workspace-latency-ggg");
		fireEvent.pointerUp(workspace, { button: 0, pointerId: 1 });
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("opens and closes from the keyboard, the menu staying open", async () => {
		mockWorkspaces();
		renderMenu();
		const row = await screen.findByTestId("workspaces-latency");
		const list = screen.getByTestId("workspaces-latency-list");
		fireEvent.keyDown(row, { key: "Enter" });
		expect(isOpen(list)).toBe(true);
		// a held key repeats: still open
		fireEvent.keyDown(row, { key: "Enter", repeat: true });
		expect(isOpen(list)).toBe(true);
		fireEvent.keyDown(row, { key: " " });
		expect(isOpen(list)).toBe(false);
		fireEvent.click(row);
		expect(screen.getByRole("menu")).toBeInTheDocument();
	});
	it("locks open when held through the ring (hold to confirm) or double clicked, until a press elsewhere", async () => {
		mockWorkspaces();
		renderMenu();
		const row = await screen.findByTestId("workspaces-latency");
		const pill = within(row).getByTestId("workspaces-latency-pill");
		const list = screen.getByTestId("workspaces-latency-list");
		expect(pill).toHaveClass("w-full");

		// released early: the ring snaps back, the list shuts
		fireEvent.pointerDown(row, { button: 0, pointerId: 1 });
		expect(pill).toHaveAttribute("data-hold", "holding");
		fireEvent.pointerUp(document.body, { button: 0, pointerId: 1 });
		expect(pill).not.toHaveAttribute("data-hold");
		expect(isOpen(list)).toBe(false);

		// held through HOLD_MS: locked, and letting go keeps it open
		fireEvent.pointerDown(row, { button: 0, pointerId: 1 });
		await act(
			() => new Promise((resolve) => setTimeout(resolve, HOLD_MS + 60)),
		);
		expect(pill).toHaveAttribute("data-hold", "locked");
		fireEvent.pointerUp(document.body, { button: 0, pointerId: 1 });
		expect(isOpen(list)).toBe(true);
		expect(row).toHaveAttribute("data-locked", "true");

		// a press inside the list keeps it; a press elsewhere lets go
		fireEvent.pointerDown(list, { button: 0, pointerId: 1 });
		expect(isOpen(list)).toBe(true);
		fireEvent.pointerDown(document.body, { button: 0, pointerId: 1 });
		expect(isOpen(list)).toBe(false);
		expect(screen.getByRole("menu")).toBeInTheDocument();

		// a double click locks it too; a press on the locked pill unlocks it
		fireEvent.doubleClick(row);
		expect(isOpen(list)).toBe(true);
		expect(pill).toHaveAttribute("data-hold", "locked");
		fireEvent.pointerDown(row, { button: 0, pointerId: 1 });
		fireEvent.pointerUp(row, { button: 0, pointerId: 1 });
		expect(isOpen(list)).toBe(false);
	});
});
