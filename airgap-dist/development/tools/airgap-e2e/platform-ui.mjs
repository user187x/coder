// Browser checks of the dashboard features (run after step8.py, which leaves the running workspace admin/e2e):
//   node platform-ui.mjs OUT_DIR URL [HOST_RESOLVER_RULES]
// e.g. node platform-ui.mjs shots https://coder.airgap.test "MAP coder.airgap.test:443 127.0.0.1:18443"
// Needs @playwright/test (the fork's site/node_modules) and its headless Chromium.
// The SSH-key-from-.p12 check runs with P12_FILE, P12_PASSWORD and P12_PUBLIC_KEY (the key's "ssh-..." line);
// it replaces the admin's SSH key, so run it only against a test deployment.
import { createRequire } from "node:module";
const require = createRequire(`${process.env.CODER_SITE ?? `${process.env.HOME}/workspace/coder/site`}/package.json`);
const { chromium } = require("@playwright/test");

const [OUT, URL, RESOLVE] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = "") => {
	results.push(ok);
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const browser = await chromium.launch(RESOLVE ? { args: [`--host-resolver-rules=${RESOLVE}`] } : {});
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
const snap = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const sent = []; // every request body, to prove the .p12 password never leaves the page
page.on("request", (r) => sent.push(`${r.url()} ${r.postData() ?? ""}`));
try {
	await page.goto(`${URL}/login`);
	await page.getByLabel("Email").fill("admin@admin.com");
	await page.getByLabel("Password").fill("admin");
	await page.getByRole("button", { name: /^sign in$/i }).click();
	await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });

	// ---- terminal accordion
	await page.goto(`${URL}/@admin/e2e`);
	const fx = page.locator("#main-content section .agent-fx").first();
	await fx.waitFor({ timeout: 30000 });
	await page.waitForFunction(() => document.querySelector("#main-content section .agent-fx")?.dataset.fx === "ready", null, { timeout: 120000 }).catch(() => {});
	check("a ready workspace's card has the rotating border", (await fx.getAttribute("data-fx")) === "ready", String(await fx.getAttribute("data-fx")));
	await snap("00-workspace-border");
	await page.getByRole("button", { name: "Terminal", exact: true }).click();
	const group = page.getByRole("group", { name: "Terminal text size" }).first();
	await group.waitFor({ timeout: 30000 });
	check("text size controls at the far left of the row", await group.isVisible());
	const dims = page.getByTestId("terminal-dimensions").first();
	await dims.waitFor({ timeout: 30000 });
	const [cols, rows] = (await dims.textContent()).split("x").map(Number);
	check("starts at a size that fits btop (>= 80x24)", cols >= 80 && rows >= 24, `${cols}x${rows}`);
	const size = async () => Number(await group.getByTitle("Text size (px)").textContent());
	const before = await size();
	await group.getByRole("button", { name: "Larger text" }).click();
	check("Larger text increases the size", (await size()) === before + 1, `${before} -> ${await size()}`);
	await group.getByRole("button", { name: "Smaller text" }).click();
	// The terminal draws on a canvas (WebGL); what counts is that the browser loaded the bundled Nerd Font for it.
	await page.waitForFunction(() => [...document.fonts].some((f) => f.family.includes("JetBrainsMono Nerd Font") && f.status === "loaded"), null, { timeout: 30000 }).catch(() => {});
	const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.family.includes("JetBrainsMono Nerd Font")).map((f) => f.status));
	check("web terminal font is JetBrainsMono Nerd Font (loaded by the terminal)", loaded.includes("loaded"), JSON.stringify(loaded));
	await snap("01-terminal");

	await page.getByRole("button", { name: "Pop out" }).click();
	const popout = page.getByRole("dialog", { name: /Terminal/ });
	await popout.waitFor();
	check("Pop out opens the terminal in a window", await popout.locator(".xterm").first().isVisible());
	await snap("02-popout");
	await popout.getByRole("button", { name: "Put the terminal back in the drop-down" }).click();
	await page.getByRole("button", { name: "Pop out" }).waitFor();
	check("Dock puts it back in the drop-down", (await page.getByRole("dialog", { name: /Terminal/ }).count()) === 0);
	await page.getByRole("button", { name: "Pop out" }).click();
	await page.getByRole("dialog", { name: /Terminal/ }).getByRole("button", { name: "Close the terminal window" }).click();
	await page.waitForTimeout(500);
	check("Close leaves the drop-down collapsed (no terminal running)",
		(await page.locator(".xterm").count()) === 0 && (await page.getByRole("button", { name: "Pop out" }).count()) === 0);

	// ---- HUD
	await page.goto(`${URL}/hud`);
	const tiles = page.getByRole("list", { name: "Metrics" }).getByRole("listitem");
	await tiles.first().waitFor({ timeout: 30000 });
	check("HUD shows its metrics", (await tiles.count()) >= 15, `${await tiles.count()} tiles`);
	await snap("03-hud");
	await page.getByRole("button", { name: "Sort" }).click();
	await page.getByRole("menuitem", { name: /Highest ping/ }).click();
	await page.waitForTimeout(300);
	check("the Sort menu moves a metric to the top", /Highest ping/.test(await tiles.first().textContent()));
	await page.reload();
	await tiles.first().waitFor();
	check("the order is remembered", /Highest ping/.test(await tiles.first().textContent()));
	const cpu = tiles.filter({ hasText: "Highest CPU" });
	const cpuText = await cpu.textContent();
	check("Highest CPU names an account while workspaces run", !/—/.test(cpuText) && /admin|tester/.test(cpuText), cpuText.replace(/\s+/g, " ").slice(0, 80));
	await cpu.getByRole("link").click();
	await page.waitForURL((u) => u.pathname.startsWith("/@"), { timeout: 15000 });
	check("clicking a leader opens that workspace", true, new globalThis.URL(page.url()).pathname);
	await page.goto(`${URL}/hud`);
	await page.getByRole("link", { name: /^Workspaces active/ }).first().click();
	await page.waitForURL((u) => u.pathname === "/workspaces", { timeout: 15000 });
	check("clicking a total opens its list", /status(:|%3A)running/.test(page.url()), new globalThis.URL(page.url()).search);
	await page.goto(`${URL}/hud`);
	await page.getByRole("button", { name: "Sort" }).click();
	await page.getByRole("menuitem", { name: "Reset order" }).click();

	// ---- breadcrumb and room at the end of pages
	await page.goto(`${URL}/deployment/customize`);
	const crumb = page.locator("#main-content nav ol > li:nth-child(3) > span");
	await crumb.waitFor({ timeout: 30000 });
	check("breadcrumb names the category (Customize)", (await crumb.textContent()) === "Customize", await crumb.textContent());
	await page.getByText("Source Code Pro").waitFor({ timeout: 30000 });
	// The page keeps growing while it loads (theme previews): scroll to the end once it has settled.
	for (let i = 0; i < 3; i++) {
		await page.waitForTimeout(1000);
		await page.evaluate(() => {
			const se = document.scrollingElement;
			se.scrollTop = se.scrollHeight;
		});
	}
	await page.waitForTimeout(500);
	const room = await page.evaluate(() => {
		const label = [...document.querySelectorAll("label, span")].filter((e) => e.textContent.trim() === "Source Code Pro").pop();
		const bottom = label.getBoundingClientRect().bottom;
		const covers = [...document.querySelectorAll("div.sticky.bottom-0, [data-chat-panel], #coder-classification-bottom")]
			.map((e) => e.getBoundingClientRect().top).filter((t) => t > 0);
		return Math.round(Math.min(innerHeight, ...covers) - bottom);
	});
	check("the last line of a long page clears the bottom bars", room >= 24, `${room}px free`);
	await snap("06-customize-bottom");
	await page.goto(`${URL}/health/user-quota`);
	await crumb.waitFor({ timeout: 30000 });
	check("breadcrumb names the category (Health)", (await crumb.textContent()) === "Health", await crumb.textContent());

	// ---- Monitoring and User Quota
	await page.goto(`${URL}/deployment/monitoring`);
	await page.getByRole("heading", { name: "Security posture" }).waitFor({ timeout: 30000 });
	await page.getByText("Privileged accounts").waitFor({ timeout: 30000 });
	check("Monitoring shows the security posture", true);
	await snap("04-monitoring");
	await page.goto(`${URL}/health/user-quota`);
	await page.getByRole("heading", { name: /Global Workspace Scheduler/ }).waitFor({ timeout: 30000 });
	check("User Quota has the Global Workspace Scheduler", await page.getByText("Maximum active time").isVisible());
	await snap("05-scheduler");

	// ---- SSH key from the .p12 (test deployments only: it replaces the admin's SSH key)
	if (process.env.P12_FILE) {
		await page.goto(`${URL}/settings/ssh-keys`);
		await page.getByRole("link", { name: /^P12$/ }).click();
		await page.waitForURL((u) => u.pathname === "/settings/certificates", { timeout: 15000 });
		const dialog = page.getByRole("dialog", { name: /SSH key/ });
		await dialog.waitFor({ timeout: 15000 });
		check("SSH keys > P12 opens the Certificates page's dialog", true);
		await dialog.locator('input[type="file"]').setInputFiles(process.env.P12_FILE);
		const pw = dialog.getByLabel("Certificate password");
		await pw.waitFor({ timeout: 15000 });
		check("a password-protected .p12 asks for its password", true);
		await pw.fill(process.env.P12_PASSWORD);
		await snap("07-p12-ssh");
		await dialog.getByRole("button", { name: "Use as SSH key" }).click();
		await dialog.waitFor({ state: "detached", timeout: 30000 });
		await page.goto(`${URL}/settings/ssh-keys`);
		const key = page.getByText(/^(ssh|ecdsa)-/).first();
		await key.waitFor({ timeout: 15000 });
		const shown = (await key.textContent()).trim();
		const want = process.env.P12_PUBLIC_KEY.trim().split(" ").slice(0, 2).join(" ");
		check("the SSH key is now the certificate's key", shown.startsWith(want), shown.slice(0, 40));
		const pass = process.env.P12_PASSWORD;
		const leaked = sent.filter((r) => r.includes(pass)).length;
		const stored = await page.evaluate((p) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(p), pass);
		check("the password was never sent or stored", leaked === 0 && !stored, `${sent.length} requests checked`);
		await snap("08-ssh-key");
	}
} catch (err) {
	check("no unexpected error", false, String(err).split("\n")[0]);
	await snap("error");
} finally {
	await browser.close();
	console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
}
