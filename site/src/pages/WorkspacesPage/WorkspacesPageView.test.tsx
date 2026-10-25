import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import type { UseFilterResult } from "#/components/Filter/Filter";
import {
	MockStoppedWorkspace,
	MockTemplate,
	MockTemplateVersion,
	MockWorkspace,
	MockWorkspaceAgent,
	MockWorkspaceResource,
} from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { WorkspacesPageView } from "./WorkspacesPageView";

const createFilter = (used = false): UseFilterResult => ({
	query: "",
	values: {},
	used,
	update: vi.fn(),
	debounceUpdate: vi.fn(),
	cancelDebounce: vi.fn(),
});

const defaultProps = {
	error: undefined,
	workspaces: [],
	checkedWorkspaces: [],
	count: 0,
	filter: createFilter(),
	page: 1,
	limit: 25,
	onPageChange: vi.fn(),
	onCheckChange: vi.fn(),
	isRunningBatchAction: false,
	onBatchDeleteTransition: vi.fn(),
	onBatchUpdateTransition: vi.fn(),
	onBatchStartTransition: vi.fn(),
	onBatchStopTransition: vi.fn(),
	templatesFetchStatus: "success" as const,
	templates: [MockTemplate],
	canCreateTemplate: false,
	canCreateWorkspace: true,
	canChangeVersions: false,
	onActionSuccess: vi.fn().mockResolvedValue(undefined),
	onActionError: vi.fn(),
};

