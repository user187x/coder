import { adminPageChoices } from "#/modules/dashboard/Navbar/adminQuickLinks";
import { MockNoPermissions } from "#/testHelpers/entities";
import { labelSize } from "./Wheel";
import { DEFAULT_WHEEL, wheelChoices, wheelOf } from "./wheelChoices";

describe("the wheel's choices", () => {
	it("are the dashboard's pages and every admin category, each once", () => {
		const ids = wheelChoices().map((c) => c.id);
		for (const page of adminPageChoices()) {
			expect(ids).toContain(page.id);
		}
		expect(ids).toEqual(
			expect.arrayContaining([
				"workspaces",
				"leases",
				"templates",
				"images",
				"account",
				"hud",
				"quick-menu",
			]),
		);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("are the admins' arrangement, unknown ones left out; none or too few: the default eight", () => {
		expect(
			wheelOf(["security", "nope", "images", "health"]).map((c) => c.id),
		).toEqual(["security", "images", "health"]);
		expect(wheelOf(null).map((c) => c.id)).toEqual([...DEFAULT_WHEEL]);
		expect(wheelOf(["images", "nope"]).map((c) => c.id)).toEqual([
			...DEFAULT_WHEEL,
		]);
	});

	it("fit a long name to a narrow wedge", () => {
		expect(labelSize("HUD", 45)).toBe(13);
		expect(labelSize("Notifications", 30)).toBeLessThan(13);
		expect(labelSize("Notifications", 30)).toBeGreaterThanOrEqual(8);
	});
});

it("keeps saved Observability wedges as Monitoring without duplicates", () => {
	expect(
		wheelOf(["observability", "monitoring", "workspaces", "templates"]).map(
			(c) => c.id,
		),
	).toEqual(["monitoring", "workspaces", "templates"]);
});

it("requires deployment update access for the leases shortcut", () => {
	const leases = wheelChoices().find((entry) => entry.id === "leases");
	const permissions = {
		...MockNoPermissions,
		viewAllUsers: true,
		createUser: true,
	};
	expect(leases?.allowed({ permissions, oauth2Provider: false })).toBe(false);
	expect(
		leases?.allowed({
			permissions: { ...permissions, editDeploymentConfig: true },
			oauth2Provider: false,
		}),
	).toBe(true);
});
