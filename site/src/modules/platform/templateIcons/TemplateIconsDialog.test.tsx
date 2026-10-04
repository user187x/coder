import { iconNameFromFile } from "./TemplateIconsDialog";

describe("iconNameFromFile", () => {
	it.each([
		["Docker.svg", "docker"],
		["My Team Logo (v2).PNG", "my-team-logo-v2"],
		["__gpu_node.gif", "gpu_node"],
		["build.runner.webp", "build.runner"],
		["???.png", ""],
	])("names %s as %s", (fileName, name) => {
		expect(iconNameFromFile(fileName)).toBe(name);
	});
});
