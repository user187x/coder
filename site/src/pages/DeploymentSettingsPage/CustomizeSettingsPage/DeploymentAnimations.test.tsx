import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { DEFAULT_ANIMATION_POLICY } from "#/hooks/useAnimationSettings";
import { render } from "#/testHelpers/renderHelpers";
import { DeploymentAnimations } from "./DeploymentAnimations";

afterEach(() => vi.restoreAllMocks());

it("saves only the selected deployment animation category", async () => {
	vi.spyOn(PlatformAPI, "getAnimationPolicy").mockResolvedValue(
		DEFAULT_ANIMATION_POLICY,
	);
	const save = vi
		.spyOn(PlatformAPI, "setAnimationPolicy")
		.mockResolvedValue({ ...DEFAULT_ANIMATION_POLICY, gifs: false });
	const user = userEvent.setup();
	render(<DeploymentAnimations />);
	await user.click(
		await screen.findByRole("switch", { name: "Animated GIFs" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({ part: "gifs", enabled: false }),
	);
});
