import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { AccordionPanel } from "./AccordionPanel";
import { AgentPanels } from "./AgentPanels";

const Harness: React.FC = () => {
	const [order, setOrder] = useState(["logs", "terminal", "app:a"]);
	return (
		<AgentPanels
			order={order}
			onReorder={setOrder}
			panels={["logs", "terminal", "app:a"].map((id) => ({
				id,
				label: id,
				render: (handle) => (
					<section data-testid={`panel-${id}`}>
						{handle}
						{id}
					</section>
				),
			}))}
		/>
	);
};

const orderOf = (id: string) =>
	Number(
		(screen.getByTestId(`panel-${id}`).parentElement as HTMLElement).style
			.order,
	);

describe("AgentPanels", () => {
	it("moves a panel with the keyboard, without moving it in the page", () => {
		render(<Harness />);
		const handle = screen.getByRole("button", {
			name: "Reorder the app:a panel",
		});
		const parent = screen.getByTestId("panel-app:a").parentElement;
		handle.focus();
		fireEvent.keyDown(handle, { key: " " });
		expect(handle).toHaveAttribute("aria-pressed", "true");
		fireEvent.keyDown(handle, { key: "ArrowUp" });
		fireEvent.keyDown(handle, { key: "ArrowUp" });
		fireEvent.keyDown(handle, { key: "ArrowUp" }); // already at the top
		fireEvent.keyDown(handle, { key: "Enter" });
		expect(handle).toHaveAttribute("aria-pressed", "false");
		expect([orderOf("app:a"), orderOf("logs"), orderOf("terminal")]).toEqual([
			0, 1, 2,
		]);
		// Same element, still focused: an embedded app is never reloaded.
		expect(screen.getByTestId("panel-app:a").parentElement).toBe(parent);
		expect(handle).toHaveFocus();
		// Arrows do nothing unless it was picked up.
		fireEvent.keyDown(handle, { key: "ArrowDown" });
		expect(orderOf("app:a")).toBe(0);
	});
});

it("hides and restores other panels without restarting their sessions", async () => {
	const user = userEvent.setup();
	const start = vi.fn();
	const stop = vi.fn();
	const Session = () => {
		useEffect(() => {
			start();
			return stop;
		}, []);
		return <input aria-label="Session draft" defaultValue="Keep this draft" />;
	};
	render(
		<AgentPanels
			order={["desktop", "terminal"]}
			onReorder={vi.fn()}
			panels={["desktop", "terminal"].map((id) => ({
				id,
				label: id,
				render: (handle) => (
					<AccordionPanel
						id={id}
						title={id}
						handle={handle}
						kind="app"
						slug={id}
						initiallyOpen
						height={240}
						onHeightChange={vi.fn()}
						onRemove={vi.fn()}
					>
						<Session />
					</AccordionPanel>
				),
			}))}
		/>,
	);
	await user.pointer({
		target: screen.getByRole("button", { name: "desktop" }),
		keys: "[MouseRight]",
	});
	await user.click(screen.getByRole("menuitem", { name: "Hide other panels" }));
	await user.pointer({
		target: screen.getByRole("button", { name: "desktop" }),
		keys: "[MouseRight]",
	});
	await user.click(
		screen.getByRole("menuitem", { name: "Restore all panels" }),
	);
	expect(start).toHaveBeenCalledTimes(2);
	expect(stop).not.toHaveBeenCalled();
	expect(
		screen.getAllByRole("textbox").map((input) => input.getAttribute("value")),
	).toEqual(["Keep this draft", "Keep this draft"]);
});
