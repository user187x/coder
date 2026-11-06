import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import type * as ChatStore from "#/modules/platform/chat/chatStore";
import { setDockMode } from "#/modules/platform/chat/chatStore";
import { render } from "#/testHelpers/renderHelpers";
import { AdminNotesTray } from "./AdminNotesTray";

vi.mock("#/modules/platform/chat/chatStore", async (original) => ({
	...(await original<typeof ChatStore>()),
	setDockMode: vi.fn(),
}));

const placement = {
	top: 0,
	minTop: 0,
	maxTop: 400,
	maxHeight: 600,
	onMove: vi.fn(),
	onCommit: vi.fn(),
};

const renderTray = () =>
	render(
		<DropdownMenu defaultOpen>
			<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
			<DropdownMenuContent>
				<AdminNotesTray
					placement={placement}
					maxWidth={360}
					hidden={false}
					onElement={vi.fn()}
				/>
			</DropdownMenuContent>
		</DropdownMenu>,
	);

afterEach(() => vi.restoreAllMocks());

it("opens the chat side panel when chat is the handle's target", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		admin_notes_tray_target: "chat",
	});
	renderTray();
	await userEvent.click(
		await screen.findByRole("menuitem", { name: "Show chat" }),
	);
	expect(setDockMode).toHaveBeenCalledWith("side");
});

it("shows chat again before opening it when it was closed", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		admin_notes_tray_target: "chat",
		chat_hidden: true,
	});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockResolvedValue({ admin_notes_tray_target: "chat", chat_hidden: false });
	renderTray();
	await userEvent.click(
		await screen.findByRole("menuitem", { name: "Show chat" }),
	);
	await waitFor(() => expect(setDockMode).toHaveBeenCalledWith("side"));
	expect(save).toHaveBeenCalledWith({ chat_hidden: false });
});

it("saves Chat as the handle's target from its context menu", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockResolvedValue({ admin_notes_tray_target: "chat" });
	renderTray();
	await userEvent.pointer({
		keys: "[MouseRight]",
		target: await screen.findByRole("menuitem", { name: "Show admin notes" }),
	});
	await userEvent.click(
		await screen.findByRole("menuitemcheckbox", { name: "Chat" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({ admin_notes_tray_target: "chat" }),
	);
});
