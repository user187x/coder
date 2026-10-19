import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import {
	type CloudDrivePeers,
	type CloudDriveShare,
	PlatformAPI,
} from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { CloudDriveShareCard } from "./CloudDrivePeers";
import { inspectShareHref, ShareApprovalButton } from "./ShareApprovalButton";

const ANN = "3f0c2a52-7d7e-4c5b-9a3e-2f4b8c1d0e9a";
const BOB = "4a1d3b63-8e8f-4d6c-8b4f-3a5c9d2e1f0b";
const ADMIN = "6c3f5d85-a0a1-4f8e-ad6b-5c7ebf4a3b2d";

const waiting = (over: Partial<CloudDriveShare> = {}): CloudDriveShare => ({
	id: "a".repeat(32),
	from: ANN,
	fromName: "ann",
	owner: BOB,
	ownerName: "bob",
	access: "read",
	asked: "read",
	state: "approval",
	askedAt: 1760000000,
	kind: "folder",
	path: "docs/plans",
	by: "owner",
	...over,
});

const adminView = (shares: CloudDriveShare[]): CloudDrivePeers => ({
	settings: {
		enabled: true,
		adminApproval: true,
		updatedBy: null,
		updatedAt: null,
	},
	admin: true,
	me: ADMIN,
	asked: [],
	ofMine: [],
	all: shares,
	waiting: shares.filter((s) => s.state === "approval"),
});

const wrap = (node: React.ReactNode) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>{node}</MemoryRouter>
		</QueryClientProvider>,
	);

describe("ShareApprovalButton (Admin › Accounts)", () => {
	afterEach(() => vi.restoreAllMocks());

	it("approves the one share waiting for an admin from either person's row, saying what it is", async () => {
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			adminView([waiting()]),
		);
		const approve = vi
			.spyOn(PlatformAPI, "approveCloudDriveShare")
			.mockResolvedValue({
				...adminView([waiting({ state: "active" })]),
				share: waiting({ state: "active" }),
			});
		wrap(<ShareApprovalButton user={{ id: ANN, username: "ann" }} />);
		const button = await screen.findByTestId("share-approval-approve");
		expect(button).toHaveAttribute(
			"title",
			"Approve: bob's folder docs/plans for ann (read only)",
		);
		fireEvent.click(button);
		await waitFor(() =>
			expect(approve).toHaveBeenCalledWith("a".repeat(32), true),
		);
	});

	it("is not there for an account with nothing waiting, nor for a member", async () => {
		const get = vi
			.spyOn(PlatformAPI, "getCloudDrivePeers")
			.mockResolvedValue(adminView([waiting()]));
		const { unmount } = wrap(
			<ShareApprovalButton
				user={{ id: "7d4e6f96-b1b2-4a9f-be7c-6d8fc05b4c3e", username: "eve" }}
			/>,
		);
		await waitFor(() => expect(get).toHaveBeenCalled());
		expect(screen.queryByTestId("share-approval-eve")).toBeNull();
		unmount();
		get.mockResolvedValue({ ...adminView([waiting()]), admin: false });
		wrap(<ShareApprovalButton user={{ id: ANN, username: "ann" }} />);
		await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
		expect(screen.queryByTestId("share-approval-ann")).toBeNull();
	});

	it("inspects the owner's drive at what is shared (a file's folder)", () => {
		expect(inspectShareHref(waiting())).toBe(
			`/workspaces?filter=owner%3Abob&cloudDrive=${BOB}&cloudDriveUser=bob&cloudDrivePath=docs%2Fplans`,
		);
		expect(
			inspectShareHref(waiting({ kind: "file", path: "docs/plan.md" })),
		).toContain("cloudDrivePath=docs");
		expect(
			inspectShareHref(waiting({ kind: "drive", path: "" })),
		).not.toContain("cloudDrivePath");
	});
});

describe("CloudDriveShareCard for an admin (the chat's approval message)", () => {
	afterEach(() => vi.restoreAllMocks());

	it("approves or denies in the message, and both names lead to their Cloud Drive", async () => {
		vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			adminView([waiting()]),
		);
		const approve = vi
			.spyOn(PlatformAPI, "approveCloudDriveShare")
			.mockResolvedValue({
				...adminView([waiting({ state: "denied" })]),
				share: waiting({ state: "denied" }),
			});
		wrap(<CloudDriveShareCard shareId={"a".repeat(32)} meId={ADMIN} />);
		const owner = await screen.findByTestId("cloud-drive-share-card-user-bob");
		expect(owner).toHaveAttribute(
			"href",
			`/workspaces?filter=owner%3Abob&cloudDrive=${BOB}&cloudDriveUser=bob&cloudDrivePath=docs%2Fplans`,
		);
		expect(
			screen.getByTestId("cloud-drive-share-card-user-ann"),
		).toHaveAttribute(
			"href",
			`/workspaces?filter=owner%3Aann&cloudDrive=${ANN}&cloudDriveUser=ann`,
		);
		fireEvent.click(screen.getByTestId("share-card-deny"));
		await waitFor(() =>
			expect(approve).toHaveBeenCalledWith("a".repeat(32), false),
		);
		expect(screen.getByTestId("share-card-approve")).toBeInTheDocument();
	});
});
