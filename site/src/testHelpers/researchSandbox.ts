import type { ImagesAPI } from "#/api/images";

export const MockResearchSandbox = {
	image: `registry.example.test/research@sha256:${"a".repeat(64)}`,
	template: "default",
} satisfies NonNullable<
	Awaited<ReturnType<typeof ImagesAPI.list>>["researchSandbox"]
>;
