import JSZip from "jszip";
import {
	buildTemplateExport,
	iconFileName,
	templateIconPaths,
} from "./templateExport";

const MAIN_TF = `
resource "coder_app" "drive" {
  icon = "/__icons/cloud-drive.svg" # files/icons/cloud-drive.svg
}
resource "coder_app" "files" { icon = "/icon/folder.svg" }
data "coder_parameter" "size" {
  icon = "/emojis/1f4be.png"
  option { icon = "/icon/memory.svg" }
  option { icon = "/icon/memory.svg" }
}
resource "coder_app" "remote" { icon = "https://example.com/x.svg" }
resource "coder_app" "interp" { icon = "\${local.icon}" }
`;

describe("templateExport", () => {
	it("finds the icons the template uses, on this deployment only, once each", () => {
		expect(
			templateIconPaths("/icon/ubuntu.svg?v=2", {
				"main.tf": MAIN_TF,
				"scripts/startup.sh": 'icon = "/icon/not-terraform.svg"',
			}),
		).toEqual([
			"/__icons/cloud-drive.svg",
			"/emojis/1f4be.png",
			"/icon/folder.svg",
			"/icon/memory.svg",
			"/icon/ubuntu.svg",
		]);
	});

	it("names each icon by where it is served", () => {
		expect(iconFileName("/icon/ubuntu.svg")).toBe("icons/icon/ubuntu.svg");
		expect(iconFileName("/__icons/cloud-drive.svg")).toBe(
			"icons/__icons/cloud-drive.svg",
		);
		expect(iconFileName("/icon/a%20b.svg")).toBe("icons/icon/a_b.svg");
	});

	it("exports the Terraform, the scripts and the icons together", async () => {
		const source = new JSZip();
		source.file("main.tf", MAIN_TF);
		source.file("scripts/startup.sh", "#!/bin/sh\necho hi\n");
		const blob = new Blob([
			new Uint8Array(await source.generateAsync({ type: "uint8array" })),
		]);
		const fetched: string[] = [];
		const result = await buildTemplateExport(
			blob,
			"/icon/ubuntu.svg",
			async (path) => {
				fetched.push(path);
				return path === "/emojis/1f4be.png"
					? null
					: new Blob([`<svg>${path}</svg>`]);
			},
		);
		expect(result.missing).toEqual(["/emojis/1f4be.png"]);
		const out = await JSZip.loadAsync(
			new Uint8Array(await result.zip.arrayBuffer()),
		);
		const names = Object.keys(out.files).filter((n) => !out.files[n].dir);
		expect(names.sort()).toEqual([
			"icons/__icons/cloud-drive.svg",
			"icons/icon/folder.svg",
			"icons/icon/memory.svg",
			"icons/icon/ubuntu.svg",
			"icons/index.json",
			"main.tf",
			"scripts/startup.sh",
		]);
		expect(await out.file("icons/icon/ubuntu.svg")?.async("string")).toBe(
			"<svg>/icon/ubuntu.svg</svg>",
		);
		expect(await out.file("scripts/startup.sh")?.async("string")).toContain(
			"echo hi",
		);
		const index = JSON.parse(
			(await out.file("icons/index.json")?.async("string")) ?? "[]",
		);
		expect(index).toContainEqual({
			url: "/__icons/cloud-drive.svg",
			file: "icons/__icons/cloud-drive.svg",
		});
		expect(fetched).not.toContain("https://example.com/x.svg");
	});
});
