import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import {
	type CloudDrivePeers,
	type CloudDriveShare,
	PlatformAPI,
} from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { ShareDialog } from "./ShareDialog";
import { incomingShares, shareWhat } from "./sharedWithYou";

const ME = "me-id";

const share = (over: Partial<CloudDriveShare>): CloudDriveShare => ({
	id: "s".repeat(32),
	from: ME,
	fromName: "me",
	owner: "greg-id",
	ownerName: "greg",
	access: "read",
	asked: "read",
	state: "active",
	askedAt: 1,
	kind: "drive",
	path: "",
	by: "request",
	...over,
});

const peers = (
	asked: CloudDriveShare[],
	over: Partial<CloudDrivePeers> = {},
): CloudDrivePeers => ({
	settings: {
		enabled: true,
		adminApproval: false,
		updatedBy: null,
		updatedAt: null,
	},
	admin: false,
	me: ME,
	asked,
	ofMine: [],
	...over,
});

const wrap = (node: React.ReactNode) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			{node}
		</QueryClientProvider>,
	);

describe("sharedWithYou", () => {
	it("lists the active shares by owner, the entire drive first, and what each is of", () => {
		const list = incomingShares(
			peers([
				share({
					id: "1",
					owner: "z",
					ownerName: "zed",
					kind: "file",
					path: "a/b.txt",
				}),
				share({ id: "2", kind: "folder", path: "docs" }),
				share({ id: "3" }),
				share({ id: "4", state: "ended" }),
				share({ id: "5", owner: ME, ownerName: "me" }),
			]),
		);
		expect(list.map((s) => s.id)).toEqual(["3", "2", "1"]);
		expect(list.map(shareWhat)).toEqual([
			"entire Cloud Drive",
			"folder docs",
			"file b.txt",
		]);
		expect(
			incomingShares(
				peers([share({})], {
					settings: {
						enabled: false,
						adminApproval: false,
						updatedBy: null,
						updatedAt: null,
					},
				}),
			),
		).toEqual([]);
	});
});

