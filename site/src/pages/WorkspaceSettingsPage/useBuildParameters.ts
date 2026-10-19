import { getIn, useFormik } from "formik";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "react-query";
import * as Yup from "yup";
import { API } from "#/api/api";
import { DetailedError } from "#/api/errors";
import type {
	DynamicParametersRequest,
	DynamicParametersResponse,
	PreviewParameter,
	Workspace,
	WorkspaceBuildParameter,
} from "#/api/typesGenerated";
import { useDebouncedFunction } from "#/hooks/debounce";
import { useSyncFormParameters } from "#/modules/hooks/useSyncFormParameters";
import {
	getInitialParameterValues,
	useValidationSchemaForDynamicParameters,
} from "#/modules/workspaces/DynamicParameter/DynamicParameter";
import type { AutofillBuildParameter } from "#/utils/richParameters";

export type BuildParametersValues = {
	rich_parameter_values: WorkspaceBuildParameter[];
};

const NO_PARAMETERS: PreviewParameter[] = [];

/**
 * The workspace's build parameters on its settings page: the template version's dynamic parameters (a web socket that
 * evaluates them as they change), filled with the latest build's values, in one form. Changed, they are applied with
 * a new build: started, or restarted when the workspace runs. The page shows them as its Resources and Environment
 * controls and saves them from its save bar.
 */
