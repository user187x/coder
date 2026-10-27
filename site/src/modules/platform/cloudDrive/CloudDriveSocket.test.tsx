import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { cloudDriveConnections, safe } from "#/api/queries/platform";
import type { Workspace } from "#/api/typesGenerated";
import { MockUserOwner, MockWorkspace } from "#/testHelpers/entities";
import { CloudDriveSocket, useCloudDriveLinks } from "./CloudDriveSocket";

const auth = vi.hoisted(() => ({ admin: false }));
vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => ({
		user: { ...MockUserOwner, roles: auth.admin ? MockUserOwner.roles : [] },
		permissions: {},
	}),
}));

const ws = (id: string, owner = "me") =>
	({ ...MockWorkspace, id, name: id, owner_name: owner }) as Workspace;

const Sockets: React.FC = () => {
	const links = useCloudDriveLinks();
	return (
		<>
			<CloudDriveSocket workspace={ws("on")} links={links} mine />
			<CloudDriveSocket workspace={ws("off")} links={links} mine />
			<CloudDriveSocket workspace={ws("wait")} links={links} mine />
			<CloudDriveSocket workspace={ws("shared")} links={links} mine />
			<CloudDriveSocket
				workspace={ws("greg", "greg")}
				links={links}
				mine={false}
			/>
		</>
	);
};

const renderSockets = (enabled = true) => {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(safe().queryKey, { enabled });
	client.setQueryData(cloudDriveConnections().queryKey, {
		disconnected: ["off"],
		older: [],
		shared: ["shared"],
		attachment: { wait: "waiting", on: "attached" },
	});
	render(
		<QueryClientProvider client={client}>
			<Sockets />
		</QueryClientProvider>,
	);
};

const socket = (id: string) => screen.getByTestId(`cloud-drive-socket-${id}`);

describe("CloudDriveSocket", () => {
	afterEach(() => {
		auth.admin = false;
		vi.restoreAllMocks();
	});

	it("shows each row's socket: plugged in, waiting, empty, or taking no plug", () => {
		renderSockets();
		expect(socket("on")).toHaveAttribute("data-state", "on");
		expect(socket("on")).toHaveAttribute(
			"aria-label",
			"Cloud Drive mounted at ~/cloud-drive: click to unmount",
		);
		expect(socket("wait")).toHaveAttribute("data-state", "attaching");
		expect(socket("off")).toHaveAttribute("data-state", "off");
		expect(socket("shared")).toHaveAttribute("data-state", "none");
		expect(socket("greg")).toHaveAttribute(
			"data-hint",
			"Only greg's own Cloud Drive plugs in here",
		);
		expect(socket("greg").tagName).toBe("SPAN");
	});

	it("lets an admin connect another owner's workspace without sharing an item", async () => {
		auth.admin = true;
		const user = userEvent.setup();
		const connect = vi
			.spyOn(PlatformAPI, "setCloudDriveConnection")
			.mockResolvedValue({
				disconnected: [],
				older: [],
				workspace: "greg",
				connected: true,
				applied: false,
			});
		const share = vi.spyOn(PlatformAPI, "shareCloudDrive");
		renderSockets();
		await user.click(
			screen.getByRole("button", { name: /Connect greg.*greg for sharing/ }),
		);
		await waitFor(() => expect(connect).toHaveBeenCalledWith("greg", true));
		expect(share).not.toHaveBeenCalled();
	});

	it("plugs the drive in and pulls it out with a click", async () => {
		const set = vi
			.spyOn(PlatformAPI, "setCloudDriveConnection")
			.mockResolvedValue({
				disconnected: [],
				older: [],
				shared: ["shared"],
				workspace: "off",
				connected: true,
			} as never);
		renderSockets();
		fireEvent.click(socket("off"));
		await waitFor(() => expect(set).toHaveBeenCalledWith("off", true));
		fireEvent.click(socket("on"));
		await waitFor(() => expect(set).toHaveBeenCalledWith("on", false));
	});

	it("is not there without a Cloud Drive", () => {
		renderSockets(false);
		expect(screen.queryByTestId("cloud-drive-socket-on")).toBeNull();
	});
});