describe("ShareDialog", () => {
	beforeEach(() => {
		vi.spyOn(PlatformAPI, "getCloudDriveConnections").mockResolvedValue({
			disconnected: [],
			older: [],
		});
	});

	it("shares only the selected item with a connected workspace, read-only by default", async () => {
		const user = userEvent.setup();
		vi.mocked(PlatformAPI.getCloudDriveConnections).mockResolvedValue({
			disconnected: [],
			older: [],
			workspaceConnections: [
				{
					workspaceId: "workspace-id",
					workspaceName: "dev",
					recipientId: "bob-id",
					recipientName: "bob",
					organizationId: "org",
				},
			],
		});
		vi.spyOn(PlatformAPI, "getCloudDrivePeople").mockResolvedValue({
			people: [],
		});
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			peers([], { admin: true }),
		);
		const send = vi
			.spyOn(PlatformAPI, "shareCloudDrive")
			.mockResolvedValue({ ...peers([]), share: share({}) });
		wrap(<ShareDialog path="selected.txt" kind="file" onClose={() => {}} />);
		await user.click(await screen.findByRole("button", { name: "With" }));
		await user.click(
			await screen.findByRole("checkbox", { name: "Workspace: bob/dev" }),
		);
		await user.click(screen.getByRole("button", { name: "Share" }));
		await waitFor(() =>
			expect(send).toHaveBeenCalledWith(
				"bob-id",
				"selected.txt",
				"read",
				"workspace-id",
			),
		);
	});
	it("selects all, clears all, and sends only the final checked recipients", async () => {
		const user = userEvent.setup();
		vi.spyOn(PlatformAPI, "getCloudDrivePeople").mockResolvedValue({
			people: [
				{ id: "ann-id", username: "ann", name: "" },
				{ id: "bob-id", username: "bob", name: "" },
			],
		});
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(peers([]));
		const send = vi
			.spyOn(PlatformAPI, "shareCloudDrive")
			.mockResolvedValue({ ...peers([]), share: share({}) });
		wrap(<ShareDialog path="selected.txt" kind="file" onClose={vi.fn()} />);
		await user.click(await screen.findByRole("button", { name: "With" }));
		await user.click(screen.getByRole("button", { name: "Select all" }));
		await user.click(screen.getByRole("button", { name: "Clear all" }));
		await user.click(screen.getByRole("checkbox", { name: "bob" }));
		await user.click(screen.getByRole("button", { name: "With" }));
		await user.click(screen.getByRole("button", { name: "Share" }));
		await waitFor(() =>
			expect(send).toHaveBeenCalledWith("bob-id", "selected.txt", "read"),
		);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("shares with every selected recipient and retries only failures", async () => {
		const user = userEvent.setup();
		vi.spyOn(PlatformAPI, "getCloudDrivePeople").mockResolvedValue({
			people: [
				{ id: "ann-id", username: "ann", name: "" },
				{ id: "bob-id", username: "bob", name: "" },
			],
		});
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(peers([]));
		const send = vi
			.spyOn(PlatformAPI, "shareCloudDrive")
			.mockResolvedValue({ ...peers([]), share: share({}) });
		send
			.mockResolvedValueOnce({ ...peers([]), share: share({}) })
			.mockRejectedValueOnce(new Error("Try again"));
		wrap(<ShareDialog path="selected.txt" kind="file" onClose={vi.fn()} />);
		await user.click(await screen.findByRole("button", { name: "With" }));
		await user.click(screen.getByRole("button", { name: "Select all" }));
		await user.click(screen.getByRole("button", { name: "With" }));
		await user.click(screen.getByRole("button", { name: "Share" }));
		await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		await user.click(screen.getByRole("button", { name: "Share" }));
		await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
		expect(send.mock.calls.map((call) => call[0])).toEqual([
			"ann-id",
			"bob-id",
			"bob-id",
		]);
	});

	it("revokes the selected existing grant without disconnecting the workspace", async () => {
		const user = userEvent.setup();
		const grant = share({
			owner: ME,
			path: "selected.txt",
			kind: "file",
			workspaceId: "workspace-id",
			workspaceName: "dev",
		});
		vi.spyOn(PlatformAPI, "getCloudDrivePeople").mockResolvedValue({
			people: [],
		});
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			peers([], { ofMine: [grant] }),
		);
		const revoke = vi
			.spyOn(PlatformAPI, "endCloudDriveShare")
			.mockResolvedValue({ ...peers([]), share: { ...grant, state: "ended" } });
		const disconnect = vi.spyOn(PlatformAPI, "setCloudDriveConnection");
		wrap(<ShareDialog path="selected.txt" kind="file" onClose={vi.fn()} />);
		await user.click(await screen.findByRole("button", { name: "Revoke" }));
		await waitFor(() => expect(revoke.mock.calls[0]?.[0]).toBe(grant.id));
		expect(disconnect).not.toHaveBeenCalled();
	});

	afterEach(() => vi.restoreAllMocks());

	it("shares a folder with a chosen user, read and write; lists whom it is shared with", async () => {
		const existing = share({
			id: "c".repeat(32),
			owner: ME,
			ownerName: "me",
			from: "ann-id",
			fromName: "ann",
			kind: "folder",
			path: "docs",
			by: "owner",
		});
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			peers([], { ofMine: [existing] }),
		);
		vi.spyOn(PlatformAPI, "getCloudDrivePeople").mockResolvedValue({
			people: [
				{ id: "ann-id", username: "ann", name: "" },
				{ id: "bob-id", username: "bob", name: "Bob B" },
			],
		});
		const send = vi.spyOn(PlatformAPI, "shareCloudDrive").mockResolvedValue({
			...peers([]),
			share: share({ owner: ME, from: "bob-id", fromName: "bob" }),
		});
		wrap(<ShareDialog path="docs" kind="folder" onClose={vi.fn()} />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "With" }));
		await user.click(
			await screen.findByRole("checkbox", { name: "Bob B (@bob)" }),
		);
		await user.click(screen.getByRole("button", { name: "With" }));
		await user.click(screen.getByLabelText(/Read and write/));
		await user.click(screen.getByRole("button", { name: "Share" }));
		await waitFor(() =>
			expect(send).toHaveBeenCalledWith("bob-id", "docs", "write"),
		);
	});
});
