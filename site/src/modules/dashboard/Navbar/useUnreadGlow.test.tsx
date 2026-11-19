import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import * as chatStore from "#/modules/platform/chat/chatStore";
import { createTestQueryClient } from "#/testHelpers/renderHelpers";
import { useUnreadGlow } from "./useUnreadGlow";

afterEach(() => vi.restoreAllMocks());

const realSnapshot = chatStore.useChatSnapshot;

const glowWith = async ({
	unread,
	unreadChats = 0,
	prefs = {},
	dockMode = "bar",
}: {
	unread: number;
	unreadChats?: number;
	prefs?: Record<string, unknown>;
	dockMode?: string;
}) => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue(prefs);
	vi.spyOn(API, "getInboxNotifications").mockResolvedValue({
		notifications: [],
		unread_count: unread,
	});
	vi.spyOn(chatStore, "unreadTotal").mockReturnValue(unreadChats);
	vi.spyOn(chatStore, "useChatSnapshot").mockImplementation(() => ({
		...realSnapshot(),
		dockMode: dockMode as ReturnType<typeof realSnapshot>["dockMode"],
	}));
	const client = createTestQueryClient();
	const { result } = renderHook(() => useUnreadGlow(), {
		wrapper: ({ children }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
	await waitFor(() => expect(client.isFetching()).toBe(0));
	return result.current;
};

it("glows while notifications wait and the chat is folded to its bar", async () => {
	expect(await glowWith({ unread: 2 })).toEqual({
		chat: false,
		notifications: true,
	});
});

it("does not glow with nothing unread", async () => {
	expect(await glowWith({ unread: 0 })).toEqual({
		chat: false,
		notifications: false,
	});
});

it("does not glow while the chat is attached on screen", async () => {
	expect(await glowWith({ unread: 2, dockMode: "side" })).toEqual({
		chat: false,
		notifications: false,
	});
});

it("does not glow once the user turned it off", async () => {
	expect(
		await glowWith({ unread: 2, prefs: { settings_unread_glow: false } }),
	).toEqual({ chat: false, notifications: false });
});

it.each([
	{ unread: 0, notifications: false },
	{ unread: 2, notifications: true },
])(
	"keeps Chat distinct from notifications when the inbox has $unread unread",
	async ({ unread, notifications }) => {
		expect(await glowWith({ unread, unreadChats: 1 })).toEqual({
			chat: true,
			notifications,
		});
	},
);
