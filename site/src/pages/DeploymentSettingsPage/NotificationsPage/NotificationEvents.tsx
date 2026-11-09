import { BellRingIcon } from "lucide-react";
import { useMutation, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import {
	type selectTemplatesByGroup,
	updateNotificationTemplateMethod,
} from "#/api/queries/notifications";
import type { DeploymentValues } from "#/api/typesGenerated";
import { Alert } from "#/components/Alert/Alert";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import {
	castNotificationMethod,
	methodIcons,
	methodLabels,
	type NotificationMethod,
} from "#/modules/notifications/utils";

/** The platform's Coder is the open-source build (no per-template delivery method). */
const OPEN_SOURCE_BUILD = true;

type NotificationEventsProps = {
	defaultMethod: NotificationMethod;
	availableMethods: NotificationMethod[];
	templatesByGroup: ReturnType<typeof selectTemplatesByGroup>;
	deploymentConfig: DeploymentValues;
	canEdit?: boolean;
};

export const NotificationEvents: React.FC<NotificationEventsProps> = ({
	defaultMethod,
	availableMethods,
	templatesByGroup,
	deploymentConfig,
	canEdit = true,
}) => {
	// Webhook
	const hasWebhookNotifications = Object.values(templatesByGroup)
		.flat()
		.some((t) => t.method === "webhook");
	const webhookValues = deploymentConfig.notifications?.webhook ?? {};
	const isWebhookConfigured = requiredFieldsArePresent(webhookValues, [
		"endpoint",
	]);

	// SMTP
	const hasSMTPNotifications = Object.values(templatesByGroup)
		.flat()
		.some((t) => t.method === "smtp");
	const smtpValues = deploymentConfig.notifications?.email ?? {};
	const isSMTPConfigured = requiredFieldsArePresent(smtpValues, [
		"smarthost",
		"from",
		"hello",
	]);

	return (
		<div className="flex flex-col gap-8">
			{hasWebhookNotifications && !isWebhookConfigured && (
				<Alert severity="warning" prominent>
					Webhook notifications are enabled, but not properly configured.
				</Alert>
			)}

			{hasSMTPNotifications && !isSMTPConfigured && (
				<Alert severity="warning" prominent>
					SMTP notifications are enabled but not properly configured.
				</Alert>
			)}

			{/* One card per group of events, as many to a row as fit; each event a tile with its delivery method. */}
			<ul
				aria-label="Notification events"
				className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] items-start gap-4 p-0"
			>
				{Object.entries(templatesByGroup).map(([group, templates]) => (
					<li
						key={group}
						aria-label={group}
						className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-solid border-border bg-surface-secondary"
					>
						<header className="flex items-center gap-3 border-0 border-b border-solid border-border px-4 py-3">
							<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-sky text-highlight-sky">
								<BellRingIcon aria-hidden className="size-4" />
							</span>
							<span className="min-w-0 flex-1 truncate text-sm font-semibold">
								{group}
							</span>
							<span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-xs tabular-nums text-content-secondary">
								{templates.length} {templates.length === 1 ? "event" : "events"}
							</span>
						</header>
						<div className="flex flex-col gap-2 p-3">
							{templates.map((tpl) => {
								const value = castNotificationMethod(
									tpl.method || defaultMethod,
								);
								return (
									<div
										key={tpl.id}
										data-testid="notification-template-row"
										className="flex items-center justify-between gap-3 rounded-lg border border-solid border-border bg-surface-primary px-3 py-2"
									>
										<span className="min-w-0 text-sm font-medium wrap-anywhere">
											{tpl.name}
										</span>
										<MethodSelect
											templateId={tpl.id}
											templateName={tpl.name}
											options={availableMethods}
											value={value}
											// The platform runs Coder's open-source build: a template's
											// delivery method is its default (setting it per template is
											// an Enterprise route).
											canEdit={canEdit && !OPEN_SOURCE_BUILD}
										/>
									</div>
								);
							})}
						</div>
					</li>
				))}
			</ul>
		</div>
	);
};

function requiredFieldsArePresent(
	obj: Record<string, string | undefined>,
	fields: string[],
): boolean {
	return fields.every((field) => Boolean(obj[field]));
}

type MethodSelectProps = {
	templateId: string;
	templateName: string;
	options: NotificationMethod[];
	value: NotificationMethod;
	canEdit: boolean;
};

const MethodSelect: React.FC<MethodSelectProps> = ({
	value,
	options,
	templateId,
	templateName,
	canEdit,
}) => {
	const queryClient = useQueryClient();
	const updateMethodMutation = useMutation(
		updateNotificationTemplateMethod(templateId, queryClient),
	);

	const SelectedIcon = methodIcons[value];

	return (
		<Select
			value={value}
			disabled={!canEdit}
			onValueChange={async (method) => {
				if (method === value) {
					return;
				}
				try {
					await updateMethodMutation.mutateAsync({
						method,
					});
					toast.success("Notification method updated.");
				} catch (error) {
					toast.error(
						getErrorMessage(error, "Failed to update notification method."),
						{
							description: getErrorDetail(error),
						},
					);
				}
			}}
		>
			<SelectTrigger
				aria-label={`Notification method for ${templateName}`}
				className="h-8 w-auto min-w-32 gap-2 [&>span]:flex [&>span]:items-center [&>span]:gap-2 [&>span]:line-clamp-none"
			>
				<SelectValue>
					<span className="flex items-center gap-2 leading-none">
						<SelectedIcon className="size-icon-sm shrink-0" aria-hidden />
						{methodLabels[value]}
					</span>
				</SelectValue>
			</SelectTrigger>
			<SelectContent align="end">
				{options.map((method) => {
					const Icon = methodIcons[method];
					const label = methodLabels[method];
					return (
						<SelectItem key={method} value={method}>
							<span className="flex items-center gap-2 leading-none">
								<Icon className="size-icon-sm shrink-0" aria-hidden />
								{label}
							</span>
						</SelectItem>
					);
				})}
			</SelectContent>
		</Select>
	);
};
