import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { EditableTunnelCable } from "./EditableTunnelCable";
import type { TunnelRoute } from "./tunnelRouting";

it("adds, moves and removes a bend without opening or changing the connection", async () => {
	const user = userEvent.setup();
	const changed = vi.fn();
	const opened = vi.fn();
	const Harness = () => {
		const [route, setRoute] = useState<TunnelRoute>({
			points: [],
			orthogonal: false,
		});
		return (
			<svg>
				<EditableTunnelCable
					from={{ x: 10, y: 20 }}
					to={{ x: 110, y: 20 }}
					defaultPath="M10 20 H110"
					label="Manage test tunnel"
					onOpen={opened}
					route={route}
					onChange={(value) => {
						setRoute(value);
						changed(value);
					}}
				/>
			</svg>
		);
	};
	render(<Harness />);
	await user.pointer({
		keys: "[MouseRight]",
		target: screen.getByRole("button", { name: "Manage test tunnel" }),
		coords: { clientX: 40, clientY: 35 },
	});
	await user.click(
		screen.getByRole("menuitem", { name: "Add bend point here" }),
	);
	expect(changed).toHaveBeenLastCalledWith({
		orthogonal: false,
		points: [{ id: expect.any(String), x: 30, y: 15 }],
	});
	const point = screen.getByRole("button", { name: "Bend point 1" });
	point.focus();
	await user.keyboard("{ArrowRight}");
	expect(changed).toHaveBeenLastCalledWith({
		orthogonal: false,
		points: [{ id: expect.any(String), x: 32, y: 15 }],
	});
	await user.pointer([
		{
			keys: "[MouseLeft>]",
			target: point,
			coords: { clientX: 42, clientY: 35 },
		},
		{ target: point, coords: { clientX: 60, clientY: 45 } },
		{ keys: "[/MouseLeft]", target: point },
	]);
	expect(changed).toHaveBeenLastCalledWith({
		orthogonal: false,
		points: [{ id: expect.any(String), x: 50, y: 25 }],
	});
	await user.pointer({ keys: "[MouseRight]", target: point });
	await user.click(screen.getByRole("menuitem", { name: "Remove bend point" }));
	expect(changed).toHaveBeenLastCalledWith({ orthogonal: false, points: [] });
	expect(opened).not.toHaveBeenCalled();
});

it("switches routing modes and resets visual changes", async () => {
	const user = userEvent.setup();
	const changed = vi.fn();
	render(
		<svg>
			<EditableTunnelCable
				from={{ x: 0, y: 0 }}
				to={{ x: 80, y: 40 }}
				defaultPath="M0 0 L80 40"
				label="Manage test tunnel"
				onOpen={vi.fn()}
				route={{ points: [], orthogonal: false }}
				onChange={changed}
			/>
		</svg>,
	);
	await user.pointer({
		keys: "[MouseRight]",
		target: screen.getByRole("button", { name: "Manage test tunnel" }),
	});
	await user.click(
		screen.getByRole("menuitem", { name: "Use right-angle routing" }),
	);
	expect(changed).toHaveBeenLastCalledWith({ points: [], orthogonal: true });
	await user.pointer({
		keys: "[MouseRight]",
		target: screen.getByRole("button", { name: "Manage test tunnel" }),
	});
	await user.click(
		screen.getByRole("menuitem", { name: "Reset cable routing" }),
	);
	expect(changed).toHaveBeenLastCalledWith({ points: [], orthogonal: false });
});
