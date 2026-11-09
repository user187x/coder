import { screen, waitFor } from "@testing-library/react";
import { API } from "#/api/api";
import { render } from "#/testHelpers/renderHelpers";
import { SettingsNotificationBadge } from "./SettingsNotificationBadge";

beforeEach(() => {
	vi.spyOn(API, "getInboxNotifications").mockResolvedValue({
		notifications: [],
		unread_count: 3,
	});
});

afterEach(() => vi.restoreAllMocks());

describe("SettingsNotificationBadge", () => {
	it("counts the unread inbox messages while the navbar has no bell", async () => {
		render(<SettingsNotificationBadge />);
		expect(
			await screen.findByRole("img", { name: /^3 Settings notifications/ }),
		).toHaveAccessibleName(/3 unread inbox messages/);
	});

	it("leaves the inbox to the notification bell when the navbar shows it", async () => {
		render(<SettingsNotificationBadge bellShown />);
		await waitFor(() =>
			expect(
				screen.queryByRole("img", { name: /Settings notifications/ }),
			).toBeNull(),
		);
		expect(API.getInboxNotifications).not.toHaveBeenCalled();
	});
});
