import { act, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { render } from "#/testHelpers/renderHelpers";
import { applyDashboardInput, parseDashboardInput } from "./dashboardInput";
import {
	bindDashboardChannel,
	requestDashboardCapture,
	stopMedia,
	updateMedia,
	useRemotePointer,
	useShareMedia,
} from "./media";

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
	expect(parseDashboardInput('{"type":"move","x":1.5,"y":0}')).toBeNull();
	expect(parseDashboardInput('{"type":"move","x":0.5,"y":0.25}')).toEqual({
		type: "move",
		x: 0.5,
		y: 0.25,
	});
});

it("moves the pointer over dashboard elements, entering and leaving them", () => {
	const entered = vi.fn();
	const left = vi.fn();
	const moved = vi.fn();
	vi.stubGlobal("innerWidth", 200);
	vi.stubGlobal("innerHeight", 100);
	render(
		<>
			<button
				onPointerEnter={() => entered("Save")}
				onPointerLeave={() => left("Save")}
				onPointerMove={(event) => moved(event.clientX, event.clientY)}
			>
				Save
			</button>
			<button onPointerEnter={() => entered("Cancel")}>Cancel</button>
		</>,
	);
	applyDashboardInput({ type: "move", x: 0.25, y: 0.5 }, () =>
		screen.getByRole("button", { name: "Save" }),
	);
	expect(moved).toHaveBeenLastCalledWith(50, 50);
	expect(entered).toHaveBeenLastCalledWith("Save");
	applyDashboardInput({ type: "move", x: 0.75, y: 0.5 }, () =>
		screen.getByRole("button", { name: "Cancel" }),
	);
	expect(left).toHaveBeenCalledWith("Save");
	expect(entered).toHaveBeenLastCalledWith("Cancel");
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
	const pointer = renderHook(useRemotePointer);
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
	Object.assign(document, { elementFromPoint: () => null });
	act(() =>
		channel.dispatchEvent(
			new MessageEvent("message", {
				data: JSON.stringify({ type: "move", x: 0.5, y: 0.25 }),
			}),
		),
	);
	expect(send).toHaveBeenLastCalledWith(
		JSON.stringify({ type: "dashboard-pointer", x: 0.5, y: 0.25 }),
	);
	expect(pointer.result.current).toEqual({ x: 0.5, y: 0.25 });
	Reflect.deleteProperty(document, "elementFromPoint");
	act(() => stopMedia());
	expect(pointer.result.current).toBeNull();
	act(() => channel.dispatchEvent(event()));
	expect(changed).toHaveBeenCalledTimes(1);
});

it("shows the viewer where the sharer applied the last move", () => {
	vi.stubGlobal(
		"RTCDataChannel",
		class extends EventTarget {
			label = "coder-dashboard-control-v1";
			send = vi.fn();
			close = vi.fn();
		},
	);
	const pointer = renderHook(useRemotePointer);
	const channel = new RTCDataChannel();
	updateMedia({ id: "viewed", dashboard: true });
	bindDashboardChannel(channel, "viewed", false);
	const echo = (data: string) =>
		act(() => channel.dispatchEvent(new MessageEvent("message", { data })));
	echo(JSON.stringify({ type: "dashboard-pointer", x: 2, y: 0 }));
	expect(pointer.result.current).toBeNull();
	echo(JSON.stringify({ type: "dashboard-pointer", x: 0.1, y: 0.9 }));
	expect(pointer.result.current).toEqual({ x: 0.1, y: 0.9 });
});

it("announces the capture mode and holds a request for tab video for the sharer's click", () => {
	const send = vi.fn();
	vi.stubGlobal(
		"RTCDataChannel",
		class extends EventTarget {
			label = "coder-dashboard-control-v1";
			send = send;
			close = vi.fn();
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
	const shared = renderHook(useShareMedia);
	// Sharer: announces its mode when the channel opens, and waits on a tab-video request.
	const sharer = new RTCDataChannel();
	act(() =>
		updateMedia({
			id: "session",
			dashboard: true,
			local: new MediaStream(),
			capture: "rendered",
		}),
	);
	bindDashboardChannel(sharer, "session", true);
	act(() => {
		sharer.dispatchEvent(new Event("open"));
	});
	expect(send).toHaveBeenCalledWith(
		JSON.stringify({ type: "dashboard-capture", mode: "rendered" }),
	);
	act(() => {
		sharer.dispatchEvent(
			new MessageEvent("message", {
				data: JSON.stringify({
					type: "dashboard-capture-request",
					mode: "tab",
				}),
			}),
		);
	});
	expect(shared.result.current.captureRequest).toBe("tab");
	expect(shared.result.current.capture).toBe("rendered");
	act(() => stopMedia());

	// Viewer: learns the sharer's mode and sends its own requests.
	const viewer = new RTCDataChannel();
	act(() =>
		updateMedia({
			id: "session",
			dashboard: true,
			remote: new MediaStream(),
		}),
	);
	bindDashboardChannel(viewer, "session", false);
	act(() => {
		viewer.dispatchEvent(
			new MessageEvent("message", {
				data: JSON.stringify({ type: "dashboard-capture", mode: "tab" }),
			}),
		);
	});
	expect(shared.result.current.capture).toBe("tab");
	requestDashboardCapture("rendered");
	expect(send).toHaveBeenLastCalledWith(
		JSON.stringify({ type: "dashboard-capture-request", mode: "rendered" }),
	);
});
