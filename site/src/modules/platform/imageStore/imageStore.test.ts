import type { StoreImage } from "#/api/platform";
import { isBaked, mergeImages, referenceOf } from "./imageStore";

const served: StoreImage[] = [
	{
		name: "flag.png",
		url: "/__coder-ui/banner-picture/1",
		type: "image/png",
		source: "uploaded",
	},
	{
		name: "synthsun.gif",
		url: "/__coder-ui/image-store/synthsun.gif?v=1",
		thumb: "/t",
		type: "image/gif",
		source: "store",
	},
	// the gallery holding one the dashboard has baked in already
	{
		name: "pulser-cube.gif",
		url: "/__coder-ui/gallery/pulser-cube.gif?v=2",
		type: "image/gif",
		source: "gallery",
	},
	{
		name: "logo.png",
		url: "/__coder-ui/gallery/logo.png?v=3",
		type: "image/png",
		source: "gallery",
	},
];

describe("the image store", () => {
	it("lists a chooser's presets, the provided pictures, the dashboard's, then the gallery's and the uploaded ones - each once", () => {
		const images = mergeImages(
			[{ name: "usa.gif", url: "/pictures/usa.gif", type: "image/gif" }],
			served,
		);
		const names = images.map((i) => `${i.name}:${i.source}`);
		expect(names[0]).toBe("usa.gif:dashboard");
		expect(names[1]).toBe("synthsun.gif:store");
		expect(names).toContain("pulser-cube.gif:dashboard");
		expect(names).not.toContain("pulser-cube.gif:gallery");
		expect(names.filter((n) => n.startsWith("usa.gif"))).toHaveLength(1);
		expect(names.slice(-2)).toEqual(["flag.png:uploaded", "logo.png:gallery"]);
	});

	it("keeps a baked-in picture as its address, without its version", () => {
		expect(referenceOf(served[1])).toBe("/__coder-ui/image-store/synthsun.gif");
		expect([
			isBaked(served[1]),
			isBaked(served[0]),
			isBaked(served[3]),
		]).toEqual([true, false, false]);
	});
});
