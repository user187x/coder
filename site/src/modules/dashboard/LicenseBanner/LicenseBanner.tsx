import {
	LicenseAgentRuntimeHoursClaimsIgnoredWarningText,
	LicenseAgentRuntimeHoursSoftLimitWarningText,
	LicenseAgentRuntimeUsageUnavailableErrorText,
	LicenseAIGovernance90PercentWarningText,
	LicenseAIGovernanceOverLimitWarningText,
} from "#/api/typesGenerated";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import {
	type LicenseBannerMessage,
	LicenseBannerView,
} from "./LicenseBannerView";

const aiGovernanceOverLimitWarningPrefix =
	LicenseAIGovernanceOverLimitWarningText.split("%d")[0];
const aiGovernanceNearLimitWarningPrefix =
	LicenseAIGovernance90PercentWarningText.split("%d%%")[0];
const agentRuntimeSoftLimitWarningPrefix =
	LicenseAgentRuntimeHoursSoftLimitWarningText.split("%d")[0];
const AI_GOVERNANCE_NEAR_LIMIT_FALLBACK_MESSAGE =
	"You are approaching your AI Governance add-on seat limit.";

const isAIGovernanceWarning = (message: string): boolean =>
	message.startsWith(aiGovernanceNearLimitWarningPrefix) ||
	message.startsWith(aiGovernanceOverLimitWarningPrefix);

// Substitutes the given values into the template's %d placeholders in order.
// No other fmt verb, width, or flag is implemented. Exported for the
// stories, so what they pin is what production renders.
export const formatLicenseMessage = (
	template: string,
	...values: number[]
): string =>
	values.reduce(
		(message, value) => message.replace("%d", `${value}`),
		template,
	);

// Diagnostics about the license or the usage measurement rather than about
// usage itself. They render muted, without the exceedance heading, even when
// they arrive via entitlements.errors.
const diagnosticMessages: readonly string[] = [
	LicenseAgentRuntimeUsageUnavailableErrorText,
	LicenseAgentRuntimeHoursClaimsIgnoredWarningText,
];

const isDiagnosticMessage = (message: string): boolean =>
	diagnosticMessages.includes(message);

// Advisories render muted to stay visually distinct from warnings that
// demand action, such as reaching the runtime hours allocation.
const isAdvisoryMessage = (message: string): boolean =>
	message.startsWith(aiGovernanceNearLimitWarningPrefix) ||
	message.startsWith(agentRuntimeSoftLimitWarningPrefix);

const aiGovernanceOverLimitMessage = (
	feature: ReturnType<
		typeof useDashboard
	>["entitlements"]["features"]["ai_governance_user_limit"],
): string | null => {
	if (!feature) {
		return null;
	}

	const { actual, entitlement, limit } = feature;
	if (
		(entitlement !== "entitled" && entitlement !== "grace_period") ||
		actual === undefined ||
		limit === undefined ||
		limit <= 0 ||
		actual <= limit
	) {
		return null;
	}

	const overLimitSeats = actual - limit;
	return formatLicenseMessage(
		LicenseAIGovernanceOverLimitWarningText,
		actual,
		limit,
		overLimitSeats,
	);
};

const aiGovernanceNearLimitMessage = (
	feature: ReturnType<
		typeof useDashboard
	>["entitlements"]["features"]["ai_governance_user_limit"],
): string | null => {
	if (!feature) {
		return null;
	}

	const { actual, entitlement, limit } = feature;
	if (
		(entitlement !== "entitled" && entitlement !== "grace_period") ||
		actual === undefined ||
		limit === undefined ||
		limit <= 0
	) {
		return null;
	}

	const usedPercent = Math.floor((actual * 100) / limit);
	if (usedPercent < 90) {
		return null;
	}

	return LicenseAIGovernance90PercentWarningText.replace(
		"%d%%",
		`${usedPercent}%`,
	);
};

const normalizeAIGovernanceWarning = (
	message: string,
	feature: ReturnType<
		typeof useDashboard
	>["entitlements"]["features"]["ai_governance_user_limit"],
): string => {
	if (message !== LicenseAIGovernance90PercentWarningText) {
		return message;
	}

	return (
		aiGovernanceNearLimitMessage(feature) ??
		AI_GOVERNANCE_NEAR_LIMIT_FALLBACK_MESSAGE
	);
};

// Classifies a raw entitlements message once and carries the result as
// structured message data, so rendering branches on the message's kind and
// variant fields rather than re-matching display text.
const toBannerMessage = (
	message: string,
	channel: "errors" | "warnings",
): LicenseBannerMessage => {
	// Measurement diagnostics travel in the errors channel but are not
	// license errors. They render muted and point the operator at the logs.
	if (isDiagnosticMessage(message)) {
		return { message, variant: "warning", kind: "diagnostic" };
	}
	if (channel === "errors") {
		return { message, variant: "error" };
	}
	return {
		message,
		variant: isAdvisoryMessage(message) ? "warning" : "warningProminent",
	};
};

export const LicenseBanner: React.FC = () => {
	const { entitlements } = useDashboard();
	const { errors } = entitlements;
	const warnings = [...entitlements.warnings];
	const aiGovernanceUserLimitFeature =
		entitlements.features.ai_governance_user_limit;
	const overLimitWarning = aiGovernanceOverLimitMessage(
		aiGovernanceUserLimitFeature,
	);

	if (
		overLimitWarning &&
		!warnings.some((warning) => isAIGovernanceWarning(warning))
	) {
		warnings.push(overLimitWarning);
	}

	const normalizedWarnings = warnings.map((warning) =>
		normalizeAIGovernanceWarning(warning, aiGovernanceUserLimitFeature),
	);

	const messages: LicenseBannerMessage[] = [
		...errors.map((message) => toBannerMessage(message, "errors")),
		...normalizedWarnings.map((message) =>
			toBannerMessage(message, "warnings"),
		),
	];

	if (messages.length === 0) {
		return null;
	}

	return <LicenseBannerView messages={messages} />;
};
