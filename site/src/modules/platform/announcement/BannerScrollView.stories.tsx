import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { spyOn, userEvent, within } from "storybook/test";
import { reactRouterParameters } from "storybook-addon-remix-react-router";
import { API } from "#/api/api";
import type { Banner } from "#/api/platform";
import { PlatformAPI } from "#/api/platform";
import { workspaceByIdKey } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { WorkspaceContextMenu } from "#/modules/workspaces/WorkspaceContextMenu";
import { MockClusterNetworkReport } from "#/testHelpers/clusterNetwork";
import {
	MockHealth,
	MockUserOwner,
	MockWorkspace,
	MockWorkspaceAgent,
	MockWorkspaceResource,
} from "#/testHelpers/entities";
import { MockBanner } from "#/testHelpers/platform";
import { withAuthProvider, withWebSocket } from "#/testHelpers/storybook";
import { BannerScrollView } from "./BannerScrollView";
import { TerminalConnectorAvatar } from "./TerminalConnector";

const Preview = ({
	banner = MockBanner,
	workspace,
}: {
	banner?: Banner;
	workspace?: Workspace;
}) => {
	const anchor = useRef<HTMLDivElement>(null);
	return (
		<div
			ref={anchor}
			className="relative mx-auto mt-6 h-10 w-[700px] max-w-full rounded-lg border border-solid border-border bg-surface-secondary"
		>
			<span className="px-12">Announcement</span>
			<BannerScrollView anchor={anchor} banner={banner} />
			{workspace && (
				<div className="mt-12">
					<WorkspaceContextMenu workspace={workspace}>
						<TerminalConnectorAvatar workspace={workspace}>
							<span>{workspace.name}</span>
						</TerminalConnectorAvatar>
					</WorkspaceContextMenu>
				</div>
			)}
		</div>
	);
};
const meta: Meta<typeof Preview> = {
	title: "modules/platform/BannerScrollView",
	component: Preview,
	decorators: [withAuthProvider],
	parameters: { user: MockUserOwner },
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Read the whole announcement",
			}),
		);
	},
};
export default meta;
type Story = StoryObj<typeof Preview>;
export const Open: Story = {};
export const Identity: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Read the whole announcement",
			}),
		);
		await userEvent.keyboard("WhO{Enter}");
	},
};
export const Echo: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Read the whole announcement",
			}),
		);
		await userEvent.keyboard("echo{Enter}");
	},
};
export const Cat: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Read the whole announcement",
			}),
		);
		await userEvent.keyboard("cat hello{Enter}");
	},
};

export const Expanded: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Read the whole announcement",
			}),
		);
		await userEvent.dblClick(
			within(document.body).getByRole("button", {
				name: "Expand announcement panel",
			}),
		);
	},
};

export const WithPicture: Story = {
	args: { banner: { ...MockBanner, picture: "/pictures/creeper.gif" } },
};
export const ExpandedWithPicture: Story = {
	...Expanded,
	args: WithPicture.args,
};

const terminalWorkspace: Workspace = {
	...MockWorkspace,
	latest_build: {
		...MockWorkspace.latest_build,
		resources: [
			{
				...MockWorkspaceResource,
				agents: [{ ...MockWorkspaceAgent, api_version: "2.13" }],
			},
		],
	},
};

export const Terminal: Story = {
	args: { ...WithPicture.args, workspace: terminalWorkspace },
	decorators: [withWebSocket],
	parameters: {
		reactRouter: reactRouterParameters({ routing: { path: "/workspaces" } }),
		queries: [
			{ key: workspaceByIdKey(terminalWorkspace.id), data: terminalWorkspace },
		],
		webSocket: [
			{ event: "open" },
			{
				event: "message",
				data: `${Array.from({ length: 48 }, (_, index) => `Terminal output line ${index + 1}`).join("\r\n")}\r\n$ `,
			},
		],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Read the whole announcement" }),
		);
		await userEvent.keyboard("terminal{Enter}");
		canvas
			.getByRole("button", {
				name: `Connect ${terminalWorkspace.name} to banner terminal`,
			})
			.focus();
		await userEvent.keyboard("{Enter}");
	},
};

export const ExpandedTerminal: Story = {
	...Terminal,
	play: async (context) => {
		await Terminal.play?.(context);
		await userEvent.dblClick(
			within(document.body).getByRole("button", {
				name: "Expand announcement panel",
			}),
		);
	},
};

export const RestoredTerminal: Story = {
	...Terminal,
	play: async (context) => {
		await ExpandedTerminal.play?.(context);
		await userEvent.dblClick(
			within(document.body).getByRole("button", {
				name: "Restore announcement panel",
			}),
		);
	},
};

export const ConnectFromContextMenu: Story = {
	...Terminal,
	play: async ({ canvasElement }) => {
		await userEvent.pointer({
			keys: "[MouseRight]",
			target: within(canvasElement).getByText(terminalWorkspace.name),
		});
		await userEvent.click(
			within(document.body).getByRole("menuitem", { name: "Connect terminal" }),
		);
		await userEvent.dblClick(
			within(document.body).getByRole("button", {
				name: "Expand announcement panel",
			}),
		);
	},
};

export const Health: Story = {
	beforeEach: () => {
		spyOn(API, "getHealth").mockResolvedValue(MockHealth);
		spyOn(PlatformAPI, "getNetworkReport").mockResolvedValue(
			MockClusterNetworkReport,
		);
		spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [
				{
					...MockWorkspace,
					health: { ...MockWorkspace.health, healthy: false },
				},
			],
			count: 1,
		});
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Read the whole announcement",
			}),
		);
		await userEvent.keyboard("HeAlTh{Enter}");
	},
};
export const HealthUnavailable: Story = {
	...Health,
	beforeEach: () => {
		spyOn(API, "getHealth").mockRejectedValue(
			new Error("Coder health checks unavailable."),
		);
		spyOn(PlatformAPI, "getNetworkReport").mockRejectedValue(
			new Error("Cluster checks unavailable."),
		);
		spyOn(API, "getWorkspaces").mockRejectedValue(
			new Error("Workspace checks unavailable."),
		);
	},
};
export const HealthLoading: Story = {
	...Health,
	beforeEach: () => {
		spyOn(API, "getHealth").mockReturnValue(new Promise(() => {}));
		spyOn(PlatformAPI, "getNetworkReport").mockReturnValue(
			new Promise(() => {}),
		);
		spyOn(API, "getWorkspaces").mockReturnValue(new Promise(() => {}));
	},
};
