import axios from "axios";
import { closeBrowserSession } from "./browserSessions";

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
