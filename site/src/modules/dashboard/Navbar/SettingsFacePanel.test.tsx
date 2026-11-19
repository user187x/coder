import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PlatformAPI } from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
import { type SettingsFace, SettingsFacePanel } from "./SettingsFacePanel";

let chatOn = true;
vi.mock("#/modules/platform/chat/useChatEnabled", () => ({
	useChatEnabled: () => chatOn,
	ChatGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./SettingsChatPanel", () => ({
	SettingsChatPanel: () => <p>chat face</p>,
}));
vi.mock("./SettingsDriveFace", () => ({
	SettingsDriveFace: () => <p>drive face</p>,
}));

const Panel = () => {
	const [face, setFace] = useState<SettingsFace>("metrics");
	return (
		<SettingsFacePanel
			face={face}
			onFaceChange={setFace}
			metrics={<p>metrics face</p>}
		/>
	);
};

afterEach(() => {
	chatOn = true;
	vi.restoreAllMocks();
});

it("turns between Metrics, Chat and Cloud Drive in a loop, either way", () => {
	render(<Panel />);
	expect(screen.getByText("metrics face")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Turn to Chat" }));
	expect(screen.getByText("chat face")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Turn to Cloud Drive" }));
	expect(screen.getByText("drive face")).toBeTruthy();
	// the right arrow loops back to the first face
	fireEvent.click(screen.getByRole("button", { name: "Turn to Metrics" }));
	expect(screen.getByText("metrics face")).toBeTruthy();
	// and the left arrow goes the other way round
	fireEvent.click(
		screen.getAllByRole("button", { name: "Turn to Cloud Drive" })[0]!,
	);
	expect(screen.getByText("drive face")).toBeTruthy();
});

it("leaves out the Chat face where chat is off", () => {
	chatOn = false;
	render(<Panel />);
	fireEvent.click(
		screen.getAllByRole("button", { name: "Turn to Cloud Drive" })[0]!,
	);
	expect(screen.getByText("drive face")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Turn to Chat" })).toBeNull();
});

it("saves a collapse direction from either handle and reuses it after reopening", async () => {
	const user = userEvent.setup();
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (changes) => changes);
	render(<Panel />);
	const right = screen
		.getAllByRole("button", {
			name: "Hide the bottom panel",
		})
		.at(-1);
	if (!right) throw new Error("Missing right panel handle");
	await user.pointer({ target: right, keys: "[MouseRight]" });
	await user.click(
		screen.getByRole("menuitemcheckbox", { name: "Collapse Upward" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			settings_face_collapse_direction: "up",
			settings_face_hidden: true,
		}),
	);
	const [left] = await screen.findAllByRole("button", {
		name: "Show the bottom panel",
	});
	await user.click(left);
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({ settings_face_hidden: null }),
	);
	const [hide] = await screen.findAllByRole("button", {
		name: "Hide the bottom panel",
	});
	await user.click(hide);
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({ settings_face_hidden: true }),
	);
	await user.pointer({ target: left, keys: "[MouseRight]" });
	await user.click(
		screen.getByRole("menuitemcheckbox", { name: "Collapse Downward" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({
			settings_face_collapse_direction: "down",
			settings_face_hidden: true,
		}),
	);
});
