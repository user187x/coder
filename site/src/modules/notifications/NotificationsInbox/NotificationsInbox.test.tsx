import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { toast } from "sonner";
import { NotificationsInbox } from "./NotificationsInbox";

type Listener = (event: unknown) => void;
class FakeSocket {
	listeners: Record<string, Listener[]> = {};
	closed = false;
	addEventListener(event: string, cb: Listener) {
		this.listeners[event] = [...(this.listeners[event] ?? []), cb];
	}
	removeEventListener() {}
	close() {
		this.closed = true;
	}
	emit(event: string, payload: unknown = {}) {
		for (const cb of this.listeners[event] ?? []) {
			cb(payload);
		}
	}
}

const sockets: FakeSocket[] = [];
vi.mock("#/api/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/api/api")>()),
	watchInboxNotifications: () => {
		const socket = new FakeSocket();
		sockets.push(socket);
		return socket;
	},
}));

describe("NotificationsInbox live channel", () => {
	beforeEach(() => {
		sockets.length = 0;
		vi.useFakeTimers();
		vi.spyOn(toast, "error");
		vi.spyOn(toast, "dismiss");
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("reconnects quietly, warns only after repeated failures, and clears the warning", async () => {
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<NotificationsInbox
					fetchNotifications={async () => ({
						notifications: [],
						unread_count: 0,
					})}
					markAllAsRead={async () => {}}
					markNotificationAsRead={async () => ({}) as never}
				/>
			</QueryClientProvider>,
		);
		expect(sockets).toHaveLength(1);

		// One failure (e.g. a sign-in redirect): no message, a new attempt.
		act(() => sockets[0].emit("error"));
		expect(toast.error).not.toHaveBeenCalled();
		await act(() => vi.advanceTimersByTimeAsync(1000));
		expect(sockets).toHaveLength(2);

		// Back: nothing to clear.
		act(() => sockets[1].emit("open"));
		expect(toast.dismiss).not.toHaveBeenCalled();

		// Three failures in a row: the message.
		act(() => sockets[1].emit("close"));
		await act(() => vi.advanceTimersByTimeAsync(1000));
		act(() => sockets[2].emit("error"));
		await act(() => vi.advanceTimersByTimeAsync(2000));
		expect(toast.error).not.toHaveBeenCalled();
		act(() => sockets[3].emit("error"));
		expect(toast.error).toHaveBeenCalledTimes(1);

		// Connected again: the message goes away.
		await act(() => vi.advanceTimersByTimeAsync(4000));
		act(() => sockets[4].emit("open"));
		expect(toast.dismiss).toHaveBeenCalledWith("inbox-watch-unavailable");
	});
});
