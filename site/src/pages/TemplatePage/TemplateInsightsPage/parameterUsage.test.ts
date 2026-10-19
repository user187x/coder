import type {
	TemplateParameterUsage,
	TemplateVersionParameter,
} from "#/api/typesGenerated";
import { MockTemplateVersionParameter1 } from "#/testHelpers/entities";
import { mergeParameterUsage } from "./parameterUsage";

const option = (value: string, name: string) => ({
	value,
	name,
	description: "",
	icon: "",
});
const entry = (
	name: string,
	values: Record<string, number>,
	options?: ReturnType<typeof option>[],
	description = "",
): TemplateParameterUsage => ({
	template_ids: ["t"],
	name,
	display_name: name.toUpperCase(),
	type: "string",
	description,
	options,
	values: Object.entries(values).map(([value, count]) => ({ value, count })),
});
const param = (
	name: string,
	options: ReturnType<typeof option>[],
	display_name = name,
): TemplateVersionParameter => ({
	...MockTemplateVersionParameter1,
	name,
	display_name,
	description: `**${display_name}** now`,
	description_plaintext: `${display_name} now`,
	options,
});

describe("mergeParameterUsage", () => {
	it("makes one entry per parameter, its counts added up (UBUNTU's CPU had two)", () => {
		const merged = mergeParameterUsage(
			[
				entry("cpu", { "2": 25, "8": 2, "6": 1 }, [
					option("2", "2 Cores"),
					option("6", "6 Cores"),
					option("8", "8 Cores"),
				]),
				entry("cpu", { "2": 36, "6": 2 }, [
					option("2", "2 Cores"),
					option("6", "6 Cores"),
				]),
			],
			[param("cpu", [option("2", "2 Cores"), option("4", "4 Cores")], "CPU")],
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].display_name).toBe("CPU");
		expect(merged[0].description).toBe("CPU now");
		expect(merged[0].values).toEqual([
			{ value: "2", count: 61 },
			{ value: "6", count: 3 },
			{ value: "8", count: 2 },
		]);
		// 6 and 8 keep their old options' names; the active version offers 2 and 4
		expect(merged[0].options?.map((o) => o.name)).toEqual([
			"2 Cores",
			"4 Cores",
			"6 Cores",
			"8 Cores",
		]);
		expect([...(merged[0].offered ?? [])]).toEqual(["2", "4"]);
	});

	it("joins a typed-in value with the same value chosen later from options", () => {
		const merged = mergeParameterUsage(
			[
				entry("workspace_image", { "registry/ws:1.8.5": 9, "custom/x": 1 }),
				entry("workspace_image", { template: 6, "registry/ws:1.8.5": 1 }, [
					option("template", "The template's image"),
					option("registry/ws:1.8.5", "1.8.5"),
				]),
			],
			[param("workspace_image", [option("template", "The template's image")])],
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].values).toEqual([
			{ value: "registry/ws:1.8.5", count: 10 },
			{ value: "template", count: 6 },
			{ value: "custom/x", count: 1 },
		]);
		expect(merged[0].options?.find((o) => o.value === "custom/x")).toBe(
			undefined,
		);
	});

	it("leaves out a value its own version's options do not hold", () => {
		const merged = mergeParameterUsage([
			entry("theme", { gone: 3, serenade: 2 }, [
				option("serenade", "Serenade"),
			]),
		]);
		expect(merged[0].values).toEqual([{ value: "serenade", count: 2 }]);
	});

	it("orders by the active version and marks parameters it no longer has", () => {
		const merged = mergeParameterUsage(
			[
				entry("old", { a: 1 }),
				entry("memory", { "2": 1 }),
				entry("cpu", { "2": 1 }),
			],
			[param("cpu", []), param("memory", [])],
		);
		expect(merged.map((p) => [p.name, p.removed])).toEqual([
			["cpu", false],
			["memory", false],
			["old", true],
		]);
		expect(merged[2].display_name).toBe("OLD");
	});
});
