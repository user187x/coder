import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
