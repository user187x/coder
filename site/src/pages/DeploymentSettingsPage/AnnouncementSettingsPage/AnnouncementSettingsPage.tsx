import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type Banner,
	type BannerFields,
	type BannerState,
	PlatformError,
} from "#/api/platform";
import {
	bannerState,
	publishBanner,
	resetBanner,
	reshowBanner,
} from "#/api/queries/platform";
import { Alert } from "#/components/Alert/Alert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { Switch } from "#/components/Switch/Switch";
import { BannerPreview } from "#/modules/platform/announcement/BannerPreview";
import { parseColors } from "#/modules/platform/announcement/bannerTokens";
import { pageTitle } from "#/utils/page";
import { Acknowledgements } from "./Acknowledgements";
import {
	BannerEditor,
	hasPlaceholders,
	MESSAGE_MAX_LENGTH,
} from "./BannerEditor";

const FIELDS = [
	"enabled",
	"level",
	"title",
	"message",
	"linkText",
	"linkUrl",
	"dismissible",
	"showOnLoginPage",
	"refreshSeconds",
	"effect",
	"repeat",
] as const;

/** A banner saved before effects existed has none: that means "none", not "changed". */
const fieldsOf = ({ id: _id, ...banner }: Banner): BannerFields => ({
	...banner,
	effect: banner.effect ?? "none",
	repeat: banner.repeat ?? false,
});

const sameFields = (a: BannerFields, b: BannerFields) =>
	FIELDS.every((field) => a[field] === b[field]);

/**
 * Announcements published before the Markdown editor had a bold lead-in and a
 * link: they are folded into the Markdown message (an unpublished edit).
 */
export const editableFields = (banner: Banner): BannerFields => {
	const fields = fieldsOf(banner);
	const title = fields.title.trim();
	const isColors = Boolean(parseColors(title));
	if ((!title || isColors) && !fields.linkUrl && !fields.linkText) {
		return fields;
	}
	let message = fields.message.trim();
	if (title && !isColors) {
		message = `**${title}** ${message}`;
	}
	if (fields.linkUrl) {
		message = `${message} [${fields.linkText || fields.linkUrl}](${fields.linkUrl})`;
	}
	return {
		...fields,
		title: isColors ? title : "",
		message: message.slice(0, MESSAGE_MAX_LENGTH),
		linkText: "",
		linkUrl: "",
	};
};

const tabsText = (state: BannerState, before: string, after: string) =>
	typeof state.subscribers === "number"
		? `${before}${state.subscribers} open ${state.subscribers === 1 ? "tab" : "tabs"}${after}`
		: "";

const sentTo = (state: BannerState) =>
	typeof state.delivered === "number"
		? ` Sent instantly to ${state.delivered} open ${state.delivered === 1 ? "tab" : "tabs"}.`
		: "";

const unavailableMessage = (error: unknown) => {
	const status = error instanceof PlatformError ? error.status : 0;
	if (status === 401) {
		return "Your Coder session has expired. Sign in again to edit the announcement.";
	}
	if (status === 403) {
		return "Only Coder admins can change the announcement.";
	}
	return `The announcement service is not available right now${status ? ` (HTTP ${status})` : ""}. Is the coder-banner app running?`;
};

/**
 * General > Announcement: the banner every developer sees on every Coder
 * page, published by the coder-banner service, and who has confirmed reading
 * it.
 */
const AnnouncementSettingsPage: React.FC = () => {
	const stateQuery = useQuery(bannerState());

	return (
		<>
			<title>{pageTitle("Announcement")}</title>
			<SettingsHeader>
				<SettingsHeaderTitle>Announcement</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Show an announcement across the Coder dashboard and see who has
					confirmed reading it.
				</SettingsHeaderDescription>
			</SettingsHeader>

			{stateQuery.isLoading ? (
				<Loader />
			) : !stateQuery.data ? (
				<Alert severity="warning" prominent>
					{unavailableMessage(stateQuery.error)}
				</Alert>
			) : (
				<div className="flex flex-col gap-6">
					<AnnouncementEditor state={stateQuery.data} />
					<Acknowledgements />
				</div>
			)}
		</>
	);
};

type ConfirmKind = "placeholders" | "reshow" | "reset";

