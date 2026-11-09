import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { type SettingsFace, SettingsFacePanel } from "./SettingsFacePanel";

let chatOn = true;
vi.mock("#/modules/platform/chat/useChatEnabled", () => ({
	useChatEnabled: () => chatOn,
	ChatGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./SettingsChatPanel", () => ({
	SettingsChatPanel: () => <p>chat face</p>,
}));
vi.mock("#/modules/platform/cloudDrive/CloudDrive", () => ({
	CloudDrive: () => <p>drive face</p>,
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
});

it("turns between Metrics, Chat and Cloud Drive in a loop, either way", () => {
	render(<Panel />);
	expect(screen.getByText("metrics face")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Turn to Chat" }));
	expect(screen.getByText("chat face")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Turn to Cloud Drive" }));
	expect(screen.getByText("drive face")).toBeTruthy();
	// the right dimple loops back to the first face
	fireEvent.click(screen.getByRole("button", { name: "Turn to Metrics" }));
	expect(screen.getByText("metrics face")).toBeTruthy();
	// and the left dimple goes the other way round
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
