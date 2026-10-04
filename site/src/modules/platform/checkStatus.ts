import type { KeycloakCheckStatus } from "#/api/platform";

/** How a check's status reads on its badge, in the guided setup views (Keycloak, Persistence). */
export const CHECK_STATUS_LABELS: Record<KeycloakCheckStatus, string> = {
	ok: "OK",
	warn: "Needs fix",
	error: "Problem",
	info: "Note",
	unknown: "Unknown",
};

export const CHECK_STATUS_VARIANTS = {
	ok: "green",
	warn: "warning",
	error: "destructive",
	info: "default",
	unknown: "default",
} as const;

/** The most severe status among the checks, for a view's headline. */
export const worstCheckStatus = (
	checks: readonly { status: KeycloakCheckStatus }[],
): "error" | "warn" | "ok" =>
	checks.some((c) => c.status === "error")
		? "error"
		: checks.some((c) => c.status === "warn")
			? "warn"
			: "ok";
