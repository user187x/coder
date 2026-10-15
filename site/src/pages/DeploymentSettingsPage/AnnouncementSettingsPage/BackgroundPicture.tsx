import {
	ChevronDownIcon,
	ExpandIcon,
	ImagePlusIcon,
	LayoutGridIcon,
	type LucideIcon,
	MoveHorizontalIcon,
	ShrinkIcon,
	UnfoldVerticalIcon,
	XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { getErrorMessage } from "#/api/errors";
import { PICTURE_FITS, type PictureFit, PlatformAPI } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { BANNER_PRESET_PICTURES } from "#/modules/platform/pictures";

/** How the background image fills the banner's screen, as the menu offers it. */
const FIT_OPTIONS: Record<
	PictureFit,
	{ label: string; hint: string; icon: LucideIcon }
> = {
	center: {
		label: "Center",
		hint: "The whole image, fitted in the middle",
		icon: ShrinkIcon,
	},
	span: {
		label: "Span",
		hint: "As wide as the screen, rolling through it",
		icon: UnfoldVerticalIcon,
	},
	tile: {
		label: "Tile",
		hint: "Repeated across, as tall as the screen",
		icon: LayoutGridIcon,
	},
	fill: {
		label: "Fill",
		hint: "Covering the screen, its middle showing",
		icon: ExpandIcon,
	},
	stretch: {
		label: "Stretch",
		hint: "Squeezed to the screen's size",
		icon: MoveHorizontalIcon,
	},
};

/** The fits in the menu's order. */
const FIT_ORDER: readonly PictureFit[] = [
	"span",
	"tile",
	"stretch",
	"center",
	"fill",
];

/** What the platform service accepts (it checks again). */
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif";
const MAX_BYTES = 8 * 1024 * 1024;

const readAsDataUrl = (file: File) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});

type UploadImageButtonProps = {
	onChange: (picture: string) => void;
	onProblem: (problem: string) => void;
};

/**
 * Platform: the announcement's background image. Upload image opens the file
 * chooser straight away (PNG, JPEG, GIF - animated too -, WebP or AVIF, up to
 * 8 MB; the platform service keeps it as it is and serves it on the Coder
 * site); its arrow offers the preset images baked into the dashboard.
 */
export const UploadImageButton: React.FC<UploadImageButtonProps> = ({
	onChange,
	onProblem,
}) => {
	const input = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);

	const upload = async (file: File) => {
		if (file.size > MAX_BYTES) {
			onProblem("The image must be smaller than 8 MB.");
			return;
		}
		setUploading(true);
		try {
			// As it is: no canvas, which would keep only an animated GIF's first frame.
			const uploaded = await PlatformAPI.uploadBannerPicture(
				file.name,
				await readAsDataUrl(file),
			);
			onChange(uploaded.url);
		} catch (error) {
			onProblem(getErrorMessage(error, "The image could not be uploaded."));
		} finally {
			setUploading(false);
		}
	};

	return (
		<div
			role="group"
			aria-label="Background image"
			className="flex flex-wrap items-center gap-2"
		>
			<div className="flex">
				<Button
					size="sm"
					variant="outline"
					className="rounded-r-none"
					disabled={uploading}
					onClick={() => input.current?.click()}
					title="Upload an image (PNG, JPEG, GIF - animated too -, WebP; up to 8 MB) as the banner's background"
				>
					{uploading ? <Spinner loading /> : <ImagePlusIcon />}
					Upload image
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							size="sm"
							variant="outline"
							className="-ml-px min-w-0 rounded-l-none px-2"
							aria-label="Preset images"
							title="Preset images"
							data-testid="announcement-preset-menu"
						>
							<ChevronDownIcon />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						<DropdownMenuLabel>Preset images</DropdownMenuLabel>
						{BANNER_PRESET_PICTURES.map((preset) => (
							<DropdownMenuItem
								key={preset.name}
								data-testid={`announcement-preset-${preset.name}`}
								onSelect={() => onChange(preset.url)}
							>
								<span className="flex h-6 w-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-[#09090b]">
									<img
										src={preset.url}
										alt=""
										className="max-h-full max-w-full object-contain"
									/>
								</span>
								{preset.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<input
				ref={input}
				type="file"
				accept={ACCEPT}
				hidden
				data-testid="announcement-picture-input"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) {
						void upload(file);
					}
				}}
			/>
		</div>
	);
};

/** The background image chosen, small, with a button to take it away. */
export const ChosenImage: React.FC<{
	picture: string;
	onRemove: () => void;
}> = ({ picture, onRemove }) => (
	<span
		className="flex h-8 items-center gap-1 rounded-md border border-solid border-border pl-0.5"
		data-testid="announcement-picture-chosen"
		title={picture}
	>
		<span className="flex h-[26px] w-11 items-center justify-center overflow-hidden rounded-[4px] bg-[#09090b]">
			<img
				src={picture}
				alt="The banner's background"
				className="max-h-full max-w-full object-contain"
			/>
		</span>
		<Button
			size="icon"
			variant="subtle"
			className="size-7"
			aria-label="Remove the background image"
			title="Remove the background image"
			onClick={onRemove}
		>
			<XIcon />
		</Button>
	</span>
);

type PictureFitSelectProps = {
	value: PictureFit;
	disabled: boolean;
	onChange: (fit: PictureFit) => void;
};

/** How the background image fills the banner's screen (Span, Tile, Stretch, Center, Fill), each with its icon. */
export const PictureFitSelect: React.FC<PictureFitSelectProps> = ({
	value,
	disabled,
	onChange,
}) => {
	return (
		<Select
			value={value}
			disabled={disabled}
			onValueChange={(next) => {
				const fit = PICTURE_FITS.find((f) => f === next);
				if (fit) {
					onChange(fit);
				}
			}}
		>
			<SelectTrigger
				className="h-8 w-36 text-xs"
				aria-label="Background image fit"
				title={
					disabled
						? "Choose a background image first"
						: `How the image fills the banner's screen: ${FIT_OPTIONS[value].hint}`
				}
				data-testid="announcement-picture-fit"
			>
				{/* The chosen fit's icon and name, as its menu item shows them. */}
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{FIT_ORDER.map((f) => {
					const { label, hint, icon: Icon } = FIT_OPTIONS[f];
					return (
						<SelectItem key={f} value={f} title={hint}>
							<span className="flex items-center gap-2">
								<Icon aria-hidden className="size-3.5" />
								{label}
							</span>
						</SelectItem>
					);
				})}
			</SelectContent>
		</Select>
	);
};
