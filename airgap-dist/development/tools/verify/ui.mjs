// Browser checks of the dashboard (Playwright + Chromium), as a person would use it:
//   - nothing is fetched from outside the deployment's domain (an air gap), and no page throws;
//   - the sign-in page, the template Overview (Details above the README), a workspace page (metric groups, the
//     percentage chips, the apps squircle lined up with the metrics, the ready border);
//   - a memory soak: the workspace page (1 s metrics) and the HUD left open; the JS heap (after a forced garbage
//     collection) and the DOM size are sampled, and must level off.
//
//   node ui.mjs --url https://coder.example --domain example --workspace /@admin/ws [--soak-minutes 10]
//                [--email admin@admin.com --password admin] [--jsonl out.jsonl] [--chromium PATH]
// Needs @playwright/test (the fork's site/node_modules has it): run from the fork's site/ directory, or set NODE_PATH.
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => {
	if (v.startsWith("--")) acc.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
	return acc;
}, []));
const URL_ = args.url.replace(/\/$/, "");
const DOMAIN = args.domain;
const require = createRequire(args.require ?? `${process.env.HOME}/workspace/coder/site/package.json`);
const { chromium } = require("@playwright/test");
const results = [];
const check = (name, ok, detail = "") => {
	const rec = { suite: "ui", name, ok: Boolean(ok), detail: String(detail).slice(0, 600), seconds: null };
	results.push(rec);
	if (args.jsonl) appendFileSync(args.jsonl, `${JSON.stringify(rec)}\n`);
	console.log(`${ok ? "PASS" : "FAIL"} [ui] ${name}${detail ? ` - ${rec.detail}` : ""}`);
};

const browser = await chromium.launch({
	executablePath: args.chromium ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1105/chrome-linux/chrome`,
});
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
const outside = new Map();
const pageErrors = [];
page.on("request", (r) => {
	const u = new URL(r.url());
	if (!/^(https?|wss?):$/.test(u.protocol) || u.hostname === DOMAIN || u.hostname.endsWith(`.${DOMAIN}`)) return;
	outside.set(`${u.protocol}//${u.host}${u.pathname.slice(0, 50)}`, page.url().replace(URL_, ""));
});
page.on("pageerror", (e) => pageErrors.push(`${page.url().replace(URL_, "")}: ${e.message.slice(0, 160)}`));

await page.goto(`${URL_}/login`);
const title = page.getByTestId("contour-title");
check("sign-in page: the name as a traced outline", await title.waitFor({ timeout: 30000 }).then(() => true, () => false),
	await title.getAttribute("aria-label").catch(() => ""));
await page.getByLabel("Email").fill(args.email ?? "admin@admin.com");
await page.getByLabel("Password").fill(args.password ?? "admin");
await page.getByRole("button", { name: /^sign in$/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
check("signs in with a password", true);

const paths = ["/workspaces", "/templates", "/users", "/audit", "/health", "/hud", "/templates/images",
	"/deployment/overview", "/deployment/appearance", "/deployment/security", "/deployment/network",
	"/deployment/observability", "/settings/account", "/settings/appearance", "/settings/ssh-keys", "/notifications"];
let failed = [];
for (const p of paths) {
	try {
		const r = await page.goto(`${URL_}${p}`, { waitUntil: "load", timeout: 45000 });
		await page.waitForTimeout(2500);
		if (!r || r.status() >= 400) failed.push(`${p} ${r?.status()}`);
	} catch (e) { failed.push(`${p} ${e.message.slice(0, 60)}`); }
}
check("every dashboard page loads", failed.length === 0, failed.join("; ") || `${paths.length} pages`);

const tpl = args.template ?? "default";
await page.goto(`${URL_}/templates/${tpl}/overview`);
await page.locator("#readme").waitFor({ timeout: 30000 }).catch(() => {});
const order = await page.evaluate(() => {
	const d = document.querySelector("#details"), r = document.querySelector("#readme");
	return d && r ? d.getBoundingClientRect().top < r.getBoundingClientRect().top : null;
});
check("template Overview: Details above the README", order === true, String(order));

if (args.workspace) {
	await page.goto(`${URL_}${args.workspace}`);
	const groups = page.getByTestId("metrics-group-cluster");
	const ready = await groups.waitFor({ timeout: 300000 }).then(() => true, () => false);
	check("workspace page: Workspace and Cluster metric groups", ready);
	if (ready) {
		await page.waitForTimeout(8000);
		const chips = await page.getByTestId("metadata-percent").count();
		check("workspace metrics: percentage chips", chips >= 3, `${chips} chips`);
		const text = (await page.getByTestId("metrics-group-workspace").innerText()).replace(/\s+/g, " ");
		check("workspace metrics: RAM in GB", / GB/.test(text) && !/GiB/.test(text), text.slice(0, 160));
		const box = async (l) => l.boundingBox();
		const apps = await box(page.getByTestId("agent-apps"));
		const ws = await box(page.getByTestId("metrics-group-workspace"));
		const cl = await box(groups);
		const fits = cl.x + cl.width <= apps.x + apps.width + 2;  // the metrics line fits (else it scrolls)
		check("apps squircle lines up with the metrics (left edge)", Math.abs(apps.x - ws.x) <= 2, `${Math.round(apps.x)} vs ${Math.round(ws.x)}`);
		if (fits) check("apps squircle lines up with the metrics (right edge)", Math.abs(apps.x + apps.width - (cl.x + cl.width)) <= 2, "");
		const pulse = await page.locator(".agent-fx-pulse").count();
		check("running workspace: the pulsing border", pulse === 1, `${pulse}`);
	}
}

// ---- memory soak --------------------------------------------------------------------------------------------
const minutes = Number(args["soak-minutes"] ?? 0);
if (minutes > 0) {
	const cdp = await page.context().newCDPSession(page);
	const sample = async () => {
		await cdp.send("HeapProfiler.collectGarbage");
		const h = await cdp.send("Runtime.getHeapUsage");
		const dom = await page.evaluate(() => document.getElementsByTagName("*").length);
		return { heapMB: h.usedSize / 1048576, dom };
	};
	for (const [name, path] of [["workspace page", args.workspace], ["HUD", "/hud"]]) {
		if (!path) continue;
		await page.goto(`${URL_}${path}`);
		await page.waitForTimeout(60000);  // warm up: the first minute fills the graphs
		const xs = [];
		const end = Date.now() + minutes * 60000;
		while (Date.now() < end) { xs.push(await sample()); await page.waitForTimeout(30000); }
		xs.push(await sample());
		const half = Math.floor(xs.length / 2);
		const avg = (a) => a.reduce((s, x) => s + x.heapMB, 0) / a.length;
		const growth = avg(xs.slice(half)) - avg(xs.slice(0, half));
		const domGrowth = xs[xs.length - 1].dom - xs[0].dom;
		check(`memory soak, ${name} (${minutes} min): the JS heap levels off`, growth < 15,
			`first half ${avg(xs.slice(0, half)).toFixed(1)} MB, second half ${avg(xs.slice(half)).toFixed(1)} MB (+${growth.toFixed(1)} MB)`);
		check(`memory soak, ${name}: the DOM does not grow`, domGrowth < 500, `${xs[0].dom} -> ${xs[xs.length - 1].dom} nodes`);
	}
}

check(`no request leaves ${DOMAIN}`, outside.size === 0, [...outside].map(([k, v]) => `${k} (from ${v})`).join("; "));
check("no page throws", pageErrors.length === 0, pageErrors.slice(0, 5).join("; "));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} UI checks passed`);
process.exit(passed === results.length ? 0 : 1);
