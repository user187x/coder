import axios from "axios";
import { changeBrowserLock, closeBrowserSession } from "./browserSessions";

vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

it("closes the requested panel through a relative authenticated app URL", async () => {
	vi.mocked(axios.get).mockResolvedValue({ data: { csrf: "session-token" } });
	vi.mocked(axios.post).mockResolvedValue({ data: { stopped: true } });
	await closeBrowserSession(
		"/@admin/neko.main/apps/neko-browser/?embed=1",
		"panel-one",
	);
	const endpoint = `${window.location.origin}/@admin/neko.main/apps/neko-browser/control`;
	expect(axios.get).toHaveBeenCalledWith(endpoint);
	expect(axios.post).toHaveBeenCalledWith(
		endpoint,
		{ id: "panel-one" },
		{ headers: { "X-Browser-CSRF": "session-token" } },
	);
});

it("sends lock changes with the gateway's CSRF token and returns its status", async () => {
	const status = { configured: true, locked: true, retryAfter: 0 };
	vi.mocked(axios.get).mockResolvedValue({ data: { csrf: "session-token" } });
	vi.mocked(axios.post).mockResolvedValue({ data: status });
	await expect(
		changeBrowserLock("/@admin/neko.main/apps/neko-browser/", {
			action: "pin-lock",
		}),
	).resolves.toEqual(status);
	expect(axios.post).toHaveBeenLastCalledWith(
		`${window.location.origin}/@admin/neko.main/apps/neko-browser/control`,
		{ action: "pin-lock" },
		{ headers: { "X-Browser-CSRF": "session-token" } },
	);
});
