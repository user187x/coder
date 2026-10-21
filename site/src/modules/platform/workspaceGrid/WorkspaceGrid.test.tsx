import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter, useLocation } from "react-router";
import { API } from "#/api/api";
import type { Workspace } from "#/api/typesGenerated";
import { MockWorkspace } from "#/testHelpers/entities";
import { gridLayout, WorkspaceGrid } from "./WorkspaceGrid";

const named = (name: string): Workspace => ({
	...MockWorkspace,
	id: `id-${name}`,
	name,
	template_display_name: "DEFAULT",
});

const Where: React.FC = () => (
	<p data-testid="where">{useLocation().pathname}</p>
);

const renderGrid = (names: string[], onOpenChange = vi.fn()) => {
	vi.spyOn(API, "getWorkspaces").mockResolvedValue({
		workspaces: names.map(named),
		count: names.length,
	});
	render(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter initialEntries={["/workspaces"]}>
				<Where />
				<WorkspaceGrid
					ids={names.map((n) => `id-${n}`)}
					open
					onOpenChange={onOpenChange}
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	return onOpenChange;
};

describe("WorkspaceGrid", () => {
	afterEach(() => vi.restoreAllMocks());

	it("fits up to four together, and lays more out as square as can be", () => {
		expect(gridLayout(1)).toEqual({ cols: 1, rows: 1 });
		expect(gridLayout(2)).toEqual({ cols: 2, rows: 1 });
		expect(gridLayout(3)).toEqual({ cols: 2, rows: 2 });
		expect(gridLayout(4)).toEqual({ cols: 2, rows: 2 });
		expect(gridLayout(5)).toEqual({ cols: 3, rows: 2 });
		expect(gridLayout(9)).toEqual({ cols: 3, rows: 3 });
		expect(gridLayout(10)).toEqual({ cols: 4, rows: 3 });
	});

	it("shows each workspace's own page, embedded, with its name and template", async () => {
		renderGrid(["one", "two"]);
		const frame = await screen.findByTestId("workspace-grid-frame-one");
		expect(frame).toHaveAttribute("src", `/@${MockWorkspace.owner_name}/one`);
		expect(frame).toHaveAttribute(
			"data-platform-embed",
			`/@${MockWorkspace.owner_name}/one`,
		);
		expect(screen.getByTestId("workspace-grid-frame-two")).toBeInTheDocument();
		expect(screen.getByTestId("workspace-grid-cell-one")).toHaveTextContent(
			"DEFAULT",
		);
		// two fit: no dragging, the dashboards usable at once
		expect(screen.queryByTestId("workspace-grid-hint")).toBeNull();
		expect(screen.queryByTestId("workspace-grid-shield-one")).toBeNull();
	});

	it("with more than four, the grid is dragged round; a click picks the dashboard to use", async () => {
		renderGrid(["a", "b", "c", "d", "e"]);
		await screen.findByTestId("workspace-grid-frame-e");
		expect(screen.getByTestId("workspace-grid-hint")).toHaveTextContent(/Drag/);
		const viewport = screen.getByTestId("workspace-grid-viewport");
		expect(viewport).toHaveAttribute("data-pannable", "true");
		expect(viewport).toHaveClass("cursor-grab");

		// a drag moves the grid
		const shield = screen.getByTestId("workspace-grid-shield-a");
		fireEvent.pointerDown(shield, {
			button: 0,
			pointerId: 1,
			clientX: 300,
			clientY: 300,
		});
		fireEvent.pointerMove(shield, { pointerId: 1, clientX: 200, clientY: 250 });
		expect(viewport).toHaveClass("cursor-grabbing");
		expect(viewport.scrollLeft).toBe(100);
		expect(viewport.scrollTop).toBe(50);
		fireEvent.pointerUp(shield, { pointerId: 1, clientX: 200, clientY: 250 });
		expect(screen.getByTestId("workspace-grid-cell-a")).not.toHaveAttribute(
			"data-active",
		);

		// a click uses that one: its picture lifts off it
		fireEvent.pointerDown(shield, {
			button: 0,
			pointerId: 1,
			clientX: 10,
			clientY: 10,
		});
		fireEvent.pointerUp(shield, { pointerId: 1, clientX: 11, clientY: 10 });
		expect(screen.getByTestId("workspace-grid-cell-a")).toHaveAttribute(
			"data-active",
			"true",
		);
		expect(screen.queryByTestId("workspace-grid-shield-a")).toBeNull();
		expect(screen.getByTestId("workspace-grid-shield-b")).toBeInTheDocument();
	});

	it("opens a workspace's page from its bar, and makes way for it", async () => {
		const onOpenChange = renderGrid(["one", "two"]);
		fireEvent.click(await screen.findByTestId("workspace-grid-open-two"));
		expect(screen.getByTestId("where")).toHaveTextContent(
			`/@${MockWorkspace.owner_name}/two`,
		);
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});
});
