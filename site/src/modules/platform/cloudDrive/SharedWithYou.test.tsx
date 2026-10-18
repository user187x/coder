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
import { ShareDialog } from "./ShareDialog";
import { SharedWithYou } from "./SharedWithYou";
import { incomingShares, openPath, room, shareLink } from "./sharedWithYou";

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

describe("sharedWithYou", () => {
	it("lists the active shares by owner, the entire drive first; where they are and open", () => {
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
		expect(list.map(shareLink)).toEqual([
			"~/cloud-drive-shared/greg",
			"~/cloud-drive-shared/greg/docs",
			"~/cloud-drive-shared/zed/b.txt",
		]);
		expect(list.map(openPath)).toEqual(["", "docs", "a"]);
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

	it("glows with a plus while something is shared; its window lists a card each, and opens one", async () => {
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			peers([
				share({ id: "a".repeat(32) }),
				share({
					id: "b".repeat(32),
					access: "write",
					kind: "folder",
					path: "docs/plans",
				}),
			]),
		);
		const glance = vi
			.spyOn(PlatformAPI, "getCloudDriveGlance")
			.mockImplementation(async (_drive, id) => ({
				files: id?.startsWith("b") ? 1 : 2,
				usedBytes: 2048,
				newest: [{ path: "docs/plans/q4.md", size: 2048, modified: null }],
				owner: { id: "greg-id", username: "greg", name: "Greg G" },
			}));
		const onOpen = vi.fn();
		wrap(<SharedWithYou onOpen={onOpen} />);
		const icon = await screen.findByTestId("cloud-drive-shares");
		await waitFor(() => expect(icon).toHaveAttribute("data-shares", "true"));
		expect(icon).toHaveAttribute("data-access", "write");
		expect(icon.querySelector(".cd-shares-plus")).not.toBeNull();
		expect(icon).toHaveAccessibleName("Shared with you: 2 shares. Show them");

		fireEvent.click(icon);
		const list = await screen.findByTestId("cloud-drive-shares-list");
		const cards = within(list).getAllByRole("article");
		expect(cards).toHaveLength(2);
		expect(cards[1]).toHaveTextContent("shares their folder plans with you");
		expect(cards[1]).toHaveTextContent("Read and write");
		await waitFor(() => expect(cards[1]).toHaveTextContent("2 KB in 1 file"));
		expect(cards[1]).toHaveTextContent("q4.md");
		expect(cards[1]).toHaveTextContent("~/cloud-drive-shared/greg/plans");
		expect(glance).toHaveBeenCalledWith("greg-id", "b".repeat(32));

		fireEvent.click(
			within(cards[1]).getByTestId("cloud-drive-share-card-open"),
		);
		expect(onOpen).toHaveBeenCalledWith("greg-id", "docs/plans");
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

describe("ShareDialog", () => {
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
		const dialog = await screen.findByTestId("cloud-drive-share-dialog");
		expect(dialog).toHaveTextContent("Share the folder docs");
		expect(
			await within(dialog).findByTestId("cloud-drive-share-dialog-existing"),
		).toHaveTextContent("ann · read only · shared");
		expect(within(dialog).getByTestId("share-send")).toBeDisabled();
		// ann has it already: only bob to choose
		fireEvent.click(within(dialog).getByTestId("share-to"));
		const options = await screen.findAllByRole("option");
		expect(options.map((o) => o.textContent)).toEqual(["Bob B (@bob)"]);
		fireEvent.click(options[0]);
		fireEvent.click(within(dialog).getByLabelText(/Read and write/));
		fireEvent.click(within(dialog).getByTestId("share-send"));
		await waitFor(() =>
			expect(send).toHaveBeenCalledWith("bob-id", "docs", "write"),
		);
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

	it("counts an entire drive shared read and write in, striped apart on the bar's own line", async () => {
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
	});
});
