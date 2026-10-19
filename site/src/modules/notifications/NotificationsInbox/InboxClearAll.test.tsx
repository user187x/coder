import { act, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { MockNotifications } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { InboxPopover } from "./InboxPopover";

// Platform: the Inbox's Clear all (asks twice) and its icon-only Mark all as read.
describe("InboxPopover Clear all", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const renderInbox = (
		onClearAll = vi.fn(),
		onMarkAllAsRead = vi.fn(),
		unreadCount = 2,
	) => {
		renderComponent(
			<MemoryRouter>
				<InboxPopover
					defaultOpen
					notifications={MockNotifications.slice(0, 3)}
					unreadCount={unreadCount}
					error={undefined}
					isLoadingMoreNotifications={false}
					hasMoreNotifications={false}
					onRetry={vi.fn()}
					onMarkAllAsRead={onMarkAllAsRead}
					onClearAll={onClearAll}
					onMarkNotificationAsRead={vi.fn()}
					onLoadMoreNotifications={vi.fn()}
				/>
			</MemoryRouter>,
		);
		return { onClearAll, onMarkAllAsRead };
	};

	it("clears on the second click, and the first one wears off", () => {
		const { onClearAll } = renderInbox();
		const clear = screen.getByTestId("inbox-clear-all");
		expect(clear.textContent).toBe("Clear all"); // an icon, its name for screen readers only
		fireEvent.click(clear);
		expect(onClearAll).not.toHaveBeenCalled();
		expect(clear.dataset.armed).toBe("true");
		// armed, it says what the next click does
		expect(screen.getByText("Clear all?")).toBeVisible();
		act(() => vi.advanceTimersByTime(4500));
		expect(clear.dataset.armed).toBeUndefined();
		expect(screen.queryByText("Clear all?")).toBeNull();
		fireEvent.click(clear);
		fireEvent.click(clear);
		expect(onClearAll).toHaveBeenCalledTimes(1);
	});

	it("puts Clear all left of Mark all as read, both icon buttons", () => {
		const { onMarkAllAsRead } = renderInbox();
		const clear = screen.getByTestId("inbox-clear-all");
		const mark = screen.getByRole("button", { name: /mark all as read/i });
		expect(clear.compareDocumentPosition(mark)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		// an icon and an accessible name, no visible text
		expect(mark.querySelector("svg")).not.toBeNull();
		expect(mark.querySelector(".sr-only")?.textContent).toBe(
			"Mark all as read",
		);
		fireEvent.click(mark);
		expect(onMarkAllAsRead).toHaveBeenCalled();
	});

	it("disables Mark all as read when nothing is unread", () => {
		const { onMarkAllAsRead } = renderInbox(vi.fn(), vi.fn(), 0);
		const mark = screen.getByRole("button", { name: /mark all as read/i });
		expect(mark).toBeDisabled();
		expect(mark.getAttribute("title")).toBe("Nothing unread");
		fireEvent.click(mark);
		expect(onMarkAllAsRead).not.toHaveBeenCalled();
		// Clear all still works on read notifications
		expect(screen.getByTestId("inbox-clear-all")).toBeEnabled();
	});
});

describe("searchNotifications (the Inbox's search box)", () => {
	it("keeps the notifications whose title or text holds every word, case aside", async () => {
		const { searchNotifications } = await import("./InboxPopover");
		const n = (id: string, title: string, content: string) =>
			({
				id,
				user_id: "u",
				template_id: "t",
				targets: [],
				title,
				content,
				icon: "",
				actions: [],
				read_at: null,
				created_at: "2026-10-18T00:00:00Z",
			}) as const;
		const all = [
			n("1", "User account t75c has been deleted", "by admin"),
			n("2", "Workspace build failed", "greg-workspace on node coder"),
			n("3", "New user account greg", "created by admin"),
		];
		expect(searchNotifications(all, "").map((x) => x.id)).toEqual([
			"1",
			"2",
			"3",
		]);
		expect(searchNotifications(all, "GREG").map((x) => x.id)).toEqual([
			"2",
			"3",
		]);
		expect(searchNotifications(all, "account admin").map((x) => x.id)).toEqual([
			"1",
			"3",
		]);
		expect(searchNotifications(all, "nothing here")).toEqual([]);
	});
});