const AnnouncementEditor: React.FC<{ state: BannerState }> = ({ state }) => {
	const queryClient = useQueryClient();
	const publish = useMutation(publishBanner(queryClient));
	const reshow = useMutation(reshowBanner(queryClient));
	const reset = useMutation(resetBanner(queryClient));
	// Edits are kept apart from the published banner, which is re-read every
	// few seconds, so a refetch never discards them.
	const [draft, setDraft] = useState<BannerFields | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<ConfirmKind | null>(null);

	const published = fieldsOf(state.banner);
	const form = draft ?? editableFields(state.banner);
	const dirty = !sameFields(form, published);
	const live = state.banner.enabled && Boolean(state.banner.message);
	const busy = publish.isPending || reshow.isPending || reset.isPending;

	const onError = (error: unknown) => {
		const message = getErrorMessage(error, "The change could not be saved.");
		setProblem(message);
		toast.error(message);
	};

	const doPublish = () =>
		publish.mutate(
			{ ...form, enabled: true },
			{
				onSuccess: (next) => {
					setDraft(null);
					setProblem(null);
					toast.success(
						`Published. Developers will see the new message.${sentTo(next)}`,
					);
				},
				onError,
			},
		);

	return (
		<>
			<section
				aria-labelledby="announcement-visibility"
				className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6"
			>
				<h2 id="announcement-visibility" className="sr-only">
					Visibility
				</h2>
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<Switch
							id="announcement-visible"
							checked={live}
							disabled={busy}
							onCheckedChange={(enabled) => {
								if (enabled && !state.banner.message) {
									setProblem("Write and publish a message first.");
									return;
								}
								publish.mutate(
									{ ...published, enabled },
									{
										onSuccess: (next) => {
											setProblem(null);
											toast.success(
												`${enabled ? "Banner is showing again." : "Banner hidden."}${sentTo(next)}`,
											);
										},
										onError,
									},
								);
							}}
						/>
						<Label htmlFor="announcement-visible">Show banner</Label>
						<span className="text-sm text-content-secondary">
							{live ? "On: developers see it" : "Off: hidden from everyone"}
						</span>
					</div>
					<Button
						variant="outline"
						className="border-highlight-orange text-highlight-orange"
						disabled={busy || !state.banner.message}
						title="Show the banner again to everyone, including people who dismissed it"
						onClick={() => setConfirm("reshow")}
					>
						Show again to everyone
					</Button>
				</div>
				<p className="m-0 text-sm text-content-secondary">
					People who dismissed the banner will not see it again on their own.
					Use "Show again to everyone" when something urgent needs everyone's
					attention, for example a zero-day patch. Tabs with a live connection
					{tabsText(state, " (", " right now)")} update instantly; any other
					open tab within about {state.banner.refreshSeconds} seconds.
				</p>
			</section>

			<section
				aria-labelledby="announcement-preview"
				className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6"
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 id="announcement-preview" className="m-0 text-base font-semibold">
						What developers see
					</h2>
					<Badge variant={live ? "green" : "default"} role="status">
						{live
							? `Live for all developers${tabsText(state, " · ", " connected")}`
							: "Hidden"}
					</Badge>
				</div>
				<div className="rounded-md bg-surface-secondary p-3">
					{form.message ? (
						<BannerPreview banner={{ ...form, effect: "none" }} />
					) : (
						<p className="m-0 text-sm text-content-secondary">
							Type a message to see a preview.
						</p>
					)}
				</div>
				<p className="m-0 text-sm text-content-secondary">
					Live preview of your draft below. Nothing is published until you press{" "}
					<strong>Publish changes</strong>.
				</p>
			</section>

			<BannerEditor
				form={form}
				dirty={dirty}
				isPublishing={publish.isPending}
				problem={problem}
				onChange={(change) => {
					setProblem(null);
					setDraft({ ...form, ...change });
				}}
				onProblem={setProblem}
				onPublish={() =>
					hasPlaceholders(form.message)
						? setConfirm("placeholders")
						: doPublish()
				}
				onDiscard={() => {
					setDraft(null);
					setProblem(null);
				}}
			/>

			<div className="flex flex-col gap-1 text-sm text-content-secondary">
				<p className="m-0">
					{state.overrideActive
						? state.updatedBy && state.updatedAt
							? `Last published by ${state.updatedBy} on ${new Date(state.updatedAt).toLocaleString("en-US")}.`
							: "Published from this page."
						: "Nothing has been published from this page yet, so the chart defaults are showing."}
				</p>
				{state.overrideActive && (
					<Button
						variant="subtle"
						size="sm"
						className="self-start px-0 underline"
						onClick={() => setConfirm("reset")}
					>
						Discard everything published here and use the chart defaults
					</Button>
				)}
			</div>

			<ConfirmDialog
				type="info"
				hideCancel={false}
				open={confirm === "placeholders"}
				title="Publish with placeholders?"
				description="The message still contains [bracketed] placeholders. Publish it anyway?"
				confirmText="Publish"
				onClose={() => setConfirm(null)}
				onConfirm={() => {
					setConfirm(null);
					doPublish();
				}}
			/>
			<ConfirmDialog
				type="info"
				hideCancel={false}
				open={confirm === "reshow"}
				title="Show again to everyone"
				description={`Show the banner again to everyone, including people who dismissed it? Tabs with a live connection${tabsText(state, " (", " right now)")} will show it instantly; any other open tab within about ${state.banner.refreshSeconds} seconds.`}
				confirmText="Show again"
				confirmLoading={reshow.isPending}
				onClose={() => setConfirm(null)}
				onConfirm={() =>
					reshow.mutate(undefined, {
						onSuccess: (next) => {
							setConfirm(null);
							toast.success(
								`Done. The banner will reappear for everyone, including people who dismissed it.${sentTo(next)}`,
							);
						},
						onError: (error) => {
							setConfirm(null);
							onError(error);
						},
					})
				}
			/>
			<ConfirmDialog
				type="delete"
				open={confirm === "reset"}
				title="Use the chart defaults"
				description="Discard what was published from this page and go back to the chart defaults?"
				confirmText="Discard"
				confirmLoading={reset.isPending}
				onClose={() => setConfirm(null)}
				onConfirm={() =>
					reset.mutate(undefined, {
						onSuccess: () => {
							setConfirm(null);
							setDraft(null);
							toast.success("Back to the chart defaults.");
						},
						onError: (error) => {
							setConfirm(null);
							onError(error);
						},
					})
				}
			/>
		</>
	);
};

export default AnnouncementSettingsPage;
