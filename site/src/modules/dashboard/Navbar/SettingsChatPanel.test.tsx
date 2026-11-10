import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PlatformAPI } from "#/api/platform";
import { ScreenShareAPI } from "#/api/screenShare";
import {
	closePanelView,
	useChatSnapshot,
} from "#/modules/platform/chat/chatStore";
import {
	MockChatPeer,
	MockChatPerson,
	MockChatState,
} from "#/testHelpers/chat";
import { render } from "#/testHelpers/renderHelpers";
import { MockScreenShare } from "#/testHelpers/screenShare";
import { SettingsChatPanel } from "./SettingsChatPanel";

beforeEach(() => {
	act(() => closePanelView());
	vi.spyOn(PlatformAPI, "getChatState").mockResolvedValue({
		...MockChatState,
		me: { ...MockChatState.me, admin: true },
	});
	vi.spyOn(PlatformAPI, "pollChat").mockReturnValue(new Promise(() => {}));
	vi.spyOn(PlatformAPI, "getChatPeople").mockResolvedValue({
		enabled: true,
		people: [MockChatPerson],
	});
	vi.spyOn(PlatformAPI, "getChatMessages").mockResolvedValue({
		messages: [],
		readUpTo: 0,
	});
	vi.spyOn(PlatformAPI, "markChatRead").mockResolvedValue({ ok: true });
	vi.spyOn(PlatformAPI, "chatActivity").mockResolvedValue({ ok: true });
	vi.spyOn(ScreenShareAPI, "state").mockResolvedValue({
		sessions: [],
		iceServers: [],
		canShare: true,
	});
});

afterEach(() => vi.restoreAllMocks());

const openMenu = async () => {
	render(<SettingsChatPanel onClose={vi.fn()} />);
	await userEvent.pointer({
		target: await screen.findByRole("button", { name: /Alex.*online/ }),
		keys: "[MouseRight]",
	});
};

it("requests dashboard control through the authenticated API", async () => {
	const request = vi
		.spyOn(ScreenShareAPI, "update")
		.mockResolvedValue({ session: MockScreenShare });
	await openMenu();
	await userEvent.click(
		screen.getByRole("menuitem", { name: "Request Control" }),
	);
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith({
			action: "request_peer",
			mode: "dashboard",
			peer: MockChatPeer.id,
		}),
	);
});

it("opens the selected conversation and the attachment picker without sending the draft", async () => {
	const pick = vi.spyOn(HTMLInputElement.prototype, "click");
	const upload = vi.spyOn(PlatformAPI, "uploadChatFile").mockResolvedValue({
		upload: "upload-one",
		name: "notes.txt",
		size: 5,
		type: "text/plain",
	});
	const send = vi.spyOn(PlatformAPI, "sendChatMessage");
	await openMenu();
	await userEvent.click(screen.getByRole("menuitem", { name: "Send file" }));
	expect(pick).toHaveBeenCalledOnce();
	const file = new File(["hello"], "notes.txt", { type: "text/plain" });
	await userEvent.upload(screen.getByLabelText("Choose attachment"), file);
	await waitFor(() =>
		expect(upload).toHaveBeenCalledWith(
			MockChatPeer.id,
			file,
			expect.any(Function),
			expect.any(AbortSignal),
		),
	);
	expect(send).not.toHaveBeenCalled();
});

it("opens Chat in the compact panel", async () => {
	let selected: string | undefined;
	const Observe = () => {
		selected = useChatSnapshot().panelView?.peer.id;
		return null;
	};
	render(<Observe />);
	await openMenu();
	await userEvent.click(screen.getByRole("menuitem", { name: "Chat" }));
	expect(selected).toBe(MockChatPeer.id);
});

it("sends force focus only after composing and submitting a message", async () => {
	const send = vi
		.spyOn(PlatformAPI, "sendChatMessage")
		.mockResolvedValue({ message: MockChatState.conversations[0].last });
	await openMenu();
	await userEvent.click(screen.getByRole("menuitem", { name: "Force focus" }));
	expect(send).not.toHaveBeenCalled();
	const dialog = within(
		await screen.findByRole("dialog", { name: "Forced Focus: Alex" }),
	);
	await userEvent.type(
		dialog.getByRole("textbox", { name: "Message" }),
		"Please review your workspace.",
	);
	await userEvent.click(
		dialog.getByRole("button", { name: "Send with Forced Focus" }),
	);
	await waitFor(() =>
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				to: MockChatPeer.id,
				text: "Please review your workspace.",
				focus: true,
			}),
		),
	);
});

it("expands over the menu and restores from its header", async () => {
	const onExpandedChange = vi.fn();
	const Expandable = () => {
		const [expanded, setExpanded] = useState(false);
		return (
			<SettingsChatPanel
				onClose={vi.fn()}
				expanded={expanded}
				onExpandedChange={(next) => {
					onExpandedChange(next);
					setExpanded(next);
				}}
			/>
		);
	};
	render(<Expandable />);
	await userEvent.click(
		await screen.findByRole("button", { name: "Expand quick chat" }),
	);
	expect(onExpandedChange).toHaveBeenLastCalledWith(true);
	await userEvent.click(
		screen.getByRole("button", { name: "Restore quick chat" }),
	);
	expect(onExpandedChange).toHaveBeenLastCalledWith(false);
});

it("turns the Settings chevron's unread glow off from its header dimple", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (changes) => changes);
	render(<SettingsChatPanel onClose={vi.fn()} />);
	const dimple = await screen.findByRole("button", {
		name: "Glow the Settings chevron for unread messages",
	});
	await waitFor(() => expect(dimple).toBeEnabled());
	await userEvent.click(dimple);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({ settings_unread_glow: false }),
	);
});
