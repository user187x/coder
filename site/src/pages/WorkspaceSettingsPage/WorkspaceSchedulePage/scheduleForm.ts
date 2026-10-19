/**
 * The workspace schedule's form values and their validation: autostart (days, time, timezone) and autostop (hours),
 * as the workspace settings page's Schedule card edits them.
 */
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import * as Yup from "yup";
import { humanDuration } from "#/utils/time";

// Need dayjs.tz functions for timezone validation
dayjs.extend(timezone);

export type WorkspaceScheduleFormValues = {
	autostartEnabled: boolean;
	sunday: boolean;
	monday: boolean;
	tuesday: boolean;
	wednesday: boolean;
	thursday: boolean;
	friday: boolean;
	saturday: boolean;
	startTime: string;
	timezone: string;
	autostopEnabled: boolean;
	ttl: number;
};

export const validationSchema = Yup.object({
	sunday: Yup.boolean(),
	monday: Yup.boolean().test(
		"at-least-one-day",
		"Must set at least one day of week if autostart is enabled.",
		function (value) {
			const parent = this.parent as WorkspaceScheduleFormValues;

			if (!parent.autostartEnabled) {
				return true;
			}

			// Ensure at least one day is enabled
			return [
				parent.sunday,
				value,
				parent.tuesday,
				parent.wednesday,
				parent.thursday,
				parent.friday,
				parent.saturday,
			].some((day) => day);
		},
	),
	tuesday: Yup.boolean(),
	wednesday: Yup.boolean(),
	thursday: Yup.boolean(),
	friday: Yup.boolean(),
	saturday: Yup.boolean(),

	startTime: Yup.string()
		.ensure()
		.test(
			"required-if-autostart",
			"Start time is required when autostart is enabled.",
			function (value) {
				const parent = this.parent as WorkspaceScheduleFormValues;
				if (parent.autostartEnabled) {
					return value !== "";
				}
				return true;
			},
		)
		.test("is-time-string", "Time must be in HH:mm format.", (value) => {
			if (value === "") {
				return true;
			}
			if (!/^[0-9][0-9]:[0-9][0-9]$/.test(value)) {
				return false;
			}
			const parts = value.split(":");
			const HH = Number(parts[0]);
			const mm = Number(parts[1]);
			return HH >= 0 && HH <= 23 && mm >= 0 && mm <= 59;
		}),
	timezone: Yup.string()
		.ensure()
		.test("is-timezone", "Invalid timezone.", function (value) {
			const parent = this.parent as WorkspaceScheduleFormValues;

			if (!parent.startTime) {
				return true;
			}
			// Unfortunately, there's not a good API on dayjs at this time for
			// evaluating a timezone. Attempt to parse today in the supplied timezone
			// and return as valid if the function doesn't throw.
			// Need to use dayjs.tz directly here as our utility functions don't expose validation
			try {
				dayjs.tz(dayjs(), value);
				return true;
			} catch {
				return false;
			}
		}),
	ttl: Yup.number()
		.min(0)
		.max(
			24 * 30 /* 30 days */,
			"Please enter a limit that is less than or equal to 30 days (720 hours).",
		)
		.test(
			"positive-if-autostop",
			"Time until shutdown must be greater than zero when autostop is enabled.",
			function (value) {
				const parent = this.parent as WorkspaceScheduleFormValues;
				if (parent.autostopEnabled) {
					return Boolean(value);
				}
				return true;
			},
		),
});

export const ttlShutdownAt = (formTTL: number): string => {
	if (formTTL === 0) {
		// Passing an empty value for TTL in the form results in a number that is not zero but less than 1.
		return "Your workspace will not automatically shut down.";
	}

	try {
		return `Your workspace will shut down ${humanDuration(formTTL * 60 * 60 * 1000)} after its next start.`;
	} catch (e) {
		if (e instanceof RangeError) {
			return "Please enter a limit that is less than or equal to 30 days (720 hours).";
		}
		throw e;
	}
};
