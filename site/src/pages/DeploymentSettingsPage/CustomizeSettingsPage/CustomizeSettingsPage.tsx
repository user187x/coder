import { cn } from "cn";
import { ChevronDownIcon, RotateCcwIcon } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { LogoState } from "#/api/platform";
import {
	logo,
	resetLogo,
	updateLogoVisibility,
	uploadLogo,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { FileUpload } from "#/components/FileUpload/FileUpload";
import { PageLoader } from "#/components/Loader/Loader";
import { Spinner } from "#/components/Spinner/Spinner";
import { Switch } from "#/components/Switch/Switch";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/Tabs/Tabs";
import {
	DEFAULT_LOGO_URL,
	setLogoEnabled,
	setLogoURL,
} from "#/contexts/platformBoot";
import { BackgroundSection } from "#/modules/platform/background/BackgroundSection";
import { GalleryPicker } from "#/modules/platform/gallery/GalleryPicker";
import { LoginPageSection } from "#/modules/platform/loginPage/LoginPageSection";
import AppearancePage from "#/pages/UserSettingsPage/AppearancePage/AppearancePage";
import { formatBytes } from "#/utils/images";
import {
	ImageNormalizeError,
	LOGO_TARGET,
	type NormalizedImage,
	normalizeImage,
} from "#/utils/normalizeImage";
import { pageTitle } from "#/utils/page";
import { DeploymentAnimations } from "./DeploymentAnimations";
import { NavbarAppearance } from "./NavbarAppearance";

const LOGO_EXTENSIONS = ["png", "jpg", "jpeg", "svg", "webp", "gif", "avif"];

/**
 * General > Appearance (named Customize before; its address is still
 * /deployment/customize): the logo shown everywhere in Coder (navigation bar,
 * sign-in and set-up pages, browser tab icon), the sign-in and sign-out page's
 * title, text effect and messages, and the faint background images
 * of the sign-in page and the dashboard, stored in Coder's own database by the
 * platform service, and your own theme and terminal font.
 */
const CustomizeSettingsPage: React.FC = () => {
	return (
		<>
			<title>{pageTitle("Appearance")}</title>
			<h1 className="sr-only">Appearance</h1>

			<div className="flex flex-col gap-6">
				<LogoSection />
				<NavbarAppearance />
				<DeploymentAnimations />

				<PagesAppearanceCard />

				<AppearancePage compact navbarLayout={false} />
			</div>
		</>
	);
};

/** The dashboard's background and the sign-in and sign-out page, one card with a tab for each. */
const PagesAppearanceCard: React.FC = () => {
	const [tab, setTab] = useState<"dashboard" | "login">("dashboard");
	return (
		<section
			aria-label="Dashboard and sign-in pages"
			className="rounded-xl border border-solid border-border bg-surface-primary p-6"
		>
			<Tabs
				value={tab}
				onValueChange={(value) => {
					if (value === "dashboard" || value === "login") setTab(value);
				}}
			>
				<TabsList aria-label="Page" className="mb-5">
					<TabsTrigger value="dashboard">Dashboard background</TabsTrigger>
					<TabsTrigger value="login">Sign-in and sign-out page</TabsTrigger>
				</TabsList>
				<TabsContent value="dashboard">
					<BackgroundSection embedded />
				</TabsContent>
				<TabsContent value="login">
					<LoginPageSection embedded />
				</TabsContent>
			</Tabs>
		</section>
	);
};

export const LogoSection: React.FC = () => {
	const queryClient = useQueryClient();
	const logoQuery = useQuery(logo());
	const reset = useMutation(resetLogo(queryClient));
	const visibility = useMutation({
		...updateLogoVisibility(queryClient),
		onSuccess: async ({ enabled }) => {
			setLogoEnabled(enabled);
			await queryClient.invalidateQueries({ queryKey: logo().queryKey });
		},
	});
	const [uploading, setUploading] = useState(false);
	const [confirmingReset, setConfirmingReset] = useState(false);

	if (logoQuery.isLoading) {
		return <PageLoader />;
	}
	if (!logoQuery.data) {
		return <ErrorAlert error={logoQuery.error} />;
	}

	return (
		<>
			{visibility.error && <ErrorAlert error={visibility.error} />}
			<LogoView
				logo={logoQuery.data}
				visibilityPending={visibility.isPending}
				onEnabledChange={(enabled) => visibility.mutate(enabled)}
				onUpload={() => setUploading(true)}
				onReset={() => setConfirmingReset(true)}
			/>
			{uploading && <LogoUploadDialog onClose={() => setUploading(false)} />}
			<ConfirmDialog
				type="delete"
				open={confirmingReset}
				title="Restore the default logo"
				description="Remove the custom logo and show the default logo again?"
				confirmText="Restore"
				confirmLoading={reset.isPending}
				onClose={() => setConfirmingReset(false)}
				onConfirm={() =>
					reset.mutate(undefined, {
						onSuccess: () => {
							setLogoURL(null);
							setConfirmingReset(false);
							toast.success("The default logo is back.");
						},
						onError: (error) => {
							toast.error(
								getErrorMessage(error, "The logo could not be reset."),
							);
						},
					})
				}
			/>
		</>
	);
};

type LogoViewProps = {
	logo: LogoState;
	onEnabledChange: (enabled: boolean) => void;
	visibilityPending?: boolean;
	onUpload: () => void;
	onReset: () => void;
};

export const LogoView: React.FC<LogoViewProps> = ({
	logo,
	onEnabledChange,
	visibilityPending,
	onUpload,
	onReset,
}) => {
	const visibilityId = useId();
	const [previewTheme, setPreviewTheme] = useState<"dark" | "light">("dark");
	return (
		<section
			aria-labelledby={`${visibilityId}-heading`}
			className="rounded-xl border border-solid border-border bg-surface-primary p-6"
		>
			<div className="grid items-start gap-6 xl:grid-cols-2">
				<div className="min-w-0">
					<div className="mb-4 flex flex-wrap items-center gap-3">
						<h2
							id={`${visibilityId}-heading`}
							className="m-0 text-base font-semibold"
						>
							Deployment branding
						</h2>
						<Badge variant={logo.set ? "green" : "default"}>
							{!logo.available
								? "Not available"
								: logo.enabled === false
									? "Hidden"
									: logo.set
										? "Custom logo"
										: "Default logo"}
						</Badge>
					</div>
					<label
						htmlFor={visibilityId}
						className="mb-5 flex items-start gap-3 text-sm font-medium"
					>
						<Switch
							id={visibilityId}
							checked={logo.enabled !== false}
							disabled={!logo.available || visibilityPending}
							onCheckedChange={onEnabledChange}
						/>
						<span>
							Show logo
							<span className="mt-1 block text-xs font-normal text-content-secondary">
								Navigation, sign-in, setup pages and browser tab. Hiding keeps
								your saved logo.
							</span>
						</span>
					</label>

					<p className="m-0 mt-4 text-sm text-content-secondary">
						{!logo.available
							? "The platform service is not connected to Coder's database, so a logo cannot be stored."
							: logo.enabled === false
								? "Logo hidden. Your saved logo is kept for when you turn it on again."
								: logo.set && logo.type && logo.bytes !== null
									? `${logo.type.replace("image/", "").toUpperCase()}, ${formatBytes(logo.bytes)} · uploaded by ${logo.updatedBy ?? "unknown"}${logo.updatedAt ? ` on ${new Date(logo.updatedAt).toLocaleString("en-US")}` : ""}`
									: "No custom logo: the default logo is shown."}
					</p>
					{/* One button: Change Logo, its arrow's menu restoring the default. */}
					<div className="mt-4 flex">
						<Button
							className="rounded-r-none"
							disabled={!logo.available}
							onClick={onUpload}
						>
							Change Logo
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									className="min-w-0 rounded-l-none border-0 border-l border-solid border-l-content-invert/25 px-2"
									disabled={!logo.available}
									aria-label="More logo choices"
									data-testid="logo-menu"
								>
									<ChevronDownIcon />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								<DropdownMenuItem disabled={!logo.set} onSelect={onReset}>
									<RotateCcwIcon />
									Restore the default logo
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
				<div className="flex min-w-0 flex-col gap-3">
					<span className="text-sm font-medium">Live preview</span>
					<Tabs
						value={previewTheme}
						onValueChange={(value) => {
							if (value === "dark" || value === "light") setPreviewTheme(value);
						}}
					>
						<TabsList aria-label="Logo preview theme">
							<TabsTrigger value="dark">Dark</TabsTrigger>
							<TabsTrigger value="light">Light</TabsTrigger>
						</TabsList>
						<TabsContent value={previewTheme}>
							<LogoPreview
								theme={previewTheme}
								src={logo.url}
								hidden={logo.enabled === false}
								caption={`${previewTheme === "dark" ? "Dark" : "Light"} theme preview`}
							/>
						</TabsContent>
					</Tabs>
				</div>
			</div>
		</section>
	);
};

type LogoPreviewProps = {
	theme: "dark" | "light";
	src: string | null;
	caption: string;
	signIn?: boolean;
	hidden?: boolean;
};

/** How the logo looks in the navigation bar (or on the sign-in page) of a theme. */
const LogoPreview: React.FC<LogoPreviewProps> = ({
	theme,
	src,
	caption,
	signIn = false,
	hidden = false,
}) => (
	<figure className="m-0">
		<div
			className={cn(
				theme,
				"flex rounded-md border border-solid border-border bg-surface-primary px-4 text-content-secondary",
				signIn
					? "h-32 flex-col items-center justify-center gap-3"
					: "h-[72px] items-center gap-4",
			)}
		>
			{!hidden && (
				<ExternalImage
					src={src || DEFAULT_LOGO_URL}
					alt="Logo"
					className={cn(
						"max-w-[200px] object-contain",
						signIn ? "h-12" : "h-7",
					)}
				/>
			)}
			<span className="text-sm">
				{signIn ? "Sign in to Coder" : "Workspaces · Templates"}
			</span>
		</div>
		<figcaption className="mt-1.5 text-xs text-content-secondary">
			{caption}
		</figcaption>
	</figure>
);

type PendingLogo = { file: File; image: NormalizedImage };

const LogoUploadDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
	const queryClient = useQueryClient();
	const upload = useMutation(uploadLogo(queryClient));
	const [pending, setPending] = useState<PendingLogo>();
	const [problem, setProblem] = useState<string>();
	const [galleryPick, setGalleryPick] = useState<string>();

	const pick = async (file: File) => {
		setPending(undefined);
		setProblem(undefined);
		try {
			setPending({ file, image: await normalizeImage(file, LOGO_TARGET) });
		} catch (error) {
			setProblem(
				`${file.name}: ${error instanceof ImageNormalizeError ? error.message : "this browser cannot read it as a picture."}`,
			);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !upload.isPending) {
					onClose();
				}
			}}
		>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Choose a new logo</DialogTitle>
					<DialogDescription>
						PNG, JPEG, SVG, WebP, GIF or AVIF; animated ones stay animated. It
						is resized for you to fit 512 × 256, so it looks the same
						everywhere. A wide logo about 3 to 4 times as wide as it is tall
						works best.
					</DialogDescription>
				</DialogHeader>
				<FileUpload
					isUploading={false}
					file={pending?.file}
					extensions={LOGO_EXTENSIONS}
					title="Choose an image or drop it here"
					removeLabel="Choose another image"
					onUpload={(file) => {
						setGalleryPick(undefined);
						void pick(file);
					}}
					onUnsupportedFile={(file) =>
						setProblem(
							`${file.name}: not a PNG, JPEG, SVG, WebP, GIF or AVIF image.`,
						)
					}
					onRemove={() => {
						setGalleryPick(undefined);
						setPending(undefined);
					}}
				/>
				<GalleryPicker
					lava={{ size: 256, maxBytes: LOGO_TARGET.maxOutputBytes }}
					selected={galleryPick}
					onSelect={setGalleryPick}
					disabled={upload.isPending}
					onPick={(file) => {
						void pick(file);
					}}
				/>
				{pending && (
					<div className="grid gap-4 sm:grid-cols-3">
						<LogoPreview
							theme="dark"
							src={pending.image.dataURL}
							caption="Navigation bar (dark)"
						/>
						<LogoPreview
							theme="light"
							src={pending.image.dataURL}
							caption="Navigation bar (light)"
						/>
						<LogoPreview
							theme="dark"
							src={pending.image.dataURL}
							caption="Sign-in page"
							signIn
						/>
					</div>
				)}
				{pending && (
					<p className="m-0 text-xs text-content-secondary">
						{pending.image.width
							? `Resized to ${pending.image.width} × ${pending.image.height}`
							: "Kept as uploaded"}
						{pending.image.frames > 1 ? `, ${pending.image.frames} frames` : ""}
						, {pending.image.type.replace("image/", "").toUpperCase()},{" "}
						{formatBytes(pending.image.bytes)}.
					</p>
				)}
				{problem && (
					<p role="alert" className="m-0 text-sm text-content-destructive">
						{problem}
					</p>
				)}
				{upload.error ? <ErrorAlert error={upload.error} /> : null}
				<DialogFooter className="gap-2">
					<Button
						variant="outline"
						disabled={upload.isPending}
						onClick={onClose}
					>
						Cancel
					</Button>
					<Button
						disabled={!pending || upload.isPending}
						onClick={() => {
							if (!pending) {
								return;
							}
							upload.mutate(pending.image.dataURL, {
								onSuccess: ({ url }) => {
									setLogoURL(url);
									toast.success("Logo saved.");
									onClose();
								},
							});
						}}
					>
						<Spinner loading={upload.isPending} />
						Save logo
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export default CustomizeSettingsPage;
