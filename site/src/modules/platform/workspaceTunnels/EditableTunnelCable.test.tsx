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
	await user.keyboard("{Control>}");
	await user.pointer([
		{
			keys: "[MouseLeft>]",
			target: screen.getByRole("button", { name: "Manage test tunnel" }),
			coords: { clientX: 50, clientY: 20 },
		},
		{
			target: screen.getByRole("button", { name: "Manage test tunnel" }),
			coords: { clientX: 75, clientY: 60 },
		},
		{ keys: "[/MouseLeft]" },
	]);
	await user.keyboard("{/Control}");
	expect(changed).toHaveBeenLastCalledWith({
		orthogonal: false,
		points: [{ id: expect.any(String), x: 65, y: 40 }],
	});
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

it("moves the free head with Ctrl-drag without adding a bend or opening the connection", async () => {
	const user = userEvent.setup();
	const moved = vi.fn();
	const changed = vi.fn();
	const opened = vi.fn();
	const reset = vi.fn();
	render(
		<svg>
			<EditableTunnelCable
				from={{ x: 10, y: 20 }}
				to={{ x: 110, y: 20 }}
				defaultPath="M10 20 H110"
				route={{ points: [], orthogonal: false }}
				label="Manage test tunnel"
				onOpen={opened}
				onReset={reset}
				onChange={changed}
				onMoveHead={moved}
			>
				<circle cx={110} cy={20} r={8} />
			</EditableTunnelCable>
		</svg>,
	);
	const head = screen.getByRole("button", {
		name: "Move cable head: test tunnel",
	});
	await user.keyboard("{Control>}");
	await user.pointer([
		{
			keys: "[MouseLeft>]",
			target: head,
			coords: { clientX: 110, clientY: 20 },
		},
		{ target: head, coords: { clientX: 150, clientY: 70 } },
		{ keys: "[/MouseLeft]", target: head },
	]);
	await user.keyboard("{/Control}");
	expect(moved).toHaveBeenLastCalledWith({ x: 150, y: 70 });
	expect(changed).not.toHaveBeenCalled();
	expect(opened).not.toHaveBeenCalled();
	head.focus();
	await user.keyboard("{ArrowDown}");
	expect(moved).toHaveBeenLastCalledWith({ x: 110, y: 22 });
	await user.pointer([
		{
			keys: "[MouseMiddle>]",
			target: head,
			coords: { clientX: 110, clientY: 20 },
		},
		{ target: head, coords: { clientX: 130, clientY: 80 } },
		{ keys: "[/MouseMiddle]", target: head },
	]);
	expect(moved).toHaveBeenLastCalledWith({ x: 130, y: 80 });
	await user.keyboard("{Shift>}");
	await user.pointer([
		{
			keys: "[MouseLeft>]",
			target: head,
			coords: { clientX: 110, clientY: 20 },
		},
		{ target: head, coords: { clientX: 180, clientY: 50 } },
		{ keys: "[/MouseLeft]", target: head },
	]);
	await user.keyboard("{/Shift}");
	expect(moved).toHaveBeenLastCalledWith({ x: 180, y: 20 });
	expect(changed).toHaveBeenLastCalledWith({
		points: [],
		orthogonal: false,
		straight: true,
	});
	expect(opened).not.toHaveBeenCalled();
	await user.pointer({ keys: "[MouseRight]", target: head });
	await user.click(screen.getByRole("menuitem", { name: "Straighten line" }));
	expect(changed).toHaveBeenLastCalledWith({
		points: [],
		orthogonal: false,
		straight: true,
	});
	await user.pointer({ keys: "[MouseRight]", target: head });
	await user.click(
		screen.getByRole("menuitem", { name: "Reset cable routing" }),
	);
	expect(reset).toHaveBeenCalledOnce();
	expect(changed).toHaveBeenLastCalledWith({ points: [], orthogonal: false });
});

it.each([
	true,
	false,
])("straightens along 90-degree axes (free head: %s)", async (free) => {
	const user = userEvent.setup();
	const moved = vi.fn();
	const changed = vi.fn();
	render(
		<svg>
			<EditableTunnelCable
				from={{ x: 0, y: 0 }}
				to={{ x: 80, y: 40 }}
				defaultPath="M0 0 L80 40"
				route={{ points: [], orthogonal: false }}
				label="Manage test tunnel"
				onOpen={vi.fn()}
				onChange={changed}
				onMoveHead={free ? moved : undefined}
			>
				<circle cx={80} cy={40} r={8} />
			</EditableTunnelCable>
		</svg>,
	);
	await user.pointer({
		keys: "[MouseRight]",
		target: screen.getByRole("button", { name: "Manage test tunnel" }),
	});
	await user.click(screen.getByRole("menuitem", { name: "Straighten line" }));
	if (free) {
		expect(moved).toHaveBeenCalledWith({ x: 80, y: 0 });
		expect(changed).toHaveBeenCalledWith({
			points: [],
			orthogonal: false,
			straight: true,
		});
	} else {
		expect(moved).not.toHaveBeenCalled();
		expect(changed).toHaveBeenCalledWith({ points: [], orthogonal: true });
	}
});
