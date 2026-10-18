import { FolderIcon, MonitorIcon, SquareTerminalIcon } from "lucide-react";
import { Label } from "#/components/Label/Label";
import { RadioGroup, RadioGroupItem } from "#/components/RadioGroup/RadioGroup";
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
	/** The base's name (the deployment's UBUNTU template). */
	name: string;
	iconUrl?: string;
	values: Record<string, string>;
	onChangeValues: (values: Record<string, string>) => void;
};

/**
 * The deployment's base template's step (the UBUNTU prototype, chosen for every new template without a choice
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
			{iconUrl && (
				<div className="flex items-center gap-3 px-4 py-3 text-sm">
					<img src={iconUrl} alt="" className="size-6" />
					<span className="font-medium">{name}</span>
					<span className="text-content-secondary">base template</span>
				</div>
			)}
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
