import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PlatformAPI } from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
import {
	type SettingsFace,
	SettingsFacePanel,
	type SettingsPanelLayout,
} from "./SettingsFacePanel";

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
	const [layout, setLayout] = useState<SettingsPanelLayout>("both");
	return (
		<SettingsFacePanel
			face={face}
			layout={layout}
			onLayoutChange={setLayout}
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

it("saves the collapse direction without selecting a panel", async () => {
	const user = userEvent.setup();
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockImplementation(async (changes) => changes);
	render(<Panel />);
	await user.pointer({
		target: screen.getByRole("button", { name: "Show only the bottom panel" }),
		keys: "[MouseRight]",
	});
	await user.click(
		screen.getByRole("menuitemcheckbox", { name: "Collapse Upward" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			settings_face_collapse_direction: "up",
		}),
	);
	await user.pointer({
		target: screen.getByRole("button", { name: "Show only quick links" }),
		keys: "[MouseRight]",
	});
	await user.click(
		screen.getByRole("menuitemcheckbox", { name: "Collapse Downward" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({
			settings_face_collapse_direction: "down",
		}),
	);
});
