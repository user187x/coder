import { waitFor } from "@testing-library/react";
import { PlatformAPI } from "#/api/platform";
import {
	getPlatformSnapshot,
	setBackground,
	setUserAvatar,
} from "#/contexts/platformBoot";
import { render } from "#/testHelpers/renderHelpers";
import { DashboardAddons } from "./DashboardAddons";

vi.mock("./chat/ChatDock", () => ({ ChatDock: () => null }));
vi.mock("./chat/useChatEnabled", () => ({ ChatGate: () => null }));
vi.mock("./panelAccent/PanelAccent", () => ({ PanelAccent: () => null }));
vi.mock("./screenShare/ScreenShareController", () => ({
	ScreenShareController: () => null,
}));

it("restores saved appearance when startup data is missing", async () => {
	const original = getPlatformSnapshot();
	const username = "appearance-test";
	const avatarUrl = "/saved-avatar.png";
	const background = {
		url: "/saved-background.png",
		kind: "image",
		opacity: 1,
		fit: "cover",
		layer: "under",
	} as const;
	try {
		setBackground("dashboard", null);
		setUserAvatar(username, null);
		vi.spyOn(PlatformAPI, "getMyAvatar").mockResolvedValue({
			available: true,
			set: true,
			url: avatarUrl,
			defaultUrl: null,
			username,
		});
		vi.spyOn(PlatformAPI, "getAvatarDefaults").mockResolvedValue({
			url: null,
			users: [],
		});
		vi.spyOn(PlatformAPI, "getDashboardBackground").mockResolvedValue({
			dashboard: background,
		});

		render(<DashboardAddons />);

		await waitFor(() => {
			const appearance = getPlatformSnapshot();
			expect(appearance.avatars[username]).toBe(avatarUrl);
			expect(appearance.backgrounds.dashboard).toEqual(background);
		});
	} finally {
		setBackground("dashboard", original.backgrounds.dashboard ?? null);
		setUserAvatar(username, original.avatars[username] ?? null);
		vi.restoreAllMocks();
	}
});