export const useBuildParameters = ({
	workspace,
	templateVersionId,
	canChangeVersions,
}: {
	workspace: Workspace;
	/** ?templateVersionId=: the version the workspace is being updated to. */
	templateVersionId: string | undefined;
	canChangeVersions: boolean;
}) => {
	// The latest build's values fill the form.
	const {
		data: latestBuildParameters,
		isLoading: latestBuildParametersLoading,
	} = useQuery({
		queryKey: ["workspaceBuilds", workspace.latest_build.id, "parameters"],
		queryFn: () => API.getWorkspaceBuildParameters(workspace.latest_build.id),
	});

	const [latestResponse, setLatestResponse] =
		useState<DynamicParametersResponse | null>(null);
	// The current expected response ID.  Starts at -1 because the backend sends
	// an initial message when the web socket is connected with -1.
	const wsResponseId = useRef<number>(-1);
	const ws = useRef<WebSocket | null>(null);
	const [wsError, setWsError] = useState<Error | null>(null);
	const [isConnecting, setIsConnecting] = useState(false);
	// The expected ID of the init message, so we can wait until the initial
	// parameters have gone through before rendering the form.
	const [initId, setInitId] = useState(Number.NaN);

	const autofillParameters: AutofillBuildParameter[] = useMemo(
		() =>
			latestBuildParameters?.map((p) => ({
				...p,
				source: "active_build",
			})) ?? [],
		[latestBuildParameters],
	);

	// sendMessage increments the ID and sends the form values on the web socket
	// and returns true.  If the socket is not open, it does not increment the ID
	// and returns false.
	const sendMessage = (formValues: Record<string, string>): boolean => {
		const request: DynamicParametersRequest = {
			id: wsResponseId.current + 1,
			owner_id: workspace.owner_id,
			inputs: formValues,
		};
		if (ws.current && ws.current.readyState === WebSocket.OPEN) {
			wsResponseId.current = wsResponseId.current + 1;
			ws.current.send(JSON.stringify(request));
			return true;
		}
		if (ws.current) {
			console.error(
				"Tried to send message but the web socket state is %s",
				ws.current.readyState,
				request,
			);
		}
		return false;
	};

	// Send the initial parameters if necessary and mark the ID of the response we
	// need to wait for until we can finally render the form with the right state.
	const sendInitialParameters = useEffectEvent(() => {
		if (latestBuildParametersLoading || !Number.isNaN(initId)) {
			return;
		}
		if (autofillParameters.length > 0) {
			const values = Object.fromEntries(
				autofillParameters.map((afp) => [afp.name, afp.value]),
			);
			if (!sendMessage(values)) {
				return;
			}
		}
		// If there were no parameters to send, this will end up just using the
		// response we already have.  Otherwise it will wait for the next response.
		setInitId(wsResponseId.current);
	});

	useEffect(() => {
		if (!latestBuildParametersLoading) {
			sendInitialParameters();
		}
	}, [latestBuildParametersLoading]);

	useEffect(() => {
		if (!templateVersionId && !workspace.latest_build.template_version_id)
			return;

		const socket = API.templateVersionDynamicParameters(
			templateVersionId ?? workspace.latest_build.template_version_id,
			workspace.owner_id,
			{
				onOpen: () => {
					if (ws.current === socket) {
						setIsConnecting(false);
					}
					sendInitialParameters();
				},
				// Stale responses are discarded.
				onMessage: (response: DynamicParametersResponse) => {
					if (response.id >= wsResponseId.current) {
						setLatestResponse(response);
					}
				},
				onError: (error) => {
					if (ws.current === socket) {
						setIsConnecting(false);
						setWsError(error);
					}
				},
				onClose: () => {
					if (ws.current === socket) {
						setIsConnecting(false);
						setWsError(
							new DetailedError(
								"Websocket connection for dynamic parameters unexpectedly closed.",
								"Refresh the page to reset the form.",
							),
						);
					}
				},
			},
		);

		setIsConnecting(true);
		ws.current = socket;

		return () => {
			socket.close();
		};
	}, [
		templateVersionId,
		workspace.latest_build.template_version_id,
		workspace.owner_id,
	]);

	const parameters = useMemo(
		() =>
			latestResponse?.parameters
				? [...latestResponse.parameters].sort((a, b) => a.order - b.order)
				: NO_PARAMETERS,
		[latestResponse?.parameters],
	);
	const diagnostics = latestResponse?.diagnostics ?? [];

	// Some of these checks conceptually overlap, but opting to be explicit.
	const isLoading =
		latestBuildParametersLoading ||
		!latestResponse ||
		Number.isNaN(initId) ||
		latestResponse.id < initId ||
		isConnecting;

	const form = useFormik<BuildParametersValues>({
		initialValues: { rich_parameter_values: [] },
		validationSchema: Yup.object({
			rich_parameter_values:
				useValidationSchemaForDynamicParameters(parameters),
		}),
		// The page's save bar applies them (apply below).
		onSubmit: () => {},
		validateOnChange: true,
		validateOnBlur: true,
	});

	// Once the parameters have their build values: the form starts from them (what Discard goes back to).
	const [ready, setReady] = useState(false);
	const initialise = useEffectEvent(() => {
		form.resetForm({
			values: {
				rich_parameter_values: getInitialParameterValues(
					parameters,
					autofillParameters,
				),
			},
			// Autofilled values are kept when a response comes back (useSyncFormParameters).
			touched: Object.fromEntries(
				autofillParameters.map((p) => [p.name, true]),
			) as never,
		});
		setReady(true);
	});
	useEffect(() => {
		if (!isLoading && !ready) {
			initialise();
		}
	}, [isLoading, ready]);

	useSyncFormParameters({
		parameters: ready ? parameters : NO_PARAMETERS,
		formValues: form.values.rich_parameter_values ?? [],
		touched: form.touched,
		setFieldValue: form.setFieldValue,
	});

	// Debounce websocket sends to avoid stale responses overwriting
	// the form while the user is still typing.
	const { debounced: sendDynamicParamsRequest } = useDebouncedFunction(
		(parameter: PreviewParameter, value: string) => {
			const formInputs: Record<string, string> = {};
			for (const param of form.values.rich_parameter_values ?? []) {
				if (param?.name && param?.value !== undefined) {
					formInputs[param.name] = param.value;
				}
			}
			formInputs[parameter.name] = value;
			sendMessage(formInputs);
		},
		(parameter: PreviewParameter) =>
			// Typing: wait for a pause; anything else answers at once.
			parameter.form_type === "input" || parameter.form_type === "textarea"
				? 500
				: 0,
	);

	const values = form.values.rich_parameter_values ?? [];
	const parameter = (name: string) => parameters.find((p) => p.name === name);
	const value = (name: string) =>
		values.find((v) => v.name === name)?.value ?? "";

	/** Its value's validation error (the template's regex, min, max), once it is changed. */
	const fieldError = (name: string): string | undefined => {
		const index = values.findIndex((v) => v.name === name);
		const message =
			index < 0
				? undefined
				: getIn(form.errors, `rich_parameter_values.${index}.value`);
		return form.touched[name as keyof BuildParametersValues] &&
			typeof message === "string"
			? message
			: undefined;
	};

	const change = async (parameter: PreviewParameter, value: string) => {
		const index = values.findIndex((v) => v.name === parameter.name);
		if (index < 0) {
			await form.setFieldValue("rich_parameter_values", [
				...values,
				{ name: parameter.name, value },
			]);
		} else {
			await form.setFieldValue(`rich_parameter_values.${index}`, {
				name: parameter.name,
				value,
			});
		}
		form.setFieldTouched(parameter.name, true);
		sendDynamicParamsRequest(parameter, value);
	};

	// True when the form holds values the backend hasn't evaluated
	// yet (debounce pending or WS round-trip in flight).
	const unsynced = values.some((formParam) => {
		const responseParam = parameters.find((p) => p.name === formParam.name);
		if (!responseParam) {
			return true;
		}
		const responseValue = responseParam.value.valid
			? responseParam.value.value
			: "";
		return formParam.value !== responseValue;
	});

	const incompatible = parameters.some(
		(p) => !p.mutable && p.diagnostics.length > 0,
	);
	const hasErrors =
		diagnostics.some((d) => d.severity === "error") ||
		parameters.some((p) => p.diagnostics.some((d) => d.severity === "error"));
	// The template requires its active version and this workspace is behind it: update it first.
	const disabled =
		workspace.outdated &&
		workspace.template_require_active_version &&
		!canChangeVersions;

	const startWithParameters = useMutation({
		mutationFn: (buildParameters: WorkspaceBuildParameter[]) =>
			API.postWorkspaceBuild(workspace.id, {
				transition: "start",
				template_version_id: templateVersionId,
				rich_parameter_values: buildParameters,
				reason: "dashboard",
			}),
	});

	const restartWithParameters = useMutation({
		mutationFn: async (buildParameters: WorkspaceBuildParameter[]) => {
			const stopBuild = await API.stopWorkspace(workspace.id);
			const awaitedStopBuild = await API.waitForBuild(stopBuild);

			// If the restart is canceled halfway through, make sure we bail
			if (awaitedStopBuild?.status === "canceled") {
				return;
			}

			return API.postWorkspaceBuild(workspace.id, {
				transition: "start",
				template_version_id: templateVersionId,
				rich_parameter_values: buildParameters,
				reason: "dashboard",
			});
		},
	});

	const running = workspace.latest_build.status === "running";

	/** The mutable parameters' values, as a build takes them. */
	const mutableValues = () =>
		parameters
			.filter((p) => p.mutable)
			.map((p) => {
				const found = values.find((v) => v.name === p.name);
				if (!found) {
					throw new Error(`Missing value for parameter ${p.name}`);
				}
				return found;
			});

	return {
		/** The form holds the build's values (until then the controls wait). */
		ready,
		loading: isLoading,
		parameters,
		diagnostics,
		form,
		parameter,
		value,
		fieldError,
		change,
		changed: ready && form.dirty,
		unsynced,
		incompatible,
		hasErrors,
		disabled,
		running,
		error: wsError ?? startWithParameters.error ?? restartWithParameters.error,
		applying: startWithParameters.isPending || restartWithParameters.isPending,
		applyingLabel: restartWithParameters.isPending
			? "Stopping workspace"
			: startWithParameters.isPending
				? "Starting workspace"
				: undefined,
		/** Applies the changed parameters: a new build (the workspace restarted if it runs). */
		apply: () =>
			running
				? restartWithParameters.mutateAsync(mutableValues())
				: startWithParameters.mutateAsync(mutableValues()),
		/** Back to the build's values (and the backend told, so it evaluates them again). */
		reset: () => {
			form.resetForm();
			sendMessage(
				Object.fromEntries(
					form.initialValues.rich_parameter_values.map((p) => [
						p.name,
						p.value,
					]),
				),
			);
		},
	};
};

export type BuildParameters = ReturnType<typeof useBuildParameters>;
