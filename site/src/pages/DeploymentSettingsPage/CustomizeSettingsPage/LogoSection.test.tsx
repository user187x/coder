import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { getPlatformSnapshot, setLogoURL } from "#/contexts/platformBoot";
import { MockLogo } from "#/testHelpers/platform";
import { render } from "#/testHelpers/renderHelpers";
import { LogoSection } from "./CustomizeSettingsPage";

afterEach(() => {
	vi.restoreAllMocks();
	setLogoURL(null);
});
it("persists logo visibility without resetting the saved image", async () => {
	vi.spyOn(PlatformAPI, "getLogo").mockResolvedValue(MockLogo);
	const visibility = vi
		.spyOn(PlatformAPI, "setLogoEnabled")
		.mockImplementation(async (enabled) => {
			vi.mocked(PlatformAPI.getLogo).mockResolvedValue({
				...MockLogo,
				enabled,
			});
			return { ok: true, enabled };
		});
	const reset = vi.spyOn(PlatformAPI, "resetLogo");
	const user = userEvent.setup();
	render(<LogoSection />);
	await user.click(await screen.findByRole("switch", { name: /Show logo/ }));
	await waitFor(() => expect(visibility).toHaveBeenCalledWith(false));
	await waitFor(() => expect(getPlatformSnapshot().logoEnabled).toBe(false));
	expect(reset).not.toHaveBeenCalled();
	await user.click(screen.getByRole("switch", { name: /Show logo/ }));
	await waitFor(() => expect(getPlatformSnapshot().logoEnabled).toBe(true));
});
