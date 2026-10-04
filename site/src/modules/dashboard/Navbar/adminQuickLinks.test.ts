import { MockNoPermissions, MockPermissions } from "#/testHelpers/entities";
import {
	adminPagesFor,
	adminQuickLinksToSave,
	resolveAdminQuickLinks,
} from "./adminQuickLinks";

const allPages = adminPagesFor({
	permissions: MockPermissions,
	oauth2Provider: true,
	canViewAISettings: true,
});
const ids = (pages: readonly ({ id: string } | undefined)[]) =>
	pages.map((page) => page?.id);

describe("adminPagesFor", () => {
	it("offers only the pages the user can open", () => {
		expect(
			ids(
				adminPagesFor({
					permissions: { ...MockNoPermissions, viewAllUsers: true },
					oauth2Provider: true,
					canViewAISettings: false,
				}),
			),
		).toEqual(["accounts"]);
	});

	it("offers OAuth2 applications only where the deployment provides them", () => {
		const without = adminPagesFor({
			permissions: MockPermissions,
			oauth2Provider: false,
			canViewAISettings: true,
		});
		expect(ids(allPages)).toContain("oauth2-applications");
		expect(ids(without)).not.toContain("oauth2-applications");
	});

	it("gives every page a distinct ID", () => {
		expect(new Set(ids(allPages)).size).toBe(allPages.length);
	});
});

describe("resolveAdminQuickLinks", () => {
	it("uses Accounts and Health until the user chooses", () => {
		expect(ids(resolveAdminQuickLinks([], allPages))).toEqual([
			"accounts",
			"health",
		]);
	});

	it("uses the user's choices", () => {
		expect(
			ids(resolveAdminQuickLinks(["network", "notifications"], allPages)),
		).toEqual(["network", "notifications"]);
	});

	it("falls back to a slot's default when its page is unknown or no longer allowed", () => {
		const pages = allPages.filter((page) => page.id !== "network");
		expect(
			ids(resolveAdminQuickLinks(["network", "removed-page"], pages)),
		).toEqual(["accounts", "health"]);
	});

	it("never shows a page twice", () => {
		expect(
			ids(resolveAdminQuickLinks(["health", "unknown"], allPages)),
		).toEqual(["health", undefined]);
	});
});

describe("adminQuickLinksToSave", () => {
	it("stores nothing for the defaults, so the user follows future defaults", () => {
		expect(adminQuickLinksToSave(["accounts", "health"])).toEqual([]);
		expect(adminQuickLinksToSave(["health", "accounts"])).toEqual([
			"health",
			"accounts",
		]);
	});
});
