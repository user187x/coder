import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter, useLocation } from "react-router";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import type { Workspace } from "#/api/typesGenerated";
import { MockWorkspace } from "#/testHelpers/entities";
import {
	FRAME_WIDTH,
	frameFit,
	gridLayout,
	WorkspaceGrid,
} from "./WorkspaceGrid";

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
	vi.spyOn(PlatformAPI, "getWorkspaceTunnels").mockResolvedValue({
		tunnels: [],
	});
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
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("fits up to four together, and lays more out as square as can be", () => {
		expect(gridLayout(1)).toEqual({ cols: 1, rows: 1 });
		expect(gridLayout(2)).toEqual({ cols: 2, rows: 1 });
		expect(gridLayout(3)).toEqual({ cols: 2, rows: 2 });
		expect(gridLayout(4)).toEqual({ cols: 2, rows: 2 });
		expect(gridLayout(5)).toEqual({ cols: 3, rows: 2 });
		expect(gridLayout(9)).toEqual({ cols: 3, rows: 3 });
		expect(gridLayout(10)).toEqual({ cols: 4, rows: 3 });
	});

	it("fits a dashboard to its cell's width, then its height once told, aligned at the top", () => {
		// a 2x2 cell: 690 wide, 400 high below its bar; drawn FRAME_WIDTH wide, at 690/1024 until its height is told
		const before = frameFit(690, 400);
		expect(before.width).toBe(FRAME_WIDTH);
		expect(before.scale).toBeCloseTo(690 / FRAME_WIDTH);
		expect(before.left).toBe(0);
		expect(before.height * before.scale).toBeCloseTo(400);
		// Short content stays at the top while every frame shares the tallest content height.
		const short = frameFit(690, 400, [300]);
		expect(short.scale).toBeCloseTo(690 / FRAME_WIDTH);
		expect(short.height).toBe(302);
		expect(short.top).toBe(0);
		// tall: the height decides, and it sits in the middle of the cell's width
		const tall = frameFit(690, 400, [798]);
		expect(tall.scale).toBeCloseTo(0.5);
		expect(tall.left).toBeCloseTo((690 - FRAME_WIDTH * 0.5) / 2);
		expect(tall.top).toBeCloseTo(0, 0);
		// however tall, it fits whole: never a scrollbar
		const huge = frameFit(690, 400, [3998]);
		expect(huge.scale).toBeCloseTo(0.1);
		expect(huge.height * huge.scale).toBeCloseTo(400);
		// one alone, wider than FRAME_WIDTH: drawn the cell's width, unscaled
		expect(frameFit(1400, 800, [500])).toMatchObject({ width: 1400, scale: 1 });
	});

	it("uses the tallest visible dashboard for one shared fit", () => {
		expect(frameFit(690, 400, [300, undefined, 798])).toEqual(
			frameFit(690, 400, [798]),
		);
		expect(frameFit(690, 400, [798, 300])).toEqual(
			frameFit(690, 400, [300, 798]),
		);
		expect(
			frameFit(690, 400, [
				undefined,
				Number.NaN,
				Number.POSITIVE_INFINITY,
				-10,
				0,
			]),
		).toEqual(frameFit(690, 400));
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

	it("opens the selected workspace from its focused view", async () => {
		const user = userEvent.setup();
		const onOpenChange = renderGrid(["one", "two"]);
		await user.click(await screen.findByRole("button", { name: "Focus two" }));
		await user.click(screen.getByRole("button", { name: "Open two" }));
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
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

it("switches to list and back without changing established tunnel intents", async () => {
	const create = vi.spyOn(PlatformAPI, "createWorkspaceTunnel");
	const remove = vi.spyOn(PlatformAPI, "deleteWorkspaceTunnel");
	renderGrid(["one", "two"]);
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", { name: "Workspace layout: Grid" }),
	);
	await user.click(screen.getByRole("menuitemradio", { name: "List" }));
	await user.click(
		screen.getByRole("button", { name: "Workspace layout: List" }),
	);
	await user.click(screen.getByRole("menuitemradio", { name: "Grid" }));
	expect(create).not.toHaveBeenCalled();
	expect(remove).not.toHaveBeenCalled();
});
