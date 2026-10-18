import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import {
	type CloudDrivePeers,
	type CloudDriveShare,
	PlatformAPI,
	type SafeSummary,
} from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { CloudDrive } from "./CloudDrive";
import { SharedWithYou } from "./SharedWithYou";
import { openPath, room, sharedDrives } from "./sharedWithYou";

const ME = "me-id";
const GB = 1024 ** 3;

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

const peers = (asked: CloudDriveShare[], enabled = true): CloudDrivePeers => ({
	settings: { enabled, adminApproval: false, updatedBy: null, updatedAt: null },
	admin: false,
	me: ME,
	asked,
	ofMine: [],
});

const summary: SafeSummary = {
	enabled: true,
	mountPath: "/home/coder/cloud-drive",
	usedBytes: 1 * GB,
	files: 3,
	quotaBytes: 10 * GB,
	maxUploadBytes: 5 * GB,
	volume: "ready",
};

const wrap = (node: React.ReactNode) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			{node}
		</QueryClientProvider>,
	);

describe("sharedDrives", () => {
	it("is one per owner, by name: an entire drive with the wider access of two, parts with their first, its access and how many more", () => {
		const out = sharedDrives(
			peers([
				share({
					id: "2",
					owner: "zed",
					ownerName: "zed",
					kind: "file",
					path: "z/notes.txt",
					access: "write",
				}),
				share({
					id: "1",
					owner: "zed",
					ownerName: "zed",
					kind: "folder",
					path: "docs",
				}),
				share({
					id: "3",
					owner: "ann",
					ownerName: "ann",
					kind: "folder",
					path: "a",
				}),
				share({ id: "4", owner: "ann", ownerName: "ann" }),
				share({ id: "5", owner: "ann", ownerName: "ann", access: "write" }),
				share({ id: "6", owner: "bob", ownerName: "bob", state: "ended" }),
				share({ id: "7", owner: ME, ownerName: "me" }),
			]),
		);
		expect(out).toEqual([
			{ owner: "ann", ownerName: "ann", access: "write" },
			{
				owner: "zed",
				ownerName: "zed",
				access: "write",
				part: {
					id: "1",
					kind: "folder",
					path: "docs",
					access: "read",
					more: 1,
				},
			},
		]);
		expect(sharedDrives(peers([share({})], false))).toEqual([]);
		expect(openPath({ kind: "folder", path: "a/b" })).toBe("a/b");
		expect(openPath({ kind: "file", path: "a/b.txt" })).toBe("a");
	});

	it("counts the room of entire drives shared read and write", () => {
		expect(
			room({
				...summary,
				shared: [
					{
						owner: "g",
						ownerName: "greg",
						quotaBytes: 10 * GB,
						usedBytes: 2 * GB,
					},
					{ owner: "s", ownerName: "src", quotaBytes: null, usedBytes: 1 },
				],
			}),
		).toEqual({
			usedBytes: 3 * GB,
			quotaBytes: 20 * GB,
			parts: [
				{ owner: "", ownerName: "", usedBytes: GB, quotaBytes: 10 * GB },
				{
					owner: "g",
					ownerName: "greg",
					usedBytes: 2 * GB,
					quotaBytes: 10 * GB,
				},
			],
		});
		expect(room({ ...summary, quotaBytes: null })).toBeNull();
	});
});

