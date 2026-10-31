import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { render } from "#/testHelpers/renderHelpers";
import { SettingsDrawerHandle } from "./SettingsDrawerHandle";

it.each(["Admin notes", "Resource shortcuts"])(
	"left-drags %s while locked, commits its bounded position, and keeps visibility independent",
	async (label) => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const onCommit = vi.fn();
		const toggle = vi.fn();
		const lock = vi.fn();
		render(
			<DropdownMenu defaultOpen>
				<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
				<DropdownMenuContent>
					<SettingsDrawerHandle
						label={label}
						expanded={false}
						locked
						busy={false}
						controls="notes"
						position={{ x: 0, y: 0 }}
						limits={{ minY: -200, maxY: 100 }}
						onChange={onChange}
						onCommit={onCommit}
						toggle={toggle}
						lock={lock}
					/>
				</DropdownMenuContent>
			</DropdownMenu>,
		);
		const grip = screen.getByRole("menuitem", {
			name: `Show ${label.toLowerCase()}`,
		});
		for (const [y, result] of [
			[300, -100],
			[-900, -200],
			[2000, 100],
		]) {
			await user.pointer([
				{ target: grip, keys: "[MouseLeft>]", coords: { x: 900, y: 400 } },
				{ target: grip, coords: { x: 740, y } },
				{ keys: "[/MouseLeft]", coords: { x: 740, y } },
			]);
			expect(onCommit).toHaveBeenLastCalledWith({ x: 0, y: result });
		}
		expect(toggle).not.toHaveBeenCalled();
		expect(lock).not.toHaveBeenCalled();
		onCommit.mockClear();
		await user.pointer([
			{ target: grip, keys: "[MouseMiddle>]", coords: { x: 900, y: 400 } },
			{ target: grip, coords: { x: 740, y: 300 } },
			{ keys: "[/MouseMiddle]" },
		]);
		await user.click(grip);
		expect(toggle).not.toHaveBeenCalled();
		expect(onCommit).not.toHaveBeenCalled();
		await user.dblClick(grip);
		expect(toggle).toHaveBeenCalledTimes(1);
		await user.click(
			screen.getByRole("menuitemcheckbox", {
				name: `Unlock ${label.toLowerCase()} (top dimple)`,
			}),
		);
		expect(lock).toHaveBeenLastCalledWith(null);
		await user.pointer({ target: grip, keys: "[MouseRight]" });
		await user.click(screen.getByRole("menuitem", { name: "Lock open" }));
		expect(lock).toHaveBeenLastCalledWith(true);
		await user.pointer({ target: grip, keys: "[MouseRight]" });
		await user.click(screen.getByRole("menuitem", { name: "Lock closed" }));
		expect(lock).toHaveBeenLastCalledWith(false);
		grip.focus();
		await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
		expect(onCommit).toHaveBeenLastCalledWith({ x: 0, y: -20 });
		await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
		expect(lock).toHaveBeenLastCalledWith(false);
	},
);
