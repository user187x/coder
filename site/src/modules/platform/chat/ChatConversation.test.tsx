import { fireEvent, screen, waitFor } from "@testing-library/react";
import { type ChatMessage, PlatformAPI } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { ChatConversation, formatSize } from "./ChatConversation";
import type { ChatWindowState } from "./chatStore";

const peer = { id: "bob", username: "bob", name: "Bob" };
const view = (messages: ChatMessage[] = []): ChatWindowState => ({
	peer,
	minimized: false,
	loading: false,
	loadError: null,
	messages,
	pending: [],
	lastIn: 0,
	readSent: 0,
	clearedByPeer: false,
	focusRequest: 0,
	loadingOlder: false,
	olderDone: true,
});
const message = (over: Partial<ChatMessage>): ChatMessage => ({
	id: 1,
	from: "bob",
	fromName: "bob",
	fromDisplay: "Bob",
	to: "me",
	toName: "me",
	toDisplay: "",
	text: "",
	at: new Date().toISOString(),
	fromAdmin: false,
	toAdmin: false,
	image: null,
	page: null,
	...over,
});

const render = (messages?: ChatMessage[]) =>
	renderComponent(
		<ChatConversation view={view(messages)} dock={{ current: null }} />,
	);

describe("chat attachments", () => {
	afterEach(() => vi.restoreAllMocks());

	it("sizes a file in words", () => {
		expect(formatSize(512)).toBe("512 B");
		expect(formatSize(1536)).toBe("1.5 KB");
		expect(formatSize(25 * 1048576)).toBe("25 MB");
	});

	it("uploads the picked file with a progress bar, and sends it with the message", async () => {
		let progress: ((fraction: number) => void) | undefined;
		let finish: (() => void) | undefined;
		vi.spyOn(PlatformAPI, "uploadChatFile").mockImplementation(
			(_to, file, onProgress) => {
				progress = onProgress;
				return new Promise((resolve) => {
					finish = () =>
						resolve({
							upload: "0123456789abcdef0123456789abcdef",
							name: file.name,
							size: file.size,
							type: file.type,
						});
				});
			},
		);
		const send = vi.spyOn(PlatformAPI, "sendChatMessage").mockResolvedValue({
			message: message({ id: 9, from: "me", to: "bob" }),
		});
		render();

		const input =
			document.querySelector<HTMLInputElement>('input[type="file"]');
		expect(input).not.toBeNull();
		expect(screen.getByRole("button", { name: "Attach a file" })).toBeEnabled();
		const file = new File(["x".repeat(2048)], "notes.txt", {
			type: "text/plain",
		});
		fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

		const bar = await screen.findByRole("progressbar", {
			name: "Uploading notes.txt",
		});
		expect(bar).toHaveAttribute("aria-valuenow", "0");
		progress?.(0.5);
		await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "50"));
		expect(screen.getByText("50% of 2.0 KB")).toBeInTheDocument();

		// Enter before the upload is done: the message waits for it.
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "here you go" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(send).not.toHaveBeenCalled();
		finish?.();
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0]).toMatchObject({
			to: "bob",
			text: "here you go",
			upload: "0123456789abcdef0123456789abcdef",
		});
		await waitFor(() =>
			expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(),
		);
	});

	it("refuses a file over the limit without uploading it", async () => {
		const upload = vi.spyOn(PlatformAPI, "uploadChatFile");
		render();
		const big = new File(["x"], "big.iso");
		Object.defineProperty(big, "size", { value: 26 * 1048576 });
		fireEvent.change(
			document.querySelector('input[type="file"]') as HTMLInputElement,
			{ target: { files: [big] } },
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"big.iso is 26 MB: a file can be at most 25 MB.",
		);
		expect(upload).not.toHaveBeenCalled();
	});

	it("shows a sent picture in the message and any other file as a download", () => {
		render([
			message({
				id: 1,
				file: {
					url: "/f/1",
					name: "shot.png",
					size: 2048,
					type: "image/png",
				},
			}),
			message({
				id: 2,
				file: {
					url: "/f/2",
					name: "build.log",
					size: 3 * 1048576,
					type: "text/plain",
				},
			}),
		]);
		expect(screen.getByRole("img", { name: "shot.png" })).toHaveAttribute(
			"src",
			"/f/1",
		);
		const download = screen.getByRole("link", { name: /build\.log/ });
		expect(download).toHaveAttribute("download", "build.log");
		expect(download).toHaveTextContent("3.0 MB");
	});
});
