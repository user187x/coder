import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { getPreferredProxy } from "#/contexts/ProxyContext";
import {
	MockProxyLatencies,
	MockWorkspaceProxies,
} from "#/testHelpers/entities";
import { ProxyMenu } from "./ProxyMenu";

const value = {
	latenciesLoaded: true,
	proxyLatencies: MockProxyLatencies,
	proxy: getPreferredProxy(MockWorkspaceProxies, undefined),
	proxies: MockWorkspaceProxies,
	isLoading: false,
	isFetched: true,
	setProxy: vi.fn(),
	clearProxy: vi.fn(),
	refetchProxyLatencies: () => new Date(),
};

const renderMenu = (hud: boolean) =>
	render(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<ProxyMenu proxyContextValue={value} hud={hud} />
			</MemoryRouter>
		</QueryClientProvider>,
	);

describe("ProxyMenu", () => {
	it("joins the HUD on as one split button: the HUD's link, then the latency and its menu", () => {
		renderMenu(true);
		const split = screen.getByTestId("navbar-hud-latency");
		const [hud, menu] = Array.from(split.children);
		expect(hud).toHaveAttribute("href", "/hud");
		expect(hud).toHaveTextContent("HUD");
		expect(menu.tagName).toBe("BUTTON");
		expect(menu).toHaveAttribute("aria-haspopup", "menu");
		// the latency reading is still there, by the menu's chevron
		expect(menu).toHaveTextContent(/Latency for/);
		expect(menu).toHaveTextContent(/ms/);
	});

	it("is the latency menu alone without the HUD", () => {
		renderMenu(false);
		expect(screen.queryByTestId("navbar-hud-latency")).toBeNull();
		expect(screen.queryByRole("link", { name: /HUD/ })).toBeNull();
		expect(screen.getByRole("button", { name: /Latency for/ })).toBeVisible();
	});
});
