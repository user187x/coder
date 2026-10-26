import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { type ChatPair, PlatformAPI } from "#/api/platform";
import { MockChatSettings } from "#/testHelpers/chat";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { DiscoveryCard, PairsCard } from "./ChatSettingsPage";

const pair = (i: number): ChatPair => ({
	a: { id: `a${i}`, username: `ann${i}`, name: "", online: false },
	b: { id: `b${i}`, username: `bob${i}`, name: "", online: false },
	messages: i + 1,
	first: "2026-10-18T05:00:00Z",
	last: "2026-10-18T06:00:00Z",
});

/** The service: 30 pairs, newest first (pair 29 the latest), a page of 25 from the offset asked for. */
const service = (offset = 0) => {
	const all = Array.from({ length: 30 }, (_, i) => pair(29 - i));
	return Promise.resolve({
		pairs: all.slice(offset, offset + 25),
		total: 30,
		offset,
		limit: 25,
	});
};

describe("Who talks to whom", () => {
	afterEach(() => vi.restoreAllMocks());

	it("shows the latest 25 pairs, then the rest a page at a time", async () => {
		const get = vi
			.spyOn(PlatformAPI, "getChatPairs")
			.mockImplementation(service);
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<PairsCard />
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(screen.getAllByTestId("chat-pair")).toHaveLength(25),
		);
		expect(get).toHaveBeenCalledWith(0);
		expect(screen.getAllByTestId("chat-pair")[0]).toHaveTextContent("@ann29");
		const amount = (text: string) =>
			screen.getAllByText((_, el) => el?.textContent === text)[0];
		expect(amount("Showing 1 to 25 of 30 pairs")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Next page" }));
		await waitFor(() =>
			expect(screen.getAllByTestId("chat-pair")).toHaveLength(5),
		);
		expect(get).toHaveBeenLastCalledWith(25);
		expect(screen.getAllByTestId("chat-pair")[4]).toHaveTextContent("@ann0");
		expect(amount("Showing 26 to 30 of 30 pairs")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
	});

	it("pages a service's full list (from before pages) itself", async () => {
		vi.spyOn(PlatformAPI, "getChatPairs").mockResolvedValue({
			pairs: Array.from({ length: 30 }, (_, i) => pair(29 - i)),
		});
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<PairsCard />
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(screen.getAllByTestId("chat-pair")).toHaveLength(25),
		);
		fireEvent.click(screen.getByRole("button", { name: "Next page" }));
		await waitFor(() =>
			expect(screen.getAllByTestId("chat-pair")).toHaveLength(5),
		);
	});
});

it("saves the admin discovery permission", async () => {
	const save = vi
		.spyOn(PlatformAPI, "saveChatSettings")
		.mockResolvedValue({ ...MockChatSettings, discoverAll: true });
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<DiscoveryCard settings={MockChatSettings} />
		</QueryClientProvider>,
	);
	await userEvent.click(
		screen.getByRole("switch", { name: "Discover all users" }),
	);
	await waitFor(() => expect(save).toHaveBeenCalledWith({ discoverAll: true }));
	vi.restoreAllMocks();
});
