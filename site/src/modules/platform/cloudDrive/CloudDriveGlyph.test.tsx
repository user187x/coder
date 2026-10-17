import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI, type SafeSummary } from "#/api/platform";
import { TooltipProvider } from "#/components/Tooltip/Tooltip";
import {
	MockUserOwner,
	MockWorkspace,
	MockWorkspacesResponse,
} from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { CloudDriveConnections } from "./CloudDriveConnections";
import { CloudDriveGlyph } from "./CloudDriveGlyph";

vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => ({ user: MockUserOwner, permissions: {} }),
}));

const summary: SafeSummary = {
	enabled: true,
	mountPath: "/home/coder/cloud-drive",
	usedBytes: 3 * 1024 ** 3,
	files: 9,
	quotaBytes: 10 * 1024 ** 3,
	maxUploadBytes: 5 * 1024 ** 3,
	volume: "ready",
};
const mine = { ...MockWorkspace, owner_id: MockUserOwner.id };

const render = (ui: React.ReactNode) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
		</QueryClientProvider>,
	);

describe("Cloud Drive glyph", () => {
	afterEach(() => vi.restoreAllMocks());

	it("shows on a connected workspace, with a HUD of how full the drive is and what is in it", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		vi.spyOn(PlatformAPI, "getCloudDriveConnections").mockResolvedValue({
			disconnected: [],
			older: [],
		});
		vi.spyOn(PlatformAPI, "listSafe").mockResolvedValue({
			path: "",
			folders: [{ name: "models" }],
			files: Array.from({ length: 7 }, (_, i) => ({
				name: `notes-${i}.md`,
				size: 2048,
				modified: "",
			})),
		});
		render(<CloudDriveGlyph workspace={mine} />);
		const glyph = await screen.findByTestId("cloud-drive-glyph");
		expect(glyph).toHaveAccessibleName("Cloud Drive: 3 GB of 10 GB used");
		fireEvent.focus(glyph);
		const hud = await screen.findByTestId("cloud-drive-hud");
		expect(
			within(hud).getByRole("progressbar", { name: "Cloud Drive used" }),
		).toHaveAttribute("aria-valuenow", "30");
		expect(hud).toHaveTextContent("7 GB free");
		await waitFor(() => expect(hud).toHaveTextContent("models"));
		// folders first, six listed, the rest counted
		expect(hud).toHaveTextContent("notes-4.md");
		expect(hud).not.toHaveTextContent("notes-5.md");
		expect(hud).toHaveTextContent("and 2 more");
	});

	it("is not there on a disconnected workspace, nor on someone else's", async () => {
		const connections = vi
			.spyOn(PlatformAPI, "getCloudDriveConnections")
			.mockResolvedValue({ disconnected: [mine.id], older: [] });
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(summary);
		const { unmount } = render(<CloudDriveGlyph workspace={mine} />);
		await waitFor(() => expect(connections).toHaveBeenCalled());
		expect(screen.queryByTestId("cloud-drive-glyph")).toBeNull();
		unmount();
		render(
			<CloudDriveGlyph workspace={{ ...mine, owner_id: "someone-else" }} />,
		);
		expect(screen.queryByTestId("cloud-drive-glyph")).toBeNull();
	});
});

describe("Cloud Drive > Workspaces", () => {
	afterEach(() => vi.restoreAllMocks());

	it("switches a workspace's connection without dragging", async () => {
		vi.spyOn(PlatformAPI, "getCloudDriveConnections").mockResolvedValue({
			disconnected: [],
			older: [],
		});
		const { API } = await import("#/api/api");
		vi.spyOn(API, "getWorkspaces").mockResolvedValue({
			...MockWorkspacesResponse,
			workspaces: [mine],
			count: 1,
		});
		const save = vi
			.spyOn(PlatformAPI, "setCloudDriveConnection")
			.mockResolvedValue({
				disconnected: [mine.id],
				older: [],
				workspace: mine.id,
				connected: false,
				applied: true,
			});
		render(<CloudDriveConnections />);
		const toggle = await screen.findByRole("switch", {
			name: /test-workspace/,
		});
		expect(toggle).toBeChecked();
		fireEvent.click(toggle);
		await waitFor(() => expect(save).toHaveBeenCalledWith(mine.id, false));
		await waitFor(() => expect(toggle).not.toBeChecked());
		expect(screen.getByText("Disconnected")).toBeInTheDocument();
	});
});
