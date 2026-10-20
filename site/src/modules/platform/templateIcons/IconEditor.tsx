import { cn } from "cn";
import {
	ImageOffIcon,
	ImagesIcon,
	RotateCcwIcon,
	SmileIcon,
	UploadIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { templateIconPath } from "#/api/platform";
import { templateIcons, uploadTemplateIcon } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { IconPicker } from "#/components/IconField/IconField";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import { Spinner } from "#/components/Spinner/Spinner";
import { ImageStoreMenu } from "../imageStore/ImageStoreMenu";
import { fetchStoreImage } from "../imageStore/imageStore";
import {
	ICON_TARGET,
	ImageNormalizeError,
	normalizeImage,
} from "../normalizeImage";
import { iconNameFromFile } from "./TemplateIconsDialog";

/** How many of the uploaded icons show as one-click choices. */
const QUICK = 12;

/** A name not taken yet: name, name-2, name-3, ... (an upload never replaces another template's icon). */
export const freeIconName = (wanted: string, taken: readonly string[]) => {
	const base = wanted || "icon";
	if (!taken.includes(base)) {
		return base;
	}
	for (let n = 2; ; n++) {
		const name = `${base.slice(0, 60)}-${n}`;
		if (!taken.includes(name)) {
			return name;
		}
	}
};

type IconEditorProps = {
	value: string;
	onChange: (value: string) => void;
	/** Shown faded while it is empty: a workspace's template icon. */
	fallback?: string;
	/** What empty is: "Use the template's" (a workspace), "No icon" (a template). */
	resetLabel: string;
	/** An uploaded picture's name, before the file's own: the template's name. */
	uploadName?: string;
	disabled?: boolean;
	error?: boolean;
	helperText?: React.ReactNode;
};

/** The icons uploaded in Templates > Icons, and an upload there (owners and template admins) chosen at once. */
const useIconUpload = (
	onChange: (value: string) => void,
	uploadName: string | undefined,
) => {
	const queryClient = useQueryClient();
	const icons = useQuery(templateIcons());
	const upload = useMutation(uploadTemplateIcon(queryClient));
	const list = icons.data?.icons ?? [];

	const onFile = async (file: File) => {
		try {
			const image = await normalizeImage(file, ICON_TARGET);
			const name = freeIconName(
				iconNameFromFile(uploadName || file.name),
				list.map((icon) => icon.name),
			);
			await upload.mutateAsync({ name, dataUrl: image.dataURL });
			onChange(templateIconPath(name));
			toast.success(`Uploaded as ${name} (Templates > Icons).`);
		} catch (err) {
			toast.error(
				err instanceof ImageNormalizeError
					? `${file.name}: ${err.message}`
					: getErrorMessage(err, `${file.name} could not be uploaded.`),
			);
		}
	};

	return {
		list,
		canUpload: icons.data?.canManage ?? false,
		upload,
		onFile,
	};
};

/**
 * Picking an icon (a template's, a workspace's): a large preview, the icons
 * uploaded in Templates > Icons as one-click choices, Upload (a picture from
 * the computer, saved there - owners and template admins), Emoji or icon
 * (Coder's picker), a reset, and the icon's address for anything else (a
 * path such as /icon/go.svg, or a URL).
 */
export const IconEditor: React.FC<IconEditorProps> = ({
	value,
	onChange,
	fallback,
	resetLabel,
	uploadName,
	disabled,
	error,
	helperText,
}) => {
	const addressId = useId();
	const helperId = useId();
	const input = useRef<HTMLInputElement>(null);
	const { list, canUpload, upload, onFile } = useIconUpload(
		onChange,
		uploadName,
	);
	const [picking, setPicking] = useState(false);
	const [broken, setBroken] = useState<string>();
	const shown = value || fallback || "";

	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
			<div
				className={cn(
					"flex size-[88px] shrink-0 items-center justify-center rounded-xl border border-solid bg-surface-secondary",
					error ? "border-border-destructive" : "border-border",
				)}
				data-testid="icon-preview"
				title={
					value ? value : fallback ? `${resetLabel}: ${fallback}` : "No icon"
				}
			>
				{shown && broken !== shown ? (
					<ExternalImage
						src={shown}
						alt=""
						className={cn(
							"size-14 object-contain",
							!value && "opacity-45 grayscale",
						)}
						onError={() => setBroken(shown)}
					/>
				) : (
					<ImageOffIcon className="size-7 text-content-disabled" />
				)}
			</div>

			<div className="flex min-w-0 flex-1 flex-col gap-3">
				<div className="flex flex-wrap items-center gap-2">
					{canUpload && (
						<>
							<input
								ref={input}
								type="file"
								hidden
								accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/avif"
								data-testid="icon-upload-input"
								onChange={(event) => {
									const file = event.target.files?.[0];
									event.target.value = "";
									if (file) {
										void onFile(file);
									}
								}}
							/>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={disabled || upload.isPending}
								onClick={() => input.current?.click()}
							>
								<Spinner loading={upload.isPending}>
									<UploadIcon />
								</Spinner>
								Upload
							</Button>
							{/* Platform: or one from the image store, resized like an upload */}
							<ImageStoreMenu
								disabled={disabled || upload.isPending}
								onChoose={(image) => void fetchStoreImage(image).then(onFile)}
							/>
						</>
					)}
					<Popover open={picking} onOpenChange={setPicking}>
						<PopoverTrigger asChild>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={disabled}
								aria-label="Pick an emoji or icon"
							>
								<SmileIcon />
								Emoji or icon
							</Button>
						</PopoverTrigger>
						<PopoverContent side="bottom" align="start" className="w-min">
							<IconPicker
								onPick={(picked) => {
									onChange(picked);
									setPicking(false);
								}}
							/>
						</PopoverContent>
					</Popover>
					{value && (
						<Button
							type="button"
							size="sm"
							variant="subtle"
							disabled={disabled}
							onClick={() => onChange("")}
						>
							<RotateCcwIcon />
							{resetLabel}
						</Button>
					)}
				</div>

				{list.length > 0 && (
					<div
						role="listbox"
						aria-label="Uploaded icons"
						className="flex flex-wrap gap-1.5"
					>
						{list.slice(0, QUICK).map((icon) => {
							const path = templateIconPath(icon.name);
							const chosen = value === path;
							return (
								<button
									key={icon.name}
									type="button"
									role="option"
									aria-selected={chosen}
									aria-label={icon.name}
									title={icon.name}
									disabled={disabled}
									onClick={() => onChange(path)}
									className={cn(
										"flex size-9 cursor-pointer items-center justify-center rounded-md border border-solid bg-surface-primary p-1 hover:border-content-link disabled:cursor-not-allowed",
										chosen
											? "border-content-link ring-2 ring-content-link/30"
											: "border-border",
									)}
								>
									<img
										src={icon.url}
										alt=""
										className="size-6 object-contain"
									/>
								</button>
							);
						})}
						{list.length > QUICK && (
							<button
								type="button"
								className="flex h-9 cursor-pointer items-center rounded-md border border-dashed border-border bg-transparent px-2 text-xs text-content-secondary hover:text-content-primary"
								onClick={() => setPicking(true)}
							>
								+{list.length - QUICK} more
							</button>
						)}
					</div>
				)}

				<div className="flex flex-col gap-1">
					<Label htmlFor={addressId} className="text-xs text-content-secondary">
						Or its address
					</Label>
					<Input
						id={addressId}
						value={value}
						disabled={disabled}
						spellCheck={false}
						placeholder={fallback || "/icon/go.svg"}
						aria-invalid={error}
						aria-describedby={helperText ? helperId : undefined}
						className="h-8 text-xs"
						onChange={(event) => onChange(event.target.value.trim())}
					/>
					{helperText && (
						<span
							id={helperId}
							className={cn(
								"text-xs",
								error ? "text-content-destructive" : "text-content-secondary",
							)}
						>
							{helperText}
						</span>
					)}
				</div>
			</div>
		</div>
	);
};

