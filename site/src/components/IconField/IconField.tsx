import { cn } from "cn";
import { SmilePlusIcon, UploadIcon } from "lucide-react";
import { lazy, Suspense, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { PlatformAPI, templateIconPath } from "#/api/platform";
import { templateIcons, templateIconsKey } from "#/api/queries/platform";
import { ChevronDownIcon as AnimatedChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "#/components/InputGroup/InputGroup";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "#/components/Popover/Popover";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	ICON_TARGET,
	ImageNormalizeError,
	normalizeImage,
} from "#/modules/platform/normalizeImage";
import { iconNameFromFile } from "#/modules/platform/templateIcons/TemplateIconsDialog";

/** The pictures Upload image takes (as Templates > Icons). */
const ICON_ACCEPT = ".png,.jpg,.jpeg,.svg,.webp,.gif,.avif,image/*";

const EmojiPicker = lazy(() => import("./EmojiPicker"));

type IconFieldProps = Omit<React.ComponentProps<"input">, "type"> & {
	label?: React.ReactNode;
	error?: boolean;
	helperText?: React.ReactNode;
	onPickEmoji: (value: string) => void;
	/** Accepted for call-site compatibility with former MUI TextField usage. */
	fullWidth?: boolean;
};

export const IconField: React.FC<IconFieldProps> = ({
	id: idProp,
	value,
	label = "Icon",
	error,
	helperText,
	disabled,
	className,
	onPickEmoji,
	fullWidth: _fullWidth,
	...inputProps
}) => {
	if (typeof value !== "string" && typeof value !== "undefined") {
		throw new Error(`Invalid icon value "${typeof value}"`);
	}

	const generatedId = useId();
	const id = idProp ?? generatedId;
	const errorId = `${id}-error`;
	const helperId = `${id}-helper`;
	const [open, setOpen] = useState(false);
	const [uploading, setUploading] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const queryClient = useQueryClient();
	const stringValue = value ?? "";

	// Upload image: the picture goes to the icon library (Templates > Icons, owners and template admins), resized to
	// fit 256 x 256, under a name from its file (a free one: an icon of that name is never replaced), and is used.
	const upload = async (file: File) => {
		setUploading(true);
		try {
			const image = await normalizeImage(file, ICON_TARGET);
			const taken = new Set(
				(
					await queryClient.fetchQuery(templateIcons()).catch(() => undefined)
				)?.icons.map((icon) => icon.name) ?? [],
			);
			const base = iconNameFromFile(file.name) || "icon";
			let name = base;
			for (let i = 2; taken.has(name); i++) {
				name = `${base.slice(0, 60)}-${i}`;
			}
			await PlatformAPI.uploadTemplateIcon({ name, dataUrl: image.dataURL });
			await queryClient.invalidateQueries({ queryKey: templateIconsKey });
			onPickEmoji(templateIconPath(name));
			toast.success(`Icon ${name} uploaded and chosen.`);
		} catch (error) {
			toast.error(
				error instanceof ImageNormalizeError
					? `${file.name}: ${error.message}`
					: getErrorMessage(error, "The image was not uploaded."),
			);
		} finally {
			setUploading(false);
		}
	};
	const hasIcon = stringValue !== "";

	return (
		<div className="flex w-full flex-col gap-2">
			{label ? (
				<Label htmlFor={id} className="text-sm">
					{label}
				</Label>
			) : null}
			<InputGroup>
				<InputGroupInput
					{...inputProps}
					id={id}
					value={stringValue}
					disabled={disabled}
					aria-invalid={error}
					aria-describedby={
						helperText ? (error ? errorId : helperId) : undefined
					}
					className={cn("min-w-0 placeholder:text-content-disabled", className)}
					spellCheck={false}
				/>
				<InputGroupAddon align="inline-end" className="gap-1.5">
					{hasIcon && (
						<span className="flex size-5 items-center justify-center">
							<ExternalImage
								alt=""
								src={stringValue}
								className="max-w-full object-contain"
								onError={(event) => {
									event.currentTarget.style.display = "none";
								}}
								onLoad={(event) => {
									event.currentTarget.style.display = "inline";
								}}
							/>
						</span>
					)}
					<Popover open={open} onOpenChange={setOpen}>
						<DropdownMenu>
							<PopoverAnchor asChild>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="subtle"
										size="sm"
										className="group h-7 gap-1"
										disabled={disabled || uploading}
										aria-label="Pick an emoji or icon"
									>
										{uploading ? <Spinner loading /> : null}
										Emoji
										<AnimatedChevronDownIcon />
									</Button>
								</DropdownMenuTrigger>
							</PopoverAnchor>
							<DropdownMenuContent
								align="end"
								onClick={(event) => event.stopPropagation()}
							>
								<DropdownMenuItem
									onSelect={() => setOpen(true)}
									data-testid="icon-field-emoji"
								>
									<SmilePlusIcon />
									Emoji or icon…
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => fileRef.current?.click()}
									data-testid="icon-field-upload"
								>
									<UploadIcon />
									Upload image…
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<PopoverContent
							side="bottom"
							align="end"
							className="w-min"
							// The popover is portaled in the DOM but still a React child of
							// InputGroupAddon, whose click handler focuses the text input.
							// Stop clicks here so the emoji picker keeps focus.
							onClick={(event) => event.stopPropagation()}
						>
							<IconPicker
								onPick={(picked) => {
									onPickEmoji(picked);
									setOpen(false);
								}}
							/>
						</PopoverContent>
					</Popover>
					<input
						ref={fileRef}
						type="file"
						accept={ICON_ACCEPT}
						className="hidden"
						data-testid="icon-field-file"
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file) {
								void upload(file);
							}
						}}
					/>
				</InputGroupAddon>
			</InputGroup>
			{helperText ? (
				<span
					id={error ? errorId : helperId}
					className={cn(
						"text-xs",
						error ? "text-content-destructive" : "text-content-secondary",
					)}
				>
					{helperText}
				</span>
			) : null}

			{/*
      - This component takes a long time to load (easily several seconds), so we
      don't want to wait until the user actually clicks the button to start loading.
      Unfortunately, React doesn't provide an API to start warming a lazy component,
      so we just have to sneak it into the DOM, which is kind of annoying, but means
      that users shouldn't ever spend time waiting for it to load.
      - Except we don't do it when running tests, because it would make them
      slower anyway. */}
			{process.env.NODE_ENV !== "test" && (
				<div className="sr-only" aria-hidden="true">
					<Suspense>
						<EmojiPicker onEmojiSelect={() => {}} />
					</Suspense>
				</div>
			)}
		</div>
	);
};

/**
 * The emoji picker with icons uploaded in Templates > Icons in their own
 * category. Mounted only while the popover is open, so the list is fetched on
 * first use; without the platform service the category is simply absent.
 */
export const IconPicker: React.FC<{ onPick: (value: string) => void }> = ({
	onPick,
}) => {
	const iconsQuery = useQuery(templateIcons());
	if (iconsQuery.isLoading) {
		return <Loader />;
	}
	const uploadedIcons = (iconsQuery.data?.icons ?? []).map((icon) => ({
		name: icon.name,
		url: templateIconPath(icon.name),
	}));
	return (
		<Suspense fallback={<Loader />}>
			<EmojiPicker
				uploadedIcons={uploadedIcons}
				onEmojiSelect={(emoji) => {
					onPick(emoji.src ?? `/emojis/${emoji.unified}.png`);
				}}
				autoFocus
			/>
		</Suspense>
	);
};
