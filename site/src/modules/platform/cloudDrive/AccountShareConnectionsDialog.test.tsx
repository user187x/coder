import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { type CloudDriveShare, PlatformAPI } from "#/api/platform";
import {
	MockAccountCloudDrivePeers,
	MockAccountCloudDriveShare,
} from "#/testHelpers/cloudDriveShares";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AccountShareCables } from "./AccountShareCables";

const renderConnections = () =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<AccountShareCables
				userIds={[
					MockAccountCloudDriveShare.owner,
					MockAccountCloudDriveShare.from,
				]}
			>
				<div>Accounts</div>
			</AccountShareCables>
		</QueryClientProvider>,
	);

afterEach(() => vi.restoreAllMocks());

it("lets admins disconnect and restore the same account grant", async () => {
	let peers = MockAccountCloudDrivePeers;
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockImplementation(
		async () => peers,
	);
	const change = vi
		.spyOn(PlatformAPI, "setCloudDriveShareConnection")
		.mockImplementation(async (_id, connected) => {
			const share: CloudDriveShare = {
				...MockAccountCloudDriveShare,
				state: connected ? "active" : "ended",
				reconnectable: !connected,
			};
			peers = { ...peers, all: [share] };
			return { ...peers, share };
		});
	renderConnections();
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", { name: "Manage connections" }),
	);
	await user.click(screen.getByRole("button", { name: /^Disconnect ann's/ }));
	await waitFor(() =>
		expect(change).toHaveBeenCalledExactlyOnceWith(
			MockAccountCloudDriveShare.id,
			false,
		),
	);
	await user.click(
		await screen.findByRole("button", { name: /^Connect ann's/ }),
	);
	await waitFor(() =>
		expect(change).toHaveBeenLastCalledWith(
			MockAccountCloudDriveShare.id,
			true,
		),
	);
});

it("leaves sharing disabled until an administrator enables it", async () => {
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue({
		...MockAccountCloudDrivePeers,
		settings: { ...MockAccountCloudDrivePeers.settings, enabled: false },
		all: [
			{ ...MockAccountCloudDriveShare, state: "ended", reconnectable: true },
		],
	});
	const change = vi.spyOn(PlatformAPI, "setCloudDriveShareConnection");
	renderConnections();
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", { name: "Manage connections" }),
	);
	await user.click(screen.getByRole("button", { name: /^Connect ann's/ }));
	expect(change).not.toHaveBeenCalled();
});
