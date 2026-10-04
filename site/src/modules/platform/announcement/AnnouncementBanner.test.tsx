import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { Banner } from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import { AnnouncementBanner } from "./AnnouncementBanner";

const MockBanner: Banner = {
	id: "announcement-1",
	enabled: true,
	level: "warning",
	title: "",
	message: "**Maintenance** tonight",
	linkText: "",
	linkUrl: "",
	dismissible: true,
	showOnLoginPage: false,
	refreshSeconds: 60,
	effect: "none",
	repeat: false,
};

// The live channel is not under test: a socket that never connects.
class SilentWebSocket {
	close() {}
}

const useBanner = (banner: Banner, acked = false) => {
	const receipts: { kind: string; id: unknown }[] = [];
	server.use(
		http.get("/__banner/banner.json", () => HttpResponse.json(banner)),
		http.get("/__coder-ui/api/me", () =>
			HttpResponse.json({ signedIn: true, username: "admin", acked }),
		),
		http.post("/__coder-ui/api/:kind", async ({ params, request }) => {
			const body = (await request.json()) as { id: unknown };
			receipts.push({ kind: String(params.kind), id: body.id });
			return HttpResponse.json({ ok: true });
		}),
	);
	return receipts;
};

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal("WebSocket", SilentWebSocket);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("AnnouncementBanner", () => {
	it("records that the signed-in user saw the announcement", async () => {
		const receipts = useBanner(MockBanner);
		render(<AnnouncementBanner placement="navbar" />);

		await waitFor(() =>
			expect(receipts).toContainEqual({ kind: "view", id: MockBanner.id }),
		);
	});

	it("records the confirmation and dismisses a dismissible announcement", async () => {
		const receipts = useBanner(MockBanner);
		render(<AnnouncementBanner placement="navbar" />);

		await userEvent.click(
			await screen.findByRole("button", {
				name: "Confirm that you have read this announcement",
			}),
		);

		await waitFor(() =>
			expect(receipts).toContainEqual({ kind: "ack", id: MockBanner.id }),
		);
		expect(localStorage.getItem("coder-banner-dismissed")).toBe(MockBanner.id);
	});

	it("keeps an announcement that cannot be dismissed, confirmed", async () => {
		useBanner({ ...MockBanner, dismissible: false }, true);
		render(<AnnouncementBanner placement="navbar" />);

		const confirmed = await screen.findByRole("button", {
			name: "You confirmed this announcement",
		});
		expect(confirmed).toBeDisabled();
		expect(localStorage.getItem("coder-banner-dismissed")).toBeNull();
	});
});
