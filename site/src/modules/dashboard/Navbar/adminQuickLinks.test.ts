import { MaxAdminQuickLinks } from "#/api/typesGenerated";
import { MockNoPermissions, MockPermissions } from "#/testHelpers/entities";
import {
	addableAdminPages,
	adminPagesFor,
	resolveAdminQuickLinks,
} from "./adminQuickLinks";

const allPages = adminPagesFor({
	permissions: MockPermissions,
	oauth2Provider: true,
	canViewAISettings: true,
});
const ids = (pages: readonly { id: string }[]) => pages.map((page) => page.id);

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

	it("lists General's categories in the order of its sidebar", () => {
		expect(allPages.map((page) => page.label)).toEqual([
			"Accounts",
			"Super Intelligence",
			"Announcement",
			"Authentication",
			"Classification",
			"Customize",
			"Health",
			"Monitoring",
			"Network",
			"Notifications",
			"OAuth2 Applications",
			"Observability",
			"Overview",
			"Persistence",
			"Security",
		]);
	});

	it("gives every page a distinct ID", () => {
		expect(new Set(ids(allPages)).size).toBe(allPages.length);
	});

	it("can link every category", () => {
		expect(allPages.length).toBeLessThanOrEqual(MaxAdminQuickLinks);
	});
});

describe("resolveAdminQuickLinks", () => {
	it("has no quick links until the user adds some", () => {
		expect(resolveAdminQuickLinks([], allPages)).toEqual([]);
	});

	it("keeps the user's order", () => {
		expect(
			ids(resolveAdminQuickLinks(["network", "health", "accounts"], allPages)),
		).toEqual(["network", "health", "accounts"]);
	});

	it("drops pages that are unknown or no longer allowed", () => {
		const pages = allPages.filter((page) => page.id !== "network");
		expect(
			ids(resolveAdminQuickLinks(["network", "removed-page", "health"], pages)),
		).toEqual(["health"]);
	});

	it("never shows a page twice", () => {
		expect(
			ids(resolveAdminQuickLinks(["health", "health", "security"], allPages)),
		).toEqual(["health", "security"]);
	});
});

describe("addableAdminPages", () => {
	it("offers every page not linked yet, in sidebar order", () => {
		const links = resolveAdminQuickLinks(["network", "accounts"], allPages);
		const addable = ids(addableAdminPages(links, allPages));
		expect(addable).not.toContain("network");
		expect(addable).not.toContain("accounts");
		expect(addable[0]).toBe("super-intelligence");
		expect(addable.length).toBe(allPages.length - 2);
	});

	it("offers nothing once every page is linked", () => {
		expect(addableAdminPages(allPages, allPages)).toEqual([]);
	});
});