describe("WorkspacesPageView", () => {
	beforeEach(() =>
		vi
			.spyOn(PlatformAPI, "getWorkspaceTunnels")
			.mockResolvedValue({ tunnels: [] }),
	);
	it("hides the New workspace button and explains the missing permission", async () => {
		renderWithAuth(
			<WorkspacesPageView {...defaultProps} canCreateWorkspace={false} />,
		);

		await screen.findByText(/don't have permission to create workspaces/i);
		expect(
			screen.queryByRole("button", { name: "Workspace" }),
		).not.toBeInTheDocument();
	});

	it("shows the New workspace button when the user can create workspaces", async () => {
		renderWithAuth(<WorkspacesPageView {...defaultProps} />);

		expect(
			await screen.findByRole("button", { name: "Workspace" }),
		).toBeInTheDocument();
	});

	it("shows the filter empty state instead of the no-permission empty state when a filter is active", async () => {
		renderWithAuth(
			<WorkspacesPageView
				{...defaultProps}
				canCreateWorkspace={false}
				filter={createFilter(true)}
			/>,
		);

		await screen.findByRole("heading", {
			name: /no workspaces match your search\./i,
		});
		expect(
			screen.queryByText(/don't have permission to create workspaces/i),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Workspace" }),
		).not.toBeInTheDocument();
	});

	it("shows the filter empty state when the user can create workspaces but the filter matches nothing", async () => {
		renderWithAuth(
			<WorkspacesPageView {...defaultProps} filter={createFilter(true)} />,
		);

		await screen.findByRole("heading", {
			name: /no workspaces match your search\./i,
		});
		expect(
			screen.queryByText(/don't have permission to create workspaces/i),
		).not.toBeInTheDocument();
	});

	it("restarts a running workspace from the overflow menu", async () => {
		const user = userEvent.setup();
		const restartSpy = vi
			.spyOn(API, "restartWorkspace")
			.mockResolvedValue(undefined);

		renderWithAuth(
			<WorkspacesPageView
				{...defaultProps}
				workspaces={[MockWorkspace]}
				count={1}
			/>,
		);

		await screen.findByText(MockWorkspace.name);
		await user.click(screen.getByTestId("workspace-options-button"));

		const restartItem = await screen.findByRole("menuitem", {
			name: /restart/i,
		});
		await user.click(restartItem);

		const dialog = await screen.findByRole("dialog");
		await user.click(within(dialog).getByRole("button", { name: /restart/i }));

		await waitFor(() =>
			expect(restartSpy).toHaveBeenCalledWith(
				expect.objectContaining({ workspace: MockWorkspace }),
			),
		);
	});

	it("does not offer restart for a stopped workspace", async () => {
		const user = userEvent.setup();

		renderWithAuth(
			<WorkspacesPageView
				{...defaultProps}
				workspaces={[MockStoppedWorkspace]}
				count={1}
			/>,
		);

		await screen.findByText(MockStoppedWorkspace.name);
		await user.click(screen.getByTestId("workspace-options-button"));

		await screen.findByRole("menuitem", { name: /settings/i });
		expect(
			screen.queryByRole("menuitem", { name: /restart/i }),
		).not.toBeInTheDocument();
	});

	it("stripes the row of a workspace on its way up, and only that one", async () => {
		const starting = {
			...MockWorkspace,
			id: "starting-ws",
			name: "starting",
			latest_build: {
				...MockWorkspace.latest_build,
				transition: "start" as const,
				status: "starting" as const,
			},
		};
		renderWithAuth(
			<WorkspacesPageView
				{...defaultProps}
				workspaces={[starting, MockStoppedWorkspace]}
				count={2}
			/>,
		);

		const row = await screen.findByTestId("workspace-starting-ws");
		expect(row).toHaveAttribute("data-starting", "true");
		expect(row).toHaveAttribute("aria-busy", "true");
		expect(row).toHaveClass("workspace-row-starting");
		const other = screen.getByTestId(`workspace-${MockStoppedWorkspace.id}`);
		expect(other).not.toHaveAttribute("data-starting");
	});

	it("puts the search in the bar above the table, and says what the table shows in its footer", async () => {
		renderWithAuth(
			<WorkspacesPageView
				{...defaultProps}
				workspaces={[MockStoppedWorkspace]}
				count={1}
			/>,
		);
		const bar = await screen.findByTestId("workspaces-bar");
		expect(within(bar).getByRole("combobox")).toBeInTheDocument();
		expect(await screen.findByTestId("workspaces-summary")).toHaveTextContent(
			"Showing 1 of 1 workspace · 0 running",
		);
		// the bar comes before the table
		expect(
			bar.compareDocumentPosition(screen.getByTestId("workspaces-card")) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});

it.each([false, true])(
	"reviews update-required Running before any build action (template update: %s)",
	async (outdated) => {
		const restart = vi
			.spyOn(API, "restartWorkspace")
			.mockResolvedValue(undefined);
		const update = vi
			.spyOn(API, "updateWorkspace")
			.mockResolvedValue(MockWorkspace.latest_build);
		vi.spyOn(API, "getTemplateVersion").mockResolvedValue(MockTemplateVersion);
		vi.spyOn(PlatformAPI, "getWorkspaceTunnels").mockResolvedValue({
			tunnels: [],
		});
		const workspace = {
			...MockWorkspace,
			outdated,
			latest_build: {
				...MockWorkspace.latest_build,
				resources: [
					{
						...MockWorkspaceResource,
						agents: [{ ...MockWorkspaceAgent, version: "1.0.0" }],
					},
				],
			},
		};
		renderWithAuth(
			<WorkspacesPageView
				{...defaultProps}
				workspaces={[workspace]}
				count={1}
			/>,
		);
		const user = userEvent.setup();
		const trigger = await screen.findByRole("button", {
			name: `Running. Restart ${workspace.name}; update available`,
		});
		if (outdated) await user.click(trigger);
		else {
			trigger.focus();
			await user.keyboard("{Enter}");
		}
		expect(restart).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		const dialog = await screen.findByRole("dialog", {
			name: outdated ? "Update and restart workspace" : "Restart workspace",
		});
		await user.click(
			within(dialog).getByRole("button", {
				name: outdated ? "Update and restart" : "Restart",
			}),
		);
		await waitFor(() => expect(outdated ? update : restart).toHaveBeenCalled());
		expect(outdated ? restart : update).not.toHaveBeenCalled();
	},
);
