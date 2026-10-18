import { scrollToFile } from "./TemplateFiles";

describe("scrollToFile", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	const file = (top: number, height: number) => {
		const el = document.createElement("div");
		el.id = "main.tf";
		document.body.appendChild(el);
		vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
			top,
			height,
		} as DOMRect);
		return el;
	};

	it("centres a file that fits below the navbar, in one smooth scroll, without a hash navigation", () => {
		file(1500, 300);
		const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
		const hashchange = vi.fn();
		window.addEventListener("hashchange", hashchange);
		vi.spyOn(window, "innerHeight", "get").mockReturnValue(1000);
		expect(scrollToFile("main.tf")).toBe(true);
		// below the navbar (72 + 16): (1000 - 88 - 300) / 2 = 306 from it
		expect(scroll).toHaveBeenCalledTimes(1);
		expect(scroll).toHaveBeenCalledWith({
			top: 1500 - (88 + 306),
			behavior: "smooth",
		});
		expect(window.location.hash).toBe("#main.tf");
		expect(hashchange).not.toHaveBeenCalled();
		window.removeEventListener("hashchange", hashchange);
	});

	it("puts a file taller than the screen with its header below the navbar", () => {
		file(2000, 5000);
		const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
		vi.spyOn(window, "innerHeight", "get").mockReturnValue(1000);
		scrollToFile("main.tf");
		expect(scroll).toHaveBeenCalledWith({
			top: 2000 - 88,
			behavior: "smooth",
		});
	});

	it("does nothing for a folder (no file of that name)", () => {
		const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
		expect(scrollToFile("modules")).toBe(false);
		expect(scroll).not.toHaveBeenCalled();
	});
});
