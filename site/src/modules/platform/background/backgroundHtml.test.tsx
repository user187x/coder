import { render } from "@testing-library/react";
import { setBackground } from "#/contexts/platformBoot";
import {
	CONTROLLER,
	dialFilter,
	frameHash,
	previewDocument,
} from "./backgroundHtml";
import { PlatformBackground } from "./PlatformBackground";
import {
	PARTICLES_DEFAULT,
	particlesHTML,
	particlesSettings,
} from "./particles";
import { EXAMPLE_RULES } from "./particles.example";

describe("particles", () => {
	it("with the defaults, is example.html's particles exactly", () => {
		const html = particlesHTML(PARTICLES_DEFAULT);
		for (const rule of EXAMPLE_RULES) {
			expect(html).toContain(rule);
		}
		expect(html).toContain("background: #3E1E68");
		expect(html.match(/<span><\/span>/g)?.length).toBe(20);
	});

	it("follows its dials, and keeps stored settings within bounds", () => {
		const html = particlesHTML({
			...PARTICLES_DEFAULT,
			count: 33,
			colors: ["#111111", "#222222", "#333333"],
			spread: 10,
		});
		expect(html.match(/<span><\/span>/g)?.length).toBe(33);
		expect(html).toContain("nth-child(33)");
		expect(html).toContain("color: #222222");
		expect(html).toContain("box-shadow: 10vmin 0");
		expect(
			particlesSettings({ count: 999, background: "red;}" }),
		).toMatchObject({ count: 60, background: PARTICLES_DEFAULT.background });
	});
});

describe("dials", () => {
	it("become CSS filters and the frame's speed", () => {
		expect(dialFilter({})).toBe("none");
		expect(dialFilter({ hue: 90, saturation: 1.5, blur: 2 })).toBe(
			"hue-rotate(90deg) saturate(1.5) blur(2px)",
		);
		expect(frameHash({ speed: 2 }, false)).toBe("#speed=2");
		expect(frameHash({}, true)).toBe("#speed=1&paused=1");
	});

	it("a preview gets the same lock-down and speed control as the served page", () => {
		const doc = previewDocument("<html><head></head><body>x</body></html>");
		expect(doc).toMatch(
			/<head><meta http-equiv="Content-Security-Policy"[^>]*connect-src 'none'/,
		);
		expect(doc.indexOf(CONTROLLER)).toBeLessThan(doc.indexOf("</body>"));
	});
});

describe("PlatformBackground (HTML)", () => {
	afterEach(() => setBackground("dashboard", null));

	it("is a sandboxed frame beneath the page; the page's colour moves to html while it shows", () => {
		document.body.style.backgroundColor = "rgb(9, 9, 11)";
		setBackground("dashboard", {
			url: "/__coder-ui/background/dashboard?v=1",
			opacity: 0.1,
			fit: "cover",
			layer: "under",
			kind: "html",
			params: { speed: 1.5, hue: 30 },
		});
		const { unmount } = render(<PlatformBackground slot="dashboard" />);
		const frame = document.querySelector<HTMLIFrameElement>(
			"iframe[data-testid=platform-background]",
		);
		expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
		expect(frame?.getAttribute("src")).toBe(
			"/__coder-ui/background/dashboard?v=1#speed=1.5",
		);
		expect(frame?.style.zIndex).toBe("-1");
		expect(frame?.style.filter).toBe("hue-rotate(30deg)");
		expect(document.documentElement.style.backgroundColor).toBe(
			"rgb(9, 9, 11)",
		);
		expect(document.body.style.backgroundColor).toBe("transparent");
		unmount();
		expect(document.documentElement.style.backgroundColor).toBe("");
		expect(document.body.style.backgroundColor).toBe("rgb(9, 9, 11)");
	});
});