describe("SharedWithYou", () => {
	afterEach(() => vi.restoreAllMocks());

	it("glows with a plus while something is shared; its window a card per owner, a part's own access, Open on it", async () => {
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			peers([
				share({ id: "a".repeat(32) }),
				share({
					id: "b".repeat(32),
					owner: "zed-id",
					ownerName: "zed",
					kind: "folder",
					path: "docs/plans",
				}),
				share({
					id: "c".repeat(32),
					owner: "zed-id",
					ownerName: "zed",
					kind: "file",
					path: "notes.txt",
					access: "write",
				}),
			]),
		);
		const glance = vi
			.spyOn(PlatformAPI, "getCloudDriveGlance")
			.mockImplementation(async (drive, id) => ({
				files: id ? 1 : 2,
				usedBytes: 2048,
				newest: [{ path: "docs/plans/q4.md", size: 2048, modified: null }],
				owner: {
					id: drive,
					username: drive === "zed-id" ? "zed" : "greg",
					name: "",
				},
			}));
		const onOpen = vi.fn();
		wrap(<SharedWithYou onOpen={onOpen} />);
		const icon = await screen.findByTestId("cloud-drive-shares");
		await waitFor(() => expect(icon).toHaveAttribute("data-shares", "true"));
		expect(icon).toHaveAttribute("data-access", "write");
		expect(icon.querySelector(".cd-shares-plus")).not.toBeNull();
		expect(icon).toHaveAccessibleName(
			"Shared with you: 2 Cloud Drives. Show them",
		);

		fireEvent.click(icon);
		const list = await screen.findByTestId("cloud-drive-shares-list");
		const cards = within(list).getAllByRole("article");
		expect(cards).toHaveLength(2);
		expect(cards[0]).toHaveTextContent("shares their Cloud Drive with you");
		expect(cards[0]).toHaveTextContent("~/cloud-drive-shared/greg from");
		// zed's: only parts - the first (docs/plans), how many more, and its own access (read only)
		expect(cards[1]).toHaveTextContent(
			"shares their folder plans (and 1 more) with you",
		);
		expect(
			within(cards[1]).getByTestId("cloud-drive-share-card-access"),
		).toHaveTextContent("Read only");
		await waitFor(() => expect(cards[1]).toHaveTextContent("2 KB in 1 file"));
		expect(cards[1]).toHaveTextContent("~/cloud-drive-shared/zed/plans");
		expect(glance).toHaveBeenCalledWith("zed-id", "b".repeat(32));
		expect(glance).toHaveBeenCalledWith("greg-id", undefined);

		fireEvent.click(
			within(cards[1]).getByTestId("cloud-drive-share-card-open"),
		);
		expect(onOpen).toHaveBeenCalledWith("zed-id", "docs/plans");
	});

	it("is a plain cloud while nothing is shared", async () => {
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(peers([]));
		wrap(<SharedWithYou onOpen={vi.fn()} />);
		const icon = await screen.findByTestId("cloud-drive-shares");
		await waitFor(() =>
			expect(icon).toHaveAccessibleName("Shared with you: nothing yet"),
		);
		expect(icon).not.toHaveAttribute("data-shares");
		expect(icon.querySelector(".cd-shares-plus")).toBeNull();
	});
});

describe("CloudDrive's container", () => {
	beforeEach(() => {
		document.documentElement.dataset.animations = "off";
	});
	afterEach(() => {
		delete document.documentElement.dataset.animations;
		vi.restoreAllMocks();
	});

	it("counts an entire drive shared read and write in, striped apart on the bar's own line; its cloud a place of its own", async () => {
		vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue({
			...summary,
			shared: [
				{
					owner: "greg-id",
					ownerName: "greg",
					quotaBytes: 10 * GB,
					usedBytes: 0,
				},
			],
		});
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			peers([share({ access: "write" })]),
		);
		wrap(<CloudDrive workspaceIds={[]} />);
		const button = await screen.findByTestId("cloud-drive");
		expect(screen.getByTestId("cloud-drive-usage")).toHaveTextContent(
			"1 GB of 20 GB",
		);
		const bar = screen.getByTestId("cloud-drive-capacity-bar");
		expect(within(bar).getByTestId("cloud-drive-fill")).toHaveAttribute(
			"aria-valuenow",
			"10",
		);
		expect(within(bar).getByTestId("cloud-drive-fill-shared-greg")).toHaveClass(
			"cd-capacity-shared",
		);
		expect(screen.getByTestId("cloud-drive-shared-room")).toHaveTextContent(
			"+10 GB shared",
		);
		expect(button).toHaveAccessibleName(
			/Cloud Drive: 1 GB of 20 GB used, 10 GB of it shared with you/,
		);
		// two places to click: the leading cloud is not the button
		expect(button.contains(screen.getByTestId("cloud-drive-shares"))).toBe(
			false,
		);
		expect(screen.queryByTestId("shared-drive-clouds")).toBeNull();
	});
});
