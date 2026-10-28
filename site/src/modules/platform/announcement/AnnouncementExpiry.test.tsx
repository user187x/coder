import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockBanner } from "#/testHelpers/platform";
import { AnnouncementExpiryNotice } from "./AnnouncementExpiry";

const banner = {
	...MockBanner,
	enabled: true,
	countdown: "2020-01-01T00:00:00Z",
};
beforeEach(() => localStorage.clear());

it.each(["pointerdown", "keydown"])(
	"acknowledges shaking on %s",
	async (event) => {
		const user = userEvent.setup();
		const { unmount } = render(
			<AnnouncementExpiryNotice
				banner={{ ...banner, countdownAction: "shake" }}
				userId="test"
			/>,
		);
		if (event === "keydown") await user.keyboard("a");
		else await user.click(document.body);
		expect(localStorage.getItem("coder:announcement-expiry:test")).toBe(
			`${banner.id}:${banner.countdown}:shake`,
		);
		unmount();
	},
);

it("requires explicit dismissal for focus", async () => {
	const user = userEvent.setup();
	const { unmount } = render(
		<AnnouncementExpiryNotice
			banner={{ ...banner, countdownAction: "focus" }}
			userId="test"
		/>,
	);
	await user.keyboard("{Escape}");
	expect(localStorage.getItem("coder:announcement-expiry:test")).toBeNull();
	await user.click(screen.getByRole("button", { name: "Dismiss" }));
	expect(localStorage.getItem("coder:announcement-expiry:test")).toBe(
		`${banner.id}:${banner.countdown}:focus`,
	);
	unmount();
});

it("does not acknowledge an unexpired timer", async () => {
	const user = userEvent.setup();
	const { unmount } = render(
		<AnnouncementExpiryNotice
			banner={{
				...banner,
				countdown: "2099-01-01T00:00:00Z",
				countdownAction: "shake",
			}}
			userId="test"
		/>,
	);
	await user.keyboard("a");
	expect(localStorage.getItem("coder:announcement-expiry:test")).toBeNull();
	unmount();
});
