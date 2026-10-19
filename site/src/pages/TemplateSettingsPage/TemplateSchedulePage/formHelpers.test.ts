import {
	getValidationSchema,
	type TemplateScheduleFormValues,
} from "./formHelpers";

const validFormValues: TemplateScheduleFormValues = {
	default_ttl_ms: 1,
	activity_bump_ms: 1,
	time_til_autostop_notify_ms: 1,
	failure_ttl_ms: 7,
	time_til_dormant_ms: 180,
	time_til_dormant_autodelete_ms: 30,
	update_workspace_last_used_at: false,
	update_workspace_dormant_at: false,
	autostop_requirement_days_of_week: "off",
	autostop_requirement_weeks: 1,
	failure_cleanup_enabled: false,
	inactivity_cleanup_enabled: false,
	dormant_autodeletion_cleanup_enabled: false,
	require_active_version: false,
	autostart_requirement_days_of_week: [
		"monday",
		"tuesday",
		"wednesday",
		"thursday",
		"friday",
		"saturday",
		"sunday",
	],
	disable_everyone_group_access: false,
};

describe("the template schedule's validation", () => {
	it("allows a default ttl of 7 days", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			default_ttl_ms: 24 * 7,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("allows default ttl of 0", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			default_ttl_ms: 0,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("allows a default ttl of 30 days", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			default_ttl_ms: 24 * 30,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("disallows a default ttl of 30 days + 1 hour", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			default_ttl_ms: 24 * 30 + 1,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).toThrowError(
			"Please enter a limit that is less than or equal to 720 hours (30 days).",
		);
	});

	it("allows a failure ttl of 7 days", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			failure_ttl_ms: 86400000 * 7,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("allows failure ttl of 0", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			failure_ttl_ms: 0,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("disallows a negative failure ttl", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			failure_ttl_ms: -1,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).toThrowError(
			"Failure cleanup days must not be less than 0.",
		);
	});

	it("allows an inactivity ttl of 7 days", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			time_til_dormant_ms: 86400000 * 7,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("allows an inactivity ttl of 0", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			time_til_dormant_ms: 0,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("disallows a negative inactivity ttl", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			time_til_dormant_ms: -1,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).toThrowError(
			"Dormancy threshold must not be less than 0.",
		);
	});

	it("allows a dormancy ttl of 7 days", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			time_til_dormant_autodelete_ms: 86400000 * 7,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("allows a dormancy ttl of 0", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			time_til_dormant_autodelete_ms: 0,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("disallows a negative inactivity ttl", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			time_til_dormant_autodelete_ms: -1,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).toThrowError(
			"Dormancy auto-deletion days must not be less than 0.",
		);
	});

	it("allows an autostop requirement weeks of 1", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			autostop_requirement_days_of_week: "saturday",
			autostop_requirement_weeks: 1,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("allows a autostop requirement weeks of 16", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			autostop_requirement_weeks: 16,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).not.toThrowError();
	});

	it("disallows a autostop requirement weeks of 0", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			autostop_requirement_weeks: 0,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).toThrowError();
	});

	it("disallows a autostop requirement weeks of 17", () => {
		const values: TemplateScheduleFormValues = {
			...validFormValues,
			autostop_requirement_weeks: 17,
		};
		const validate = () => getValidationSchema().validateSync(values);
		expect(validate).toThrowError();
	});
});
