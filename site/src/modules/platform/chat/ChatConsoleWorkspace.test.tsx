import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import {
	MockChatPeer,
	MockChatSettings,
	MockOnlineChatUser,
} from "#/testHelpers/chat";
import { MockAccountCloudDrivePeers } from "#/testHelpers/cloudDriveShares";
import { render } from "#/testHelpers/renderHelpers";
import { ChatConsoleWorkspace } from "./ChatConsoleWorkspace";
import * as chatStore from "./chatStore";

afterEach(() => vi.restoreAllMocks());

it("keeps the retention draft across console tabs and saves it from Settings", async () => {
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
		MockAccountCloudDrivePeers,
	);
	vi.spyOn(PlatformAPI, "getChatSettings").mockResolvedValue(MockChatSettings);
	const save = vi
		.spyOn(PlatformAPI, "saveChatSettings")
		.mockResolvedValue({ ...MockChatSettings, keepDays: 45 });
	render(<ChatConsoleWorkspace place="card" />);
	await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
	const days = await screen.findByRole("spinbutton", {
		name: "Keep chats for (days)",
	});
	await userEvent.clear(days);
	await userEvent.type(days, "45");
	await userEvent.click(screen.getByRole("tab", { name: "Conversations" }));
	await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(save).toHaveBeenCalledWith({ keepDays: 45 }));
});

it("loads connection data on its tab and saves chat permissions inside Settings", async () => {
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
		MockAccountCloudDrivePeers,
	);
	vi.spyOn(PlatformAPI, "getChatSettings").mockResolvedValue(MockChatSettings);
	const pairs = vi
		.spyOn(PlatformAPI, "getChatPairs")
		.mockResolvedValue({ pairs: [], total: 0, offset: 0, limit: 25 });
	const save = vi
		.spyOn(PlatformAPI, "saveChatSettings")
		.mockResolvedValue({ ...MockChatSettings, discoverAll: true });
	render(<ChatConsoleWorkspace place="card" />);
	expect(pairs).not.toHaveBeenCalled();
	await userEvent.click(screen.getByRole("tab", { name: "Connections" }));
	await waitFor(() => expect(pairs).toHaveBeenCalledWith(0));
	await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
	await userEvent.click(
		await screen.findByRole("switch", { name: "Discover all users" }),
	);
	await waitFor(() => expect(save).toHaveBeenCalledWith({ discoverAll: true }));
});

it("opens a person's conversation in the console instead of the compact chat panel", async () => {
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
		MockAccountCloudDrivePeers,
	);
	vi.spyOn(PlatformAPI, "getPresence").mockResolvedValue({
		online: [MockOnlineChatUser],
		recent: [],
		idleSeconds: 30,
		generatedAt: "2026-10-25T12:00:05Z",
	});
	const select = vi
		.spyOn(chatStore, "selectInConsole")
		.mockImplementation(() => {});
	render(<ChatConsoleWorkspace place="card" />);
	await userEvent.click(screen.getByRole("tab", { name: "People" }));
	await userEvent.click(await screen.findByRole("button", { name: "Message" }));
	expect(select).toHaveBeenCalledWith(
		expect.objectContaining({ id: MockChatPeer.id }),
		true,
	);
});