type InlineIconEditorProps = Pick<
	IconEditorProps,
	"value" | "onChange" | "fallback" | "resetLabel" | "uploadName" | "disabled"
> & {
	/** The preview's tile, and the buttons (the page's own look). */
	previewClassName?: string;
	buttonClassName?: string;
	/** Shown in the preview while there is no icon at all. */
	placeholder?: React.ReactNode;
	uploadIcon?: React.ReactNode;
	pickIcon?: React.ReactNode;
	resetIcon?: React.ReactNode;
};

/**
 * The icon editor in one line (the workspace settings page): a small preview, Upload, and Emoji or icon - whose picker
 * also offers the icons uploaded in Templates > Icons - and, once one is chosen, a way back to the fallback. No
 * address field.
 */
export const InlineIconEditor: React.FC<InlineIconEditorProps> = ({
	value,
	onChange,
	fallback,
	resetLabel,
	uploadName,
	disabled,
	previewClassName,
	buttonClassName,
	placeholder,
	uploadIcon = <UploadIcon />,
	pickIcon = <SmileIcon />,
	resetIcon = <RotateCcwIcon />,
}) => {
	const input = useRef<HTMLInputElement>(null);
	const { list, canUpload, upload, onFile } = useIconUpload(
		onChange,
		uploadName,
	);
	const [picking, setPicking] = useState(false);
	const [broken, setBroken] = useState<string>();
	const shown = value || fallback || "";

	return (
		<div className="flex flex-wrap items-center gap-2.5">
			<div
				className={cn(
					"flex size-11 shrink-0 items-center justify-center",
					previewClassName,
				)}
				data-testid="icon-preview"
				title={
					value ? value : fallback ? `${resetLabel}: ${fallback}` : "No icon"
				}
			>
				{shown && broken !== shown ? (
					<ExternalImage
						src={shown}
						alt=""
						className={cn("size-6 object-contain", !value && "opacity-60")}
						onError={() => setBroken(shown)}
					/>
				) : (
					placeholder
				)}
			</div>
			{canUpload && (
				<>
					<input
						ref={input}
						type="file"
						hidden
						accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/avif"
						data-testid="icon-upload-input"
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file) {
								void onFile(file);
							}
						}}
					/>
					<button
						type="button"
						className={buttonClassName}
						disabled={disabled || upload.isPending}
						onClick={() => input.current?.click()}
					>
						{upload.isPending ? <Spinner loading size="sm" /> : uploadIcon}
						Upload
					</button>
					<ImageStoreMenu
						disabled={disabled || upload.isPending}
						onChoose={(image) => void fetchStoreImage(image).then(onFile)}
						trigger={
							<button
								type="button"
								className={buttonClassName}
								disabled={disabled || upload.isPending}
								data-testid="image-store-menu"
							>
								<ImagesIcon className="size-4" />
								Image store
							</button>
						}
					/>
				</>
			)}
			<Popover open={picking} onOpenChange={setPicking}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className={buttonClassName}
						disabled={disabled}
						aria-label="Pick an emoji or icon"
					>
						{pickIcon}
						Emoji or icon
					</button>
				</PopoverTrigger>
				<PopoverContent side="bottom" align="start" className="w-min">
					{list.length > 0 && (
						<div
							role="listbox"
							aria-label="Uploaded icons"
							className="mb-2 flex max-w-[22rem] flex-wrap gap-1.5 border-0 border-b border-solid border-border pb-2"
						>
							{list.map((icon) => {
								const path = templateIconPath(icon.name);
								return (
									<button
										key={icon.name}
										type="button"
										role="option"
										aria-selected={value === path}
										aria-label={icon.name}
										title={icon.name}
										onClick={() => {
											onChange(path);
											setPicking(false);
										}}
										className={cn(
											"flex size-9 cursor-pointer items-center justify-center rounded-md border border-solid bg-surface-primary p-1 hover:border-content-link",
											value === path
												? "border-content-link ring-2 ring-content-link/30"
												: "border-border",
										)}
									>
										<img
											src={icon.url}
											alt=""
											className="size-6 object-contain"
										/>
									</button>
								);
							})}
						</div>
					)}
					<IconPicker
						onPick={(picked) => {
							onChange(picked);
							setPicking(false);
						}}
					/>
				</PopoverContent>
			</Popover>
			{value && (
				<button
					type="button"
					className={buttonClassName}
					disabled={disabled}
					onClick={() => onChange("")}
				>
					{resetIcon}
					{resetLabel}
				</button>
			)}
		</div>
	);
};
