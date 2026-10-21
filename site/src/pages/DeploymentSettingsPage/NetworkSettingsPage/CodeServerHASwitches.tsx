import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import type { Template, TemplateVersionVariable } from "#/api/typesGenerated";
import { Spinner } from "#/components/Spinner/Spinner";
import { Switch } from "#/components/Switch/Switch";

/** The template variable that runs a template's code-server as an HA instance (charts/coder-workspace main.tf). */
export const CODE_SERVER_HA_VARIABLE = "code_server_ha";
const IMPORT_POLL_MS = 2000;
const IMPORT_TIMEOUT_MS = 10 * 60 * 1000;

type HATemplate = {
	template: Template;
	on: boolean;
	variables: readonly TemplateVersionVariable[];
};

const haTemplatesKey = ["platform", "code-server-ha", "templates"] as const;

/** Every template that has the variable, and whether its active version turns it on. */
const haTemplates = async (): Promise<HATemplate[]> => {
	const templates = await API.getTemplates();
	const rows = await Promise.all(
		templates.map(async (template): Promise<HATemplate | null> => {
			const variables = await API.getTemplateVersionVariables(
				template.active_version_id,
			).catch(() => []);
			const ha = variables.find((v) => v.name === CODE_SERVER_HA_VARIABLE);
			return ha
				? { template, on: ha.value.toLowerCase() === "true", variables }
				: null;
		}),
	);
	return rows.filter((row): row is HATemplate => row !== null);
};

/**
 * A new version of the template, its code_server_ha set, made the active one - as the template's Variables page
 * would: the active version's files and every other variable as they are. Its workspaces follow at their next start.
 */
export const switchCodeServerHA = async ({
	template,
	variables,
	on,
}: Omit<HATemplate, "on"> & { on: boolean }) => {
	if (
		variables.some((v) => v.sensitive && v.name !== CODE_SERVER_HA_VARIABLE)
	) {
		throw new Error(
			"This template has a sensitive variable whose value cannot be carried over: change code_server_ha in the template's variables.",
		);
	}
	const active = await API.getTemplateVersion(template.active_version_id);
	let version = await API.createTemplateVersion(template.organization_id, {
		template_id: template.id,
		file_id: active.job.file_id,
		storage_method: "file",
		provisioner: "terraform",
		tags: active.job.tags,
		message: `code-server HA ${on ? "on" : "off"} (Settings › Network)`,
		user_variable_values: variables.map((v) => ({
			name: v.name,
			value: v.name === CODE_SERVER_HA_VARIABLE ? String(on) : v.value,
		})),
	});
	const deadline = Date.now() + IMPORT_TIMEOUT_MS;
	while (
		!["succeeded", "failed", "canceled"].includes(version.job.status) &&
		Date.now() < deadline
	) {
		await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_MS));
		version = await API.getTemplateVersion(version.id);
	}
	if (version.job.status !== "succeeded") {
		throw new Error(
			version.job.error ||
				`The template's new version did not import (${version.job.status}).`,
		);
	}
	await API.updateActiveTemplateVersion(template.id, { id: version.id });
	return version;
};

/**
 * Platform: code-server HA on or off for each template that has it (its code_server_ha variable) - in this cluster
 * too: the replicator here runs each such workspace's code-server as an instance of its own, beside a relay in the
 * workspace. A switch makes a new version of the template with the variable changed, the active one; the template's
 * workspaces follow at their next start. The chart's template push keeps the setting (charts/coder-workspace job).
 */
export const CodeServerHASwitches: React.FC = () => {
	const queryClient = useQueryClient();
	const query = useQuery({ queryKey: haTemplatesKey, queryFn: haTemplates });
	const change = useMutation({
		mutationFn: switchCodeServerHA,
		onSuccess: (_, { template, on }) => {
			toast.success(
				`code-server HA ${on ? "on" : "off"} for ${template.display_name || template.name}: its workspaces follow at their next start.`,
			);
		},
		onError: (error) =>
			toast.error(getErrorMessage(error, "code-server HA was not changed.")),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: haTemplatesKey }),
	});

	if (query.isLoading) {
		return <Spinner loading size="sm" />;
	}
	if (!query.data?.length) {
		return (
			<p className="m-0 text-xs text-content-secondary">
				No template here has code-server HA (a code_server_ha variable).
			</p>
		);
	}
	return (
		<ul
			className="m-0 flex list-none flex-wrap gap-2 p-0"
			data-testid="ha-templates"
		>
			{query.data.map(({ template, on, variables }) => {
				const name = template.display_name || template.name;
				const busy =
					change.isPending && change.variables?.template.id === template.id;
				return (
					<li
						key={template.id}
						className="flex items-center gap-2.5 rounded-md border border-solid border-border bg-surface-secondary py-1.5 pr-3 pl-2.5 text-xs"
						data-testid={`ha-template-${template.name}`}
						data-on={on || undefined}
					>
						<Switch
							checked={on}
							disabled={change.isPending}
							aria-label={`code-server HA for ${name}`}
							onCheckedChange={(next) =>
								change.mutate({ template, variables, on: next })
							}
							data-testid={`ha-template-switch-${template.name}`}
						/>
						<span className="font-semibold text-content-primary">{name}</span>
						<span className="text-content-secondary">
							{busy
								? "making a new version…"
								: on
									? "on: its workspaces run code-server HA from their next start"
									: "off"}
						</span>
						{busy && <Spinner loading size="sm" />}
					</li>
				);
			})}
		</ul>
	);
};
