import { act, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { MockNotifications } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { InboxPopover } from "./InboxPopover";

// Platform: the Inbox's Clear all (asks twice) and its icon-only Mark all as read.
describe("InboxPopover Clear all", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const renderInbox = (onClearAll = vi.fn(), onMarkAllAsRead = vi.fn()) => {
		renderComponent(
			<MemoryRouter>
				<InboxPopover
					defaultOpen
					notifications={MockNotifications.slice(0, 3)}
					unreadCount={2}
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
		fireEvent.click(clear);
		expect(onClearAll).not.toHaveBeenCalled();
		expect(clear.dataset.armed).toBe("true");
		act(() => vi.advanceTimersByTime(3500));
		expect(clear.dataset.armed).toBeUndefined();
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
});
