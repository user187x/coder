import { BellIcon, XIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import { toast } from "sonner";
import { sendCustomNotification } from "#/api/queries/notifications";
import type { CustomNotificationRequest, User } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Markdown } from "#/components/Markdown/Markdown";
import { MultiUserSelect } from "#/components/MultiUserSelect/MultiUserSelect";
import { Textarea } from "#/components/Textarea/Textarea";

export const NotificationComposer = ({ canEdit }: { canEdit: boolean }) => {
	const id = useId();
	const queryClient = useQueryClient();
	const sendButton = useRef<HTMLButtonElement>(null);
	const [title, setTitle] = useState("");
	const [message, setMessage] = useState("");
	const [recipients, setRecipients] = useState<User[]>([]);
	const [search, setSearch] = useState("");
	const [request, setRequest] = useState<CustomNotificationRequest | null>(
		null,
	);
	const send = useMutation({
		...sendCustomNotification(queryClient),
		onSuccess: (_result, sent) => {
			setRequest(null);
			toast.success(
				`Notification queued for ${sent.user_ids?.length ?? 0} selected users.`,
			);
		},
	});
	const valid = title.trim() && message.trim() && recipients.length > 0;
	return (
		<section
			className="rounded-xl border border-solid border-border bg-surface-primary p-4 sm:p-6"
			aria-labelledby={`${id}-heading`}
		>
			<h2
				id={`${id}-heading`}
				className="m-0 flex items-center gap-2 text-base font-semibold"
			>
				<BellIcon className="size-4" />
				Notification
			</h2>
			<p className="text-sm text-content-secondary">
				Create a notification for selected users. Delivery follows the
				notification settings and each user's preferences. Edit the draft before
				sending; sent notifications cannot be changed.
			</p>
			{!canEdit && (
				<p className="text-sm text-content-secondary">
					Administrator permission is required to send notifications.
				</p>
			)}
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (valid && canEdit) {
						send.reset();
						setRequest({
							content: { title: title.trim(), message: message.trim() },
							user_ids: recipients.map((user) => user.id),
						});
					}
				}}
			>
				<fieldset
					disabled={!canEdit || send.isPending}
					className="m-0 min-w-0 space-y-4 border-0 p-0"
				>
					<legend className="sr-only">Compose notification</legend>
					<div className="space-y-2">
						<Label htmlFor={`${id}-title`}>Notification title</Label>
						<Input
							id={`${id}-title`}
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							maxLength={120}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor={`${id}-message`}>Notification message</Label>
						<Textarea
							id={`${id}-message`}
							value={message}
							onChange={(event) => setMessage(event.target.value)}
							maxLength={2000}
							rows={4}
							required
						/>
						<p className="m-0 text-xs text-content-secondary">
							Markdown is supported. {message.length} / 2000
						</p>
					</div>
					<details>
						<summary className="cursor-pointer text-sm">
							Preview notification
						</summary>
						<div className="mt-3 rounded-lg border border-solid border-border p-4">
							<h3 className="mt-0 text-sm">{title || "Notification title"}</h3>
							<Markdown>{message || "Your message will appear here."}</Markdown>
						</div>
					</details>
					<div
						className="space-y-3"
						role="group"
						aria-label="Notification recipients"
					>
						<h3 className="m-0 text-sm font-semibold">
							Recipients ({recipients.length} / 100)
						</h3>
						<div className="flex flex-wrap gap-2">
							{recipients.map((user) => (
								<Button
									key={user.id}
									type="button"
									size="sm"
									variant="outline"
									aria-label={`Remove recipient ${user.username}`}
									onClick={() =>
										setRecipients((current) =>
											current.filter((item) => item.id !== user.id),
										)
									}
								>
									{user.username}
									<XIcon className="size-3" />
								</Button>
							))}
						</div>
						<MultiUserSelect
							filter={`status:active ${search}`.trim()}
							setFilter={setSearch}
							selected={recipients}
							onChange={(user, checked) => {
								if (!canEdit || send.isPending) return;
								if (checked && recipients.length >= 100) {
									toast.info("Select up to 100 users per notification.");
									return;
								}
								setRecipients((current) =>
									checked
										? [...current.filter((item) => item.id !== user.id), user]
										: current.filter((item) => item.id !== user.id),
								);
							}}
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button ref={sendButton} type="submit" disabled={!valid}>
							Send notification
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setTitle("");
								setMessage("");
								setRecipients([]);
								send.reset();
							}}
						>
							New notification
						</Button>
					</div>
				</fieldset>
			</form>
			<ConfirmDialog
				hideCancel={false}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					sendButton.current?.focus();
				}}
				open={request !== null}
				onClose={() => {
					if (!send.isPending) setRequest(null);
				}}
				title="Send notification"
				confirmText="Send notification"
				confirmLoading={send.isPending}
				onConfirm={() => {
					if (request && canEdit && !send.isPending) send.mutate(request);
				}}
				description={
					<div className="space-y-3">
						<p>
							Send “{request?.content?.title}” to {request?.user_ids?.length}{" "}
							selected users?
						</p>
						<p>{recipients.map((user) => user.username).join(", ")}</p>
						{send.error && <ErrorAlert error={send.error} />}
					</div>
				}
			/>
		</section>
	);
};
