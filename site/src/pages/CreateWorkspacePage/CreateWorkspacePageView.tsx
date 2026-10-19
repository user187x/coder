import "#/modules/platform/settingsPage/settingsPage.css";
import { type FormikContextType, getIn, useFormik } from "formik";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import * as Yup from "yup";
import type * as TypesGen from "#/api/typesGenerated";
import type {
	FriendlyDiagnostic,
	PreviewParameter,
} from "#/api/typesGenerated";
import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { WorkspaceUserAutocomplete } from "#/components/Autocomplete/WorkspaceUserAutocomplete";
import { Avatar } from "#/components/Avatar/Avatar";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import {
	Combobox,
	ComboboxButton,
	ComboboxContent,
	ComboboxItem,
	ComboboxTrigger,
} from "#/components/Combobox/Combobox";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { useDebouncedFunction } from "#/hooks/debounce";
import type { ExternalAuthPollingState } from "#/hooks/useExternalAuth";
import { useSyncFormParameters } from "#/modules/hooks/useSyncFormParameters";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import { SaveBar } from "#/modules/platform/settingsPage/SaveBar";
import {
	type GlanceRow,
	SettingsNav,
	type SettingsNavLink,
} from "#/modules/platform/settingsPage/SettingsNav";
import { SettingsPageHeader } from "#/modules/platform/settingsPage/SettingsPageHeader";
import {
	ChipGlyph,
	ClockGlyph,
	GearGlyph,
	IdCardGlyph,
	MonitorGlyph,
	ShieldGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import {
	SettingsCard,
	ToggleRow,
} from "#/modules/platform/settingsPage/settingsParts";
import {
	Diagnostics,
	getInitialParameterValues,
	useValidationSchemaForDynamicParameters,
} from "#/modules/workspaces/DynamicParameter/DynamicParameter";
import { generateWorkspaceName } from "#/modules/workspaces/generateWorkspaceName";
import { EnvironmentCard } from "#/pages/WorkspaceSettingsPage/cards/EnvironmentCard";
import {
	RESOURCE_PARAMETERS,
	ResourcesCard,
} from "#/pages/WorkspaceSettingsPage/cards/ResourcesCard";
import type { ParameterControls } from "#/pages/WorkspaceSettingsPage/useBuildParameters";
import { nameValidator } from "#/utils/formUtils";
import type { AutofillBuildParameter } from "#/utils/richParameters";
import type { CreateWorkspaceMode } from "./CreateWorkspacePage";
import { ExternalAuthButton } from "./ExternalAuthButton";
import type { CreateWorkspacePermissions } from "./permissions";

const FORM_ID = "create-workspace-form";

type CreateWorkspacePageViewProps = {
	autofillParameters: AutofillBuildParameter[];
	canUpdateTemplate?: boolean;
	creatingWorkspace: boolean;
	defaultName?: string | null;
	defaultOwner: TypesGen.MinimalUser;
	diagnostics: readonly FriendlyDiagnostic[];
	disabledParams?: string[];
	error: unknown;
	externalAuth: TypesGen.TemplateVersionExternalAuth[];
	externalAuthPollingState: Record<string, ExternalAuthPollingState>;
	hasAllRequiredExternalAuth: boolean;
	hasIgnoredUrlParams?: boolean;
	mode: CreateWorkspaceMode;
	parameters: PreviewParameter[];
	permissions: CreateWorkspacePermissions;
	presets: TypesGen.Preset[];
	template: TypesGen.Template;
	urlPreset?: TypesGen.Preset;
	urlPresetError?: string;
	versionId?: string;
	versionName?: string;
	onCancel: () => void;
	onSubmit: (
		req: TypesGen.CreateWorkspaceRequest,
		owner: TypesGen.MinimalUser,
	) => void;
	resetMutation: () => void;
	sendMessage: (message: Record<string, string>, ownerId?: string) => void;
	startPollingExternalAuth: (providerId: string) => void;
	owner: TypesGen.MinimalUser;
	setOwner: (user: TypesGen.MinimalUser) => void;
	/** The Global Workspace Scheduler's, where it applies: its Schedule card's line and the user's fields. */
	scheduleCard?: { description: string; fields: React.ReactNode } | null;
	/** The schedule is not valid yet: the workspace cannot be created. */
	scheduleBlocked?: boolean;
};

export const CreateWorkspacePageView: React.FC<
	CreateWorkspacePageViewProps
> = ({
	autofillParameters,
	canUpdateTemplate,
	creatingWorkspace,
	defaultName,
	defaultOwner,
	diagnostics,
	disabledParams,
	error,
	externalAuth,
	externalAuthPollingState,
	hasAllRequiredExternalAuth,
	hasIgnoredUrlParams,
	mode,
	parameters,
	permissions,
	presets = [],
	template,
	urlPreset,
	urlPresetError,
	versionId,
	versionName,
	onSubmit,
	onCancel,
	resetMutation,
	sendMessage,
	startPollingExternalAuth,
	owner,
	setOwner,
	scheduleCard,
	scheduleBlocked,
}) => {
	const [suggestedName, setSuggestedName] = useState(generateWorkspaceName);
	const [showPresetParameters, setShowPresetParameters] = useState(false);
	const id = useId();
	const getLink = useLinks();
	const workspaceNameInputRef = useRef<HTMLInputElement>(null);
	const rerollSuggestedName = useCallback(() => {
		setSuggestedName(() => generateWorkspaceName());
	}, []);

	const autofillByName = Object.fromEntries(
		autofillParameters.map((param) => [param.name, param]),
	);

	// Only touched fields are sent to the websocket
	// Autofilled parameters are marked as touched since they have been modified
	const initialTouched = Object.fromEntries(
		parameters.filter((p) => autofillByName[p.name]).map((p) => [p.name, true]),
	);
	if (defaultName) {
		initialTouched.name = true;
	}

	// The form parameters values hold the working state of the parameters that will be submitted when creating a workspace
	// 1. The form parameter values are initialized from the websocket response when the form is mounted
	// 2. Only touched form fields are sent to the websocket, a field is touched if edited by the user or set by autofill
	// 3. The websocket response may add or remove parameters, these are added or removed from the form values in the useSyncFormParameters hook
	// 4. All existing form parameters are updated to match the websocket response
	//    in the useSyncFormParameters hook, unless they have been touched by the
	//    user or auto-filled.
	const form: FormikContextType<TypesGen.CreateWorkspaceRequest> =
		useFormik<TypesGen.CreateWorkspaceRequest>({
			initialValues: {
				name: defaultName ?? "",
				template_id: template.id,
				rich_parameter_values: getInitialParameterValues(
					parameters,
					autofillParameters,
				),
			},
			initialTouched,
			validationSchema: Yup.object({
				name: nameValidator("Workspace Name"),
				rich_parameter_values:
					useValidationSchemaForDynamicParameters(parameters),
			}),
			enableReinitialize: false,
			validateOnChange: true,
			validateOnBlur: true,
			onSubmit: (request) => {
				if (!hasAllRequiredExternalAuth) {
					return;
				}

				onSubmit(request, owner);
			},
		});

	useEffect(() => {
		if (error) {
			window.scrollTo(0, 0);
		}
	}, [error]);

	useEffect(() => {
		if (form.submitCount > 0 && Object.keys(form.errors).length > 0) {
			workspaceNameInputRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "center",
			});
			workspaceNameInputRef.current?.focus();
		}
	}, [form.submitCount, form.errors]);

	const [presetOptions, setPresetOptions] = useState([
		{ label: "None", value: "undefined", icon: "", description: "" },
	]);
	const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);
	// Build options and keep default label/value in sync
	useEffect(() => {
		const options = [
			{ label: "None", value: "undefined", icon: "", description: "" },
			...presets.map((preset) => ({
				label: preset.Default ? `${preset.Name} (Default)` : preset.Name,
				value: preset.ID,
				icon: preset.Icon,
				description: preset.Description,
			})),
		];
		setPresetOptions(options);

		// URL preset takes precedence over default preset.
		if (urlPreset) {
			const idx = presets.findIndex((p) => p.ID === urlPreset.ID) + 1;
			setSelectedPresetIndex(idx);
			form.setFieldValue("template_version_preset_id", urlPreset.ID);
			return;
		}

		const defaultPreset = presets.find((p) => p.Default);
		if (defaultPreset) {
			const idx = presets.indexOf(defaultPreset) + 1; // +1 for "None"
			setSelectedPresetIndex(idx);
			form.setFieldValue("template_version_preset_id", defaultPreset.ID);
		} else {
			setSelectedPresetIndex(0); // Explicitly set to "None"
			form.setFieldValue("template_version_preset_id", undefined);
		}
	}, [presets, form.setFieldValue, urlPreset]);

	const [presetParameterNames, setPresetParameterNames] = useState<string[]>(
		[],
	);

	// include any modified parameters and all touched parameters to the websocket request
	const { debounced: sendDynamicParamsRequest } = useDebouncedFunction(
		(
			parameters: Array<{ parameter: PreviewParameter; value: string }>,
			ownerId?: string,
		) => {
			const formInputs: Record<string, string> = {};
			const formParameters = form.values.rich_parameter_values ?? [];

			for (const { parameter, value } of parameters) {
				formInputs[parameter.name] = value;
			}

			for (const [fieldName, isTouched] of Object.entries(form.touched)) {
				if (
					isTouched &&
					!parameters.some((p) => p.parameter.name === fieldName)
				) {
					const param = formParameters.find((p) => p.name === fieldName);
					if (param?.value) {
						formInputs[fieldName] = param.value;
					}
				}
			}

			sendMessage(formInputs, ownerId);
		},
		(
			parameters: Array<{ parameter: PreviewParameter; value: string }>,
			_ownerId?: string,
		) => {
			// Return a debounce for string fields (those that involve typing) and
			// zero debounce for all others (so the UI can react immediately).
			return parameters.some(
				({ parameter }) =>
					parameter.form_type === "input" || parameter.form_type === "textarea",
			)
				? 500
				: 0;
		},
	);

	useEffect(() => {
		const selectedPresetOption = presetOptions[selectedPresetIndex];
		let selectedPreset: TypesGen.Preset | undefined;
		for (const preset of presets) {
			if (preset.ID === selectedPresetOption.value) {
				selectedPreset = preset;
				break;
			}
		}

		if (!selectedPreset?.Parameters) {
			setPresetParameterNames([]);
			return;
		}

		setPresetParameterNames(selectedPreset.Parameters.map((p) => p.Name));

		const currentValues = form.values.rich_parameter_values ?? [];

		const updates: Array<{
			field: string;
			fieldValue: TypesGen.WorkspaceBuildParameter;
			parameter: PreviewParameter;
			presetValue: string;
		}> = [];

		for (const presetParameter of selectedPreset.Parameters) {
			const parameterIndex = parameters.findIndex(
				(p) => p.name === presetParameter.Name,
			);
			if (parameterIndex === -1) continue;

			const parameterField = `rich_parameter_values.${parameterIndex}`;
			const parameter = parameters[parameterIndex];
			const currentValue = currentValues.find(
				(p) => p.name === presetParameter.Name,
			)?.value;

			if (currentValue !== presetParameter.Value) {
				updates.push({
					field: parameterField,
					fieldValue: {
						name: presetParameter.Name,
						value: presetParameter.Value,
					},
					parameter,
					presetValue: presetParameter.Value,
				});
			}
		}

		if (updates.length > 0) {
			for (const update of updates) {
				form.setFieldValue(update.field, update.fieldValue);
				form.setFieldTouched(update.parameter.name, true);
			}

			sendDynamicParamsRequest(
				updates.map((update) => ({
					parameter: update.parameter,
					value: update.presetValue,
				})),
			);
		}
	}, [
		presetOptions,
		selectedPresetIndex,
		presets,
		form.setFieldValue,
		form.setFieldTouched,
		parameters,
		form.values.rich_parameter_values,
		sendDynamicParamsRequest,
	]);

	const handleOwnerChange = (user: TypesGen.MinimalUser) => {
		setOwner(user);
		sendDynamicParamsRequest([], user.id);
	};

	const handleChange = async (
		parameter: PreviewParameter,
		parameterField: string,
		value: string,
	) => {
		const currentFormValue = form.values.rich_parameter_values?.find(
			(p) => p.name === parameter.name,
		)?.value;

		await form.setFieldValue(parameterField, {
			name: parameter.name,
			value,
		});

		// Only send the request if the value has changed from the form value
		if (currentFormValue !== value) {
			form.setFieldTouched(parameter.name, true);
			sendDynamicParamsRequest([{ parameter, value }]);
		}
	};

	useSyncFormParameters({
		parameters,
		formValues: form.values.rich_parameter_values ?? [],
		touched: form.touched,
		setFieldValue: form.setFieldValue,
	});

	const disabled =
		creatingWorkspace ||
		!hasAllRequiredExternalAuth ||
		diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
		parameters.some((parameter) =>
			parameter.diagnostics.some(
				(diagnostic) => diagnostic.severity === "error",
			),
		);

	// External auth is connected to the workspace owner. When creating a
	// workspace for another user, the form reflects that owner's auth state and
	// the requester cannot authenticate on their behalf.
	const isCreatingForSelf = owner.id === defaultOwner.id;

	// The parameters as the page's Resources and Environment cards take them (the workspace settings page's cards).
	const values = form.values.rich_parameter_values ?? [];
	const lockedByLink = (name: string) =>
		Boolean(disabledParams?.includes(name.toLowerCase().replace(/ /g, "_")));
	// A preset's are held, and out of sight unless asked for (or something is wrong with them).
	const shown = parameters.filter(
		(p) =>
			showPresetParameters ||
			!presetParameterNames.includes(p.name) ||
			p.diagnostics.length > 0,
	);
	const controls: ParameterControls = {
		ready: true,
		parameters: shown,
		parameter: (name) => shown.find((p) => p.name === name),
		value: (name) => values.find((v) => v.name === name)?.value ?? "",
		fieldError: (name) => {
			const index = values.findIndex((v) => v.name === name);
			const message =
				index < 0
					? undefined
					: getIn(form.errors, `rich_parameter_values.${index}.value`);
			return getIn(form.touched, name) && typeof message === "string"
				? message
				: undefined;
		},
		change: async (parameter, value) => {
			const index = values.findIndex((v) => v.name === parameter.name);
			await handleChange(
				parameter,
				`rich_parameter_values.${index < 0 ? values.length : index}`,
				value,
			);
		},
		disabled: false,
		creating: true,
		locked: (name) => presetParameterNames.includes(name) || lockedByLink(name),
	};
	const hasResources = RESOURCE_PARAMETERS.some((name) =>
		controls.parameter(name),
	);
	const hasEnvironment = shown.some(
		(p) => !RESOURCE_PARAMETERS.includes(p.name),
	);
	const ownEnvironment = [
		"desktop_theme",
		"workspace_image",
		"start_directory",
	].some((name) => controls.parameter(name));

	const links: SettingsNavLink[] = [
		{ id: "general", label: "General", icon: <GearGlyph /> },
		...(externalAuth.length > 0
			? [
					{
						id: "external-auth",
						label: "External authentication",
						icon: <ShieldGlyph />,
					},
				]
			: []),
		...(hasResources
			? [{ id: "resources", label: "Resources", icon: <ChipGlyph /> }]
			: []),
		...(hasEnvironment
			? [
					{
						id: "environment",
						label: ownEnvironment ? "Environment" : "Parameters",
						icon: <MonitorGlyph />,
					},
				]
			: []),
		...(scheduleCard
			? [{ id: "schedule", label: "Schedule", icon: <ClockGlyph /> }]
			: []),
	];
	const option = (name: string) => {
		const parameter = controls.parameter(name);
		return parameter?.options.find(
			(o) => o.value.value === controls.value(name),
		)?.name;
	};
	const gpus = controls.value("gpus");
	const templateName = template.display_name || template.name;
	const glance: GlanceRow[] = [
		{ label: "Template", value: templateName },
		{ label: "Owner", value: owner.username },
		...(presets.length > 0
			? [
					{
						label: "Preset",
						value: presetOptions[selectedPresetIndex]?.label ?? "None",
					},
				]
			: []),
		...(controls.parameter("cpu")
			? [{ label: "CPU", value: `${controls.value("cpu")} cores`, mono: true }]
			: []),
		...(controls.parameter("memory")
			? [
					{
						label: "Memory",
						value: `${controls.value("memory")} GB`,
						mono: true,
					},
				]
			: []),
		...(controls.parameter("gpus")
			? [
					{
						label: "GPU",
						value:
							!gpus || gpus === "0"
								? "Off"
								: gpus === "1"
									? "On"
									: `On · ${gpus}`,
					},
				]
			: []),
		...(controls.parameter("home_disk_size")
			? [
					{
						label: "Disk",
						value: `${controls.value("home_disk_size")} GB`,
						mono: true,
					},
				]
			: []),
		...(controls.parameter("desktop_theme")
			? [{ label: "Theme", value: option("desktop_theme") ?? "–" }]
			: []),
	];
	const nameField = `${id}-workspace-name`;

	return (
		<div className="ws-settings min-h-full">
			<SettingsPageHeader
				icon={
					<Avatar
						variant="icon"
						size="md"
						src={template.icon}
						fallback={template.name}
					/>
				}
				crumbs={[
					{ label: "Templates", to: "/templates" },
					{
						label: templateName,
						to: getLink(
							linkToTemplate(template.organization_name, template.name),
						),
					},
				]}
				title="New workspace"
				versionId={versionId}
				actions={
					<>
						{template.deprecated && (
							<Badge variant="warning" size="sm">
								Deprecated
							</Badge>
						)}
						{canUpdateTemplate && versionName && (
							<RouterLink
								className="ws-btn ws-hit no-underline"
								to={`/templates/${template.organization_name}/${template.name}/versions/${versionName}/edit`}
							>
								<ExternalLinkIcon className="size-4" />
								View source
							</RouterLink>
						)}
					</>
				}
			/>

			<div className="mx-auto flex max-w-(--ws-content) flex-wrap items-start gap-8 p-8">
				<SettingsNav links={links} glance={glance} heading="New workspace" />

				<main className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
					{Boolean(error) && <ErrorAlert error={error} />}

					{template.use_classic_parameter_flow && (
						<Alert
							severity="warning"
							prominent
							actions={
								canUpdateTemplate && (
									<Button asChild size="sm">
										<RouterLink
											to={`/templates/${template.organization_name}/${template.name}/settings#parameters`}
										>
											Open template settings
										</RouterLink>
									</Button>
								)
							}
						>
							<AlertTitle>This template uses deprecated parameters</AlertTitle>
							<AlertDescription>
								Some features like real-time validation and conditional
								parameters won&apos;t work here until the template is switched
								to dynamic parameters.
							</AlertDescription>
						</Alert>
					)}

					{urlPresetError && (
						<Alert severity="warning" dismissible>
							{urlPresetError}
						</Alert>
					)}

					{hasIgnoredUrlParams && urlPreset && (
						<Alert severity="info" dismissible>
							Preset selected. <code>param.*</code> URL parameters have been
							ignored. Use either <code>preset</code> or <code>param.*</code>,
							not both.
						</Alert>
					)}

					{mode === "duplicate" && (
						<Alert
							severity="info"
							dismissible
							data-testid="duplication-warning"
						>
							Duplicating a workspace only copies its parameters. No state from
							the old workspace is copied over.
						</Alert>
					)}

					{diagnostics.length > 0 && <Diagnostics diagnostics={diagnostics} />}

					<form
						id={FORM_ID}
						onSubmit={form.handleSubmit}
						aria-label="Create workspace form"
						className="contents"
						data-testid="form"
						noValidate
					>
						<SettingsCard
							id="general"
							title="General"
							description={
								permissions.createWorkspaceForAny
									? "Its name, and whose it is"
									: "The name of your new workspace"
							}
							icon={<IdCardGlyph />}
						>
							<div className="px-6 py-2">
								<div className="ws-row">
									<div className="ws-row-label">
										<label htmlFor={nameField} className="block font-medium">
											Workspace name
										</label>
										<p className="ws-desc">
											Shown in the workspace list and URL.
										</p>
									</div>
									<div className="ws-row-control">
										<input
											id={nameField}
											ref={workspaceNameInputRef}
											type="text"
											className="ws-input max-w-[420px]"
											value={form.values.name}
											spellCheck={false}
											aria-invalid={Boolean(
												form.touched.name && form.errors.name,
											)}
											onChange={(e) => {
												form.setFieldValue("name", e.target.value.trim());
												resetMutation();
											}}
											onBlur={() => void form.setFieldTouched("name", true)}
											disabled={creatingWorkspace}
										/>
										{form.touched.name && form.errors.name ? (
											<p className="ws-error">{form.errors.name}</p>
										) : (
											<p className="ws-help flex flex-wrap items-center gap-1">
												Need a suggestion?
												<button
													type="button"
													className="ws-link-btn ws-hit ws-mono"
													disabled={creatingWorkspace}
													onClick={async () => {
														await form.setFieldValue("name", suggestedName);
														rerollSuggestedName();
													}}
												>
													{suggestedName}
												</button>
											</p>
										)}
									</div>
								</div>

								{permissions.createWorkspaceForAny && (
									<div className="ws-row">
										<div className="ws-row-label">
											<div className="font-medium" id={`${id}-owner-label`}>
												Owner
											</div>
											<p className="ws-desc">
												Only admins can create workspaces for other users.
											</p>
										</div>
										<div
											className="ws-row-control ws-combo max-w-[420px]"
											role="group"
											aria-labelledby={`${id}-owner-label`}
										>
											<WorkspaceUserAutocomplete
												organizationId={template.organization_id}
												value={owner}
												onChange={(user) => {
													handleOwnerChange(user ?? defaultOwner);
												}}
											/>
										</div>
									</div>
								)}

								{versionId && versionId !== template.active_version_id && (
									<div className="ws-row">
										<div className="ws-row-label">
											<label
												htmlFor={`${id}-version-id`}
												className="block font-medium"
											>
												Version ID
											</label>
											<p className="ws-desc">
												Set by the link that opened this page: it cannot be
												changed here.
											</p>
										</div>
										<div className="ws-row-control">
											<input
												id={`${id}-version-id`}
												className="ws-input ws-input-mono max-w-[420px]"
												value={versionId}
												disabled
											/>
										</div>
									</div>
								)}

								{presets.length > 0 && (
									<div className="ws-row">
										<div className="ws-row-label">
											<div className="font-medium" id={`${id}-preset-label`}>
												Preset
											</div>
											<p className="ws-desc">
												Parameters the template has chosen together.
											</p>
										</div>
										<div
											className="ws-row-control ws-combo flex max-w-[420px] flex-col gap-3"
											role="group"
											aria-labelledby={`${id}-preset-label`}
										>
											<Combobox
												value={presetOptions[selectedPresetIndex]?.value}
												onValueChange={(value) => {
													const index = presetOptions.findIndex(
														(preset) => preset.value === value,
													);
													if (index === -1) {
														return;
													}
													setSelectedPresetIndex(index);
													form.setFieldValue(
														"template_version_preset_id",
														// "undefined" string is equivalent to using None option.
														// Combobox requires a value in order to correctly
														// highlight the None option.
														presetOptions[index].value === "undefined"
															? undefined
															: presetOptions[index].value,
													);
												}}
											>
												<ComboboxTrigger asChild>
													<ComboboxButton
														selectedOption={{
															label:
																presetOptions[selectedPresetIndex]?.label || "",
															value:
																presetOptions[selectedPresetIndex]?.value || "",
														}}
														placeholder="Select a preset"
													/>
												</ComboboxTrigger>
												<ComboboxContent align="start">
													{presetOptions.map((preset) => (
														<ComboboxItem
															key={preset.value}
															value={preset.value}
														>
															{preset.icon && (
																<ExternalImage
																	src={preset.icon}
																	alt={preset.label}
																	className="size-4"
																/>
															)}
															{preset.label}
														</ComboboxItem>
													))}
												</ComboboxContent>
											</Combobox>
										</div>
									</div>
								)}
								{/* Only when the preset sets parameters: otherwise it would show nothing more */}
								{presets.length > 0 && presetParameterNames.length > 0 && (
									<ToggleRow
										id="show-preset-parameters"
										label="Show preset parameters"
										description="The parameters the preset sets, held as it sets them."
										pressed={showPresetParameters}
										onChange={setShowPresetParameters}
									/>
								)}
							</div>
						</SettingsCard>

						{externalAuth.length > 0 && (
							<SettingsCard
								id="external-auth"
								title="External authentication"
								description="This template uses external services for authentication"
								icon={<ShieldGlyph size={18} />}
							>
								<div className="flex flex-col gap-4 p-6">
									{Boolean(error) && !hasAllRequiredExternalAuth && (
										<Alert severity="error" prominent>
											To create a workspace using this template, please connect
											to all required external authentication providers listed
											below.
										</Alert>
									)}
									{!isCreatingForSelf && (
										<Alert severity="info">
											This shows the external authentication state for{" "}
											{owner.username}. They must connect any required providers
											themselves; you can't authenticate on their behalf.
										</Alert>
									)}
									{externalAuth.map((auth) => (
										<ExternalAuthButton
											key={auth.id}
											error={error}
											auth={auth}
											canAuthenticate={isCreatingForSelf}
											isLoading={
												externalAuthPollingState[auth.id] === "polling"
											}
											onStartPolling={() => startPollingExternalAuth(auth.id)}
											displayRetry={
												externalAuthPollingState[auth.id] === "abandoned"
											}
										/>
									))}
								</div>
							</SettingsCard>
						)}

						{hasResources && (
							<ResourcesCard params={controls} saving={creatingWorkspace} />
						)}
						{hasEnvironment && (
							<EnvironmentCard params={controls} saving={creatingWorkspace} />
						)}

						{scheduleCard && (
							<SettingsCard
								id="schedule"
								title="Schedule"
								description="When it runs"
								icon={<ClockGlyph size={18} />}
							>
								<div className="flex flex-col gap-4 p-6">
									<p className="m-0 text-[13px] text-(--ws-muted)">
										{scheduleCard.description}
									</p>
									{scheduleCard.fields}
								</div>
							</SettingsCard>
						)}

						<SaveBar
							form={FORM_ID}
							title="New workspace"
							tone="ready"
							note={
								isCreatingForSelf
									? `From ${templateName}`
									: `From ${templateName}, for ${owner.username}`
							}
							label="Create workspace"
							discardLabel="Cancel"
							saving={creatingWorkspace}
							disabled={disabled || Boolean(scheduleBlocked)}
							onDiscard={onCancel}
							className="px-0"
						/>
					</form>
				</main>
			</div>
		</div>
	);
};
