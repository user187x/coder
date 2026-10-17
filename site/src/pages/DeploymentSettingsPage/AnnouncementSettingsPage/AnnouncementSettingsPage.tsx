import { PlayIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type Banner,
	type BannerFields,
	type BannerState,
	CRAWL_TILT,
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
import {
	fromMarkdown,
	hasContent,
	parseColors,
} from "#/modules/platform/announcement/bannerTokens";
import { pageTitle } from "#/utils/page";
import { Acknowledgements } from "./Acknowledgements";
import { BannerEditor, MESSAGE_MAX_LENGTH } from "./BannerEditor";

// The crawl's pace before it had a slider of its own (announcements with only a speed).
const LEGACY_CRAWL_SPEED = { slow: 9, normal: 15, fast: 26 } as const;

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
	"speed",
	"crawlSpeed",
	"crawlTilt",
	"font",
	"receipts",
	"closeEffect",
	"openEffect",
	"markdown",
	"align",
	"outline",
	"picture",
	"pictureFit",
	"countdown",
] as const;

/**
 * A banner saved before effects (and the rest) existed has none: that means
 * "none", not "changed". A Markdown message with nothing of Markdown in it is
 * the plain text it reads as.
 */
const fieldsOf = ({ id: _id, ...banner }: Banner): BannerFields => {
	const fields: BannerFields = {
		...banner,
		effect: banner.effect ?? "none",
		repeat: banner.repeat ?? false,
		speed: banner.speed ?? "normal",
		crawlSpeed:
			banner.crawlSpeed ?? LEGACY_CRAWL_SPEED[banner.speed ?? "normal"],
		crawlTilt: banner.crawlTilt ?? CRAWL_TILT.default,
		font: banner.font ?? "default",
		receipts: banner.receipts ?? true,
		closeEffect: banner.closeEffect ?? "fade",
		openEffect: banner.openEffect ?? "none",
		markdown: banner.markdown ?? true,
		align: banner.align ?? "center",
		outline: banner.outline ?? false,
		picture: banner.picture ?? "",
		pictureFit: banner.pictureFit ?? "span",
		countdown: banner.countdown ?? "",
	};
	if (fields.markdown) {
		const plain = fromMarkdown(fields.message);
		if (
			plain.message === fields.message &&
			!plain.countdown &&
			!plain.picture
		) {
			fields.markdown = false;
		}
	}
	return fields;
};

const sameFields = (a: BannerFields, b: BannerFields) =>
	FIELDS.every((field) => a[field] === b[field]);

/**
 * The published announcement as the editor writes it, plain text. One
 * written in Markdown (or before it, with a bold lead-in and a link) becomes
 * plain text, its first countdown and first picture the banner's countdown
 * and background image (an unpublished edit: the banner keeps showing it as
 * it was until it is published).
 */
export const editableFields = (banner: Banner): BannerFields => {
	const fields = fieldsOf(banner);
	const title = fields.title.trim();
	const isColors = Boolean(parseColors(title));
	if (
		!fields.markdown &&
		(!title || isColors) &&
		!fields.linkUrl &&
		!fields.linkText
	) {
		return fields;
	}
	let message = fields.markdown
		? fields.message.trim()
		: fields.message.trim().replace(/[\\`*_~[\]{}()]/g, "\\$&");
	if (title && !isColors) {
		message = `${title} ${message}`;
	}
	if (fields.linkUrl) {
		message = `${message} [${fields.linkText || fields.linkUrl}](${fields.linkUrl})`;
	}
	const plain = fromMarkdown(message);
	return {
		...fields,
		title: isColors ? title : "",
		message: plain.message.slice(0, MESSAGE_MAX_LENGTH),
		linkText: "",
		linkUrl: "",
		markdown: false,
		picture: fields.picture || plain.picture,
		pictureFit: fields.picture ? fields.pictureFit : plain.pictureFit,
		countdown: fields.countdown || plain.countdown,
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

type ConfirmKind = "reshow" | "reset";

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
	// The preview: replayed (its effect again) by changing its key; "Try it"
	// plays its close transition, then it comes back.
	const [run, setRun] = useState(0);
	const [closing, setClosing] = useState(false);
	const [gone, setGone] = useState(false);
	const preview = useRef<HTMLElement>(null);
	const reducedMotion =
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

	const published = fieldsOf(state.banner);
	const form = draft ?? editableFields(state.banner);
	const dirty = !sameFields(form, published);
	const live = state.banner.enabled && hasContent(state.banner);
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
								if (enabled && !hasContent(state.banner)) {
									setProblem("Write and publish an announcement first.");
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
						disabled={busy || !hasContent(state.banner)}
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
				ref={preview}
				aria-labelledby="announcement-preview"
				className="flex scroll-mt-6 flex-col gap-3 rounded-lg border border-solid border-border p-6"
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 id="announcement-preview" className="m-0 text-base font-semibold">
						What developers see
					</h2>
					<div className="flex items-center gap-3">
						<Button
							size="sm"
							variant="outline"
							disabled={
								(form.effect === "none" &&
									(form.openEffect ?? "none") === "none") ||
								!hasContent(form) ||
								closing
							}
							title="Play the open transition and the text effect again"
							onClick={() => setRun((n) => n + 1)}
						>
							<PlayIcon />
							Replay
						</Button>
						<Badge variant={live ? "green" : "default"} role="status">
							{live
								? `Live for all developers${tabsText(state, " · ", " connected")}`
								: "Hidden"}
						</Badge>
					</div>
				</div>
				<div
					className="min-h-[62px] rounded-md bg-surface-secondary p-3"
					data-testid="announcement-preview"
				>
					{hasContent(form) ? (
						!gone && (
							<BannerPreview
								// A new effect (or its speed, or repeat), or open transition, plays from the start.
								key={`${run}:${form.effect}:${form.speed}:${form.repeat}:${form.openEffect}`}
								banner={form}
								animate
								closing={closing}
								onClosed={() => {
									setGone(true);
									window.setTimeout(() => {
										setGone(false);
										setClosing(false);
										setRun((n) => n + 1);
									}, 700);
								}}
							/>
						)
					) : (
						<p className="m-0 text-sm text-content-secondary">
							Type a message (or choose a background image) to see a preview.
						</p>
					)}
				</div>
				<p className="m-0 text-sm text-content-secondary">
					Live preview of your draft below, its text effect playing. Nothing is
					published until you press <strong>Publish changes</strong>.
					{reducedMotion &&
						" This device asks for reduced motion, so effects are not played here, or for anyone with that setting."}
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
				onPublish={doPublish}
				onTryOpen={() => {
					preview.current?.scrollIntoView({
						block: "nearest",
						behavior: "smooth",
					});
					setRun((n) => n + 1);
				}}
				onTryClose={() => {
					preview.current?.scrollIntoView({
						block: "nearest",
						behavior: "smooth",
					});
					setClosing(true);
				}}
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
