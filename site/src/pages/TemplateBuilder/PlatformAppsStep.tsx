import {
	CheckIcon,
	FolderIcon,
	MonitorIcon,
	PencilIcon,
	SquareTerminalIcon,
	XIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import { templateBuilderBases } from "#/api/queries/templateBuilder";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { RadioGroup, RadioGroupItem } from "#/components/RadioGroup/RadioGroup";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	TemplateBuilderSubtitle,
	TemplateBuilderTitle,
} from "#/pages/TemplateBuilder/TemplateBuilderHeader";
import { PLATFORM_APPS_DEFAULTS } from "./wizardState";

const APPS = [
	{
		variable: "desktop",
		name: "Desktop",
		icon: MonitorIcon,
		description:
			"The workspace's desktop in the browser (noVNC), and its session.",
	},
	{
		variable: "file_browser",
		name: "File Browser",
		icon: FolderIcon,
		description: "Browse, upload and download the workspace's files.",
	},
	{
		variable: "terminal",
		name: "Terminal",
		icon: SquareTerminalIcon,
		description: "The web terminal on the workspace's page.",
	},
] as const;

type PlatformAppsStepProps = {
	/** The base's name (the deployment's DEFAULT template). */
	name: string;
	iconUrl?: string;
	values: Record<string, string>;
	onChangeValues: (values: Record<string, string>) => void;
	/** The Coder template behind the base, and whether this user may rename it (admins). */
	templateId?: string;
	canRename?: boolean;
	onRenamed?: (name: string) => void;
};

/** Display names as Coder takes them (codersdk's template_display_name). */
const DISPLAY_NAME_MAX = 64;

/**
 * Admins rename the base template here: its display name (what the builder and the Templates list show; its ID,
 * which the deployment's settings name, stays).
 */
const BaseName: React.FC<{
	name: string;
	templateId?: string;
	canRename: boolean;
	onRenamed?: (name: string) => void;
}> = ({ name, templateId, canRename, onRenamed }) => {
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(name);
	const rename = useMutation({
		mutationFn: (displayName: string) =>
			API.updateTemplateMeta(templateId ?? "", { display_name: displayName }),
		onSuccess: async (_, displayName) => {
			setEditing(false);
			onRenamed?.(displayName);
			await queryClient.invalidateQueries({
				queryKey: templateBuilderBases().queryKey,
			});
			toast.success(`The base template is now "${displayName}".`);
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "The base template was not renamed.")),
	});
	const trimmed = draft.trim();
	const valid =
		trimmed.length > 0 &&
		trimmed.length <= DISPLAY_NAME_MAX &&
		trimmed !== name;
	if (!editing) {
		return (
			<>
				<span className="font-medium" data-testid="platform-base-name">
					{name}
				</span>
				<span className="text-content-secondary">base template</span>
				{canRename && templateId && (
					<Button
						type="button"
						size="xs"
						variant="subtle"
						className="ml-auto"
						onClick={() => {
							setDraft(name);
							setEditing(true);
						}}
						data-testid="platform-base-rename"
					>
						<PencilIcon />
						Rename
					</Button>
				)}
			</>
		);
	}
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (valid) {
			rename.mutate(trimmed);
		}
	};
	return (
		<form className="flex flex-1 items-center gap-2" onSubmit={submit}>
			<Input
				aria-label="The base template's name"
				className="h-8 max-w-64"
				value={draft}
				maxLength={DISPLAY_NAME_MAX}
				autoFocus
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						setEditing(false);
					}
				}}
				data-testid="platform-base-name-input"
			/>
			<span className="text-content-secondary">base template</span>
			<span className="ml-auto flex gap-1">
				<Button
					type="submit"
					size="xs"
					disabled={!valid || rename.isPending}
					data-testid="platform-base-rename-save"
				>
					<Spinner loading={rename.isPending}>
						<CheckIcon />
					</Spinner>
					Save
				</Button>
				<Button
					type="button"
					size="xs"
					variant="outline"
					disabled={rename.isPending}
					onClick={() => setEditing(false)}
				>
					<XIcon />
					Cancel
				</Button>
			</span>
		</form>
	);
};

/**
 * The deployment's base template's step (the DEFAULT prototype, chosen for every new template without a choice
 * shown): which of its apps the new template has - the Desktop, File Browser and the Terminal, each included or
 * excluded (the template's desktop, file_browser and terminal variables). What the platform adds to every workspace
 * (the certificate, Lock Down, the Cloud Drive, the metrics) is not the template's to choose: it comes with every
 * build.
 */
export const PlatformAppsStep: React.FC<PlatformAppsStepProps> = ({
	name,
	iconUrl,
	values,
	onChangeValues,
	templateId,
	canRename = false,
	onRenamed,
}) => (
	<>
		<TemplateBuilderTitle>The workspace's apps</TemplateBuilderTitle>
		<TemplateBuilderSubtitle>
			Every new template starts from {name}. Choose the apps it has; the
			platform's own (the certificate, Lock Down, the Cloud Drive, the metrics)
			come with every workspace.
		</TemplateBuilderSubtitle>
		<div
			className="mt-6 flex flex-col divide-y divide-border rounded-lg border border-solid border-border"
			data-testid="platform-apps"
		>
			<div className="flex min-h-14 items-center gap-3 px-4 py-3 text-sm">
				{iconUrl && <img src={iconUrl} alt="" className="size-6" />}
				<BaseName
					name={name}
					templateId={templateId}
					canRename={canRename}
					onRenamed={onRenamed}
				/>
			</div>
			{APPS.map((app) => {
				const value =
					values[app.variable] ?? PLATFORM_APPS_DEFAULTS[app.variable];
				const Icon = app.icon;
				return (
					<div
						key={app.variable}
						className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3"
					>
						<div className="flex min-w-60 flex-1 items-start gap-3">
							<Icon className="mt-0.5 size-5 text-content-secondary" />
							<div className="flex flex-col">
								<span className="text-sm font-medium">{app.name}</span>
								<span className="text-xs text-content-secondary">
									{app.description}
								</span>
							</div>
						</div>
						<RadioGroup
							value={value}
							onValueChange={(v) =>
								onChangeValues({ ...values, [app.variable]: v })
							}
							className="flex gap-6"
							aria-label={app.name}
						>
							<div className="flex items-center gap-2">
								<RadioGroupItem
									value="true"
									id={`app-${app.variable}-in`}
									data-testid={`app-${app.variable}-include`}
								/>
								<Label htmlFor={`app-${app.variable}-in`}>Include</Label>
							</div>
							<div className="flex items-center gap-2">
								<RadioGroupItem
									value="false"
									id={`app-${app.variable}-out`}
									data-testid={`app-${app.variable}-exclude`}
								/>
								<Label htmlFor={`app-${app.variable}-out`}>Exclude</Label>
							</div>
						</RadioGroup>
					</div>
				);
			})}
		</div>
	</>
);
