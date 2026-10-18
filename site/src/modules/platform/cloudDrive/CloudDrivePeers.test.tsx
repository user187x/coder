import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import {
	type CloudDrivePeers,
	type CloudDriveShare,
	PlatformAPI,
} from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { CloudDrivePeersView, CloudDriveShareCard } from "./CloudDrivePeers";

const ANN = "3f0c2a52-7d7e-4c5b-9a3e-2f4b8c1d0e9a";
const BOB = "4a1d3b63-8e8f-4d6c-8b4f-3a5c9d2e1f0b";

const share = (over: Partial<CloudDriveShare> = {}): CloudDriveShare => ({
	id: "a".repeat(32),
	from: ANN,
	fromName: "ann",
	owner: BOB,
	ownerName: "bob",
	access: "write",
	asked: "write",
	state: "asked",
	askedAt: 1760000000,
	kind: "drive",
	path: "",
	by: "request",
	...over,
});

const peers = (over: Partial<CloudDrivePeers> = {}): CloudDrivePeers => ({
	settings: {
		enabled: true,
		adminApproval: true,
		updatedBy: null,
		updatedAt: null,
	},
	admin: false,
	me: BOB,
	asked: [],
	ofMine: [share()],
	...over,
});

const render = (ui: React.ReactNode) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
	);

describe("Cloud Drive sharing", () => {
	afterEach(() => vi.restoreAllMocks());

	it("a request's card lets its owner share it read only, read and write, or decline", async () => {
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(peers());
		const answer = vi
			.spyOn(PlatformAPI, "answerCloudDriveShare")
			.mockResolvedValue({
				...peers(),
				share: share({ state: "approval", access: "read" }),
			});
		render(<CloudDriveShareCard shareId={"a".repeat(32)} meId={BOB} />);
		const card = await screen.findByTestId("cloud-drive-share-card");
		expect(card.textContent).toContain("Your Cloud Drive for ann");
		expect(screen.getByTestId("share-accept-write")).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("share-accept-read"));
		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith("a".repeat(32), true, "read"),
		);
	});

	it("the requester's card shows the state, without answer buttons", async () => {
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			peers({ me: ANN, asked: [share({ state: "approval" })], ofMine: [] }),
		);
		render(<CloudDriveShareCard shareId={"a".repeat(32)} meId={ANN} />);
		const card = await screen.findByTestId("cloud-drive-share-card");
		expect(card.textContent).toContain("bob's Cloud Drive for you");
		expect(card.textContent).toContain("waiting for an admin's approval");
		expect(screen.queryByTestId("share-accept-read")).toBeNull();
	});

	it("admins turn it on and off, and approve what waits for them", async () => {
		const waiting = share({ state: "approval", access: "read" });
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			peers({
				admin: true,
				me: "admin",
				ofMine: [],
				waiting: [waiting],
				all: [waiting],
			}),
		);
		const save = vi
			.spyOn(PlatformAPI, "saveCloudDrivePeerSettings")
			.mockResolvedValue(peers({ admin: true }));
		const approve = vi
			.spyOn(PlatformAPI, "approveCloudDriveShare")
			.mockResolvedValue({
				...peers({ admin: true }),
				share: { ...waiting, state: "active" },
			});
		render(<CloudDrivePeersView />);
		fireEvent.click(await screen.findByTestId("share-approve"));
		await waitFor(() => expect(approve).toHaveBeenCalledWith(waiting.id, true));
		fireEvent.click(screen.getByTestId("peers-approval"));
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith({ adminApproval: false }),
		);
	});

	it("tells users who is not an admin that it is off", async () => {
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			peers({
				settings: {
					enabled: false,
					adminApproval: true,
					updatedBy: null,
					updatedAt: null,
				},
				ofMine: [],
			}),
		);
		render(<CloudDrivePeersView />);
		expect(
			await screen.findByText("Sharing between users is off"),
		).toBeInTheDocument();
		expect(screen.queryByTestId("peers-enabled")).toBeNull();
	});
});
