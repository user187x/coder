import { TarReader, TarWriter } from "#/utils/tar";
import { withUploadedFiles } from "./UploadTemplateFiles";

const bytes = (blob: Blob | undefined) =>
	blob ? blob.arrayBuffer().then((b) => [...new Uint8Array(b)]) : [];

describe("Source Code > Upload", () => {
	// The test environment's File (jsdom's) has no arrayBuffer(), unlike browsers'
	beforeAll(() => {
		if (!("arrayBuffer" in File.prototype)) {
			Object.defineProperty(File.prototype, "arrayBuffer", {
				configurable: true,
				value(this: File) {
					return new Promise<ArrayBuffer>((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => resolve(reader.result as ArrayBuffer);
						reader.onerror = () => reject(reader.error);
						reader.readAsArrayBuffer(this);
					});
				},
			});
		}
	});

	it("adds the files to the folder, replaces one of the same name, keeps the rest as it was (binary too)", async () => {
		const icon = new Uint8Array([0, 255, 1, 254, 137, 80, 78, 71]);
		const base = new TarWriter();
		base.addFile("main.tf", 'resource "x" "y" {}\n', { mode: 0o644 });
		base.addFolder("scripts", { mode: 0o755 });
		base.addFile("scripts/start.sh", "echo old\n", { mode: 0o755 });
		base.addFile("icon.png", icon.buffer, { mode: 0o644 });
		await base.write();
		const tar = base.buffer;

		const out = await withUploadedFiles(tar, "scripts", [
			new File(["echo new\n"], "start.sh"),
			new File([new Uint8Array([9, 8, 7])], "tool.bin"),
		]);

		const reader = new TarReader();
		await reader.readFile(new Uint8Array(await out.arrayBuffer()));
		expect(reader.fileInfo.map((f) => f.name).sort()).toEqual([
			"icon.png",
			"main.tf",
			"scripts",
			"scripts/start.sh",
			"scripts/tool.bin",
		]);
		expect(reader.getTextFile("main.tf")).toBe('resource "x" "y" {}\n');
		expect(reader.getTextFile("scripts/start.sh")).toBe("echo new\n");
		expect(await bytes(reader.getFileBlob("scripts/tool.bin"))).toEqual([
			9, 8, 7,
		]);
		expect(await bytes(reader.getFileBlob("icon.png"))).toEqual([...icon]);
	});

	it("puts files at the template's top for /", async () => {
		const base = new TarWriter();
		base.addFile("main.tf", "x\n");
		await base.write();
		const tar = base.buffer;
		const out = await withUploadedFiles(tar, "/", [
			new File(["# notes\n"], "README.md"),
		]);
		const reader = new TarReader();
		await reader.readFile(new Uint8Array(await out.arrayBuffer()));
		expect(reader.getTextFile("README.md")).toBe("# notes\n");
		expect(reader.getTextFile("main.tf")).toBe("x\n");
	});
});
