import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { render } from "#/testHelpers/renderHelpers";
import { applyDashboardInput, parseDashboardInput } from "./dashboardInput";
import { bindDashboardChannel, stopMedia, updateMedia } from "./media";

afterEach(() => {
	stopMedia();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("accepts only bounded input messages", () => {
	for (const payload of [
		'{"type":"click","x":-1,"y":0,"button":0,"count":1}',
		'{"type":"eval","code":"alert(1)"}',
		'{"type":"text","text":12}',
		'{"type":"wheel","x":0,"y":0,"dx":0,"dy":90000}',
		"invalid",
		JSON.stringify({ type: "text", text: "a".repeat(4097) }),
	])
		expect(parseDashboardInput(payload)).toBeNull();
	expect(
		parseDashboardInput(
			JSON.stringify({ type: "click", x: 0.5, y: 0.25, button: 0, count: 1 }),
		),
	).toEqual({ type: "click", x: 0.5, y: 0.25, button: 0, count: 1 });
});

it("operates ordinary dashboard buttons and blocks support controls and external links", () => {
	const clicked = vi.fn();
	render(
		<>
			<button onClick={clicked}>Save</button>
			<div data-dashboard-support-ignore>
				<button onClick={clicked}>Allow control</button>
			</div>
			<a href="https://external.example" onClick={clicked}>
				External
			</a>
		</>,
	);
	const input = { type: "click", x: 0.5, y: 0.5, button: 0, count: 1 } as const;
	applyDashboardInput(input, () =>
		screen.getByRole("button", { name: "Save" }),
	);
	expect(clicked).toHaveBeenCalledTimes(1);
	applyDashboardInput(input, () =>
		screen.getByRole("button", { name: "Allow control" }),
	);
	applyDashboardInput(input, () =>
		screen.getByRole("link", { name: "External" }),
	);
	expect(clicked).toHaveBeenCalledTimes(1);
});

it("edits controlled inputs and never edits password fields", async () => {
	const changed = vi.fn();
	const ControlledInput = () => {
		const [value, setValue] = useState("");
		return (
			<input
				aria-label="Message"
				value={value}
				onChange={(event) => {
					setValue(event.target.value);
					changed(event.target.value);
				}}
			/>
		);
	};
	render(
		<>
			<ControlledInput />
			<input
				aria-label="Password"
				type="password"
				onChange={(event) => changed(event.target.value)}
			/>
		</>,
	);
	await userEvent.click(screen.getByRole("textbox", { name: "Message" }));
	act(() => applyDashboardInput({ type: "text", text: "Hello" }));
	expect(changed).toHaveBeenLastCalledWith("Hello");
	act(() =>
		applyDashboardInput({
			type: "key",
			key: "Backspace",
			ctrl: false,
			alt: false,
			meta: false,
			shift: false,
		}),
	);
	expect(changed).toHaveBeenLastCalledWith("Hell");
	await userEvent.click(screen.getByLabelText("Password"));
	act(() => applyDashboardInput({ type: "text", text: "blocked" }));
	expect(changed).toHaveBeenCalledTimes(2);
});

it("rejects control before consent and ignores old channels immediately after Stop", async () => {
	const send = vi.fn();
	const close = vi.fn();
	vi.stubGlobal(
		"RTCDataChannel",
		class extends EventTarget {
			label = "coder-dashboard-control-v1";
			send = send;
			close = close;
			readyState = "open";
			bufferedAmount = 0;
		},
	);
	vi.stubGlobal(
		"MediaStream",
		class {
			getTracks() {
				return [];
			}
		},
	);
	const channel = new RTCDataChannel();
	updateMedia({ id: "session", dashboard: false });
	bindDashboardChannel(channel, "session", true);
	expect(close).toHaveBeenCalledOnce();
	updateMedia({ id: "session", dashboard: true, local: new MediaStream() });
	bindDashboardChannel(channel, "session", true);
	channel.dispatchEvent(new Event("open"));
	expect(send).toHaveBeenCalledWith(
		JSON.stringify({ type: "dashboard-control", enabled: true }),
	);
	const changed = vi.fn();
	render(
		<input
			aria-label="Message"
			onChange={(event) => changed(event.target.value)}
		/>,
	);
	await userEvent.click(screen.getByRole("textbox", { name: "Message" }));
	const event = () =>
		new MessageEvent("message", {
			data: JSON.stringify({ type: "text", text: "a" }),
		});
	act(() => channel.dispatchEvent(event()));
	expect(changed).toHaveBeenLastCalledWith("a");
	act(() => stopMedia());
	act(() => channel.dispatchEvent(event()));
	expect(changed).toHaveBeenCalledTimes(1);
});
