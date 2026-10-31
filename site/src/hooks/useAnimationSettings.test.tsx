import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { bannerKey } from "#/api/queries/platform";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import {
	ANIMATION_PARTS,
	animated,
	setAnimationPart,
	setAnimationsEnabled,
	useAnimationSettings,
} from "#/hooks/useAnimationSettings";
import { AnimationsToggleItem } from "#/modules/dashboard/Navbar/UserDropdown/AnimationsToggleItem";
import {
	setGraphEvery,
	useGraphEvery,
} from "#/modules/resources/metricGraphSettings";
import { MockBanner } from "#/testHelpers/platform";
import { render } from "#/testHelpers/renderHelpers";

const observed = vi.fn();
const Probe = () => {
	const settings = useAnimationSettings();
	observed({
		...Object.fromEntries(
			ANIMATION_PARTS.map((part) => [part, animated(settings, part)]),
		),
		graphs: useGraphEvery(),
	});
	return null;
};
const Menu = () => (
	<>
		<DropdownMenu open>
			<DropdownMenuTrigger>Menu</DropdownMenuTrigger>
			<DropdownMenuContent>
				<AnimationsToggleItem />
			</DropdownMenuContent>
		</DropdownMenu>
		<Probe />
	</>
);

beforeEach(() =>
	vi.spyOn(PlatformAPI, "getBanner").mockResolvedValue(MockBanner),
);
afterEach(() => {
	act(() => {
		setAnimationsEnabled(true);
		for (const part of ANIMATION_PARTS) setAnimationPart(part, true);
		setGraphEvery(1);
	});
	vi.restoreAllMocks();
	observed.mockClear();
});

it("remembers each animation preference when the master switch overrides it", async () => {
	const user = userEvent.setup();
	render(<Menu />);
	await user.click(screen.getByRole("menuitem", { name: /Animations/ }));
	await user.click(
		screen.getByRole("menuitemcheckbox", { name: /Announcement animations/ }),
	);
	expect(observed).toHaveBeenLastCalledWith({
		effects: true,
		gifs: true,
		background: true,
		announcement: false,
		graphs: 1,
	});
	await user.click(
		screen.getByRole("menuitemcheckbox", { name: /All animations/ }),
	);
	expect(observed).toHaveBeenLastCalledWith({
		effects: false,
		gifs: false,
		background: false,
		announcement: false,
		graphs: "off",
	});
	expect(
		JSON.parse(localStorage.getItem("coder-ui-animations-parts") ?? "{}"),
	).toEqual({
		effects: true,
		gifs: true,
		background: true,
		announcement: false,
	});
	await user.click(
		screen.getByRole("menuitemcheckbox", { name: /All animations/ }),
	);
	expect(observed).toHaveBeenLastCalledWith({
		effects: true,
		gifs: true,
		background: true,
		announcement: false,
		graphs: 1,
	});
	await user.click(
		screen.getByRole("menuitemcheckbox", { name: /Live graphs/ }),
	);
	expect(observed.mock.lastCall?.[0].graphs).toBe("off");
});

it("prevents a personal override of an administrator restriction and retains the user's preference", async () => {
	const user = userEvent.setup();
	const restricted = { ...MockBanner, animationsDisabled: true };
	vi.mocked(PlatformAPI.getBanner).mockResolvedValue(restricted);
	const { queryClient } = render(<Menu />);
	act(() => queryClient.setQueryData(bannerKey, restricted));
	await user.click(screen.getByRole("menuitem", { name: /Animations/ }));
	await user.click(
		screen.getByRole("menuitemcheckbox", { name: /Announcement animations/ }),
	);
	expect(observed.mock.lastCall?.[0].announcement).toBe(true);
	vi.mocked(PlatformAPI.getBanner).mockResolvedValue(MockBanner);
	act(() => queryClient.setQueryData(bannerKey, MockBanner));
	await user.click(
		screen.getByRole("menuitemcheckbox", { name: /Announcement animations/ }),
	);
	expect(observed.mock.lastCall?.[0].announcement).toBe(false);
});
