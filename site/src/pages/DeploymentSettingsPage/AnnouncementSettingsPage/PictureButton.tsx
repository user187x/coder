import {
	ExpandIcon,
	ImagePlusIcon,
	LayoutGridIcon,
	type LucideIcon,
	MoveHorizontalIcon,
	ShrinkIcon,
	UnfoldVerticalIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { getErrorMessage } from "#/api/errors";
import { PICTURE_FITS, type PictureFit, PlatformAPI } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { BANNER_PRESET_PICTURES } from "#/modules/platform/pictures";

/** How a picture fills the banner's screen, as the menu offers it. */
export const FIT_OPTIONS: Record<
	PictureFit,
	{ label: string; hint: string; icon: LucideIcon }
> = {
	center: {
		label: "Center",
		hint: "The whole picture, fitted in the middle",
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

/** The Markdown for a picture: its file name (without the extension) as its description, its fit in its address. */
export const pictureMarkdown = (
	fileName: string,
	url: string,
	fit: PictureFit = "span",
) => {
	const alt =
		fileName
			.replace(/\.[^.]+$/, "")
			.replace(/[[\]()\\*_`~!]/g, "")
			.trim()
			.slice(0, 80) || "picture";
	return `![${alt}](${url}#fit=${fit})`;
};

type PictureButtonProps = {
	/** Puts the picture's Markdown into the message, at the caret. */
	onInsert: (markdown: string) => void;
	onProblem: (problem: string) => void;
};

/**
 * Platform: General > Announcement's pictures, three controls side by side:
 * the fit (how a picture fills the banner's screen: Center, Span, Tile, Fill,
 * Stretch), Upload picture (PNG, JPEG, GIF - animated too -, WebP or AVIF, up
 * to 8 MB; the platform service keeps it as it is and serves it on the Coder
 * site), and the preset pictures baked into the dashboard. Each puts the
 * picture into the message as Markdown, with the fit chosen.
 */
export const PictureButton: React.FC<PictureButtonProps> = ({
	onInsert,
	onProblem,
}) => {
	const input = useRef<HTMLInputElement>(null);
	const [fit, setFit] = useState<PictureFit>("span");
	const [uploading, setUploading] = useState(false);

	const upload = async (file: File) => {
		if (file.size > MAX_BYTES) {
			onProblem("The picture must be smaller than 8 MB.");
			return;
		}
		setUploading(true);
		try {
			// As it is: no canvas, which would keep only an animated GIF's first frame.
			const picture = await PlatformAPI.uploadBannerPicture(
				file.name,
				await readAsDataUrl(file),
			);
			onInsert(pictureMarkdown(file.name, picture.url, fit));
		} catch (error) {
			onProblem(getErrorMessage(error, "The picture could not be uploaded."));
		} finally {
			setUploading(false);
		}
	};

	const FitIcon = FIT_OPTIONS[fit].icon;
	return (
		<div
			role="group"
			aria-label="Pictures"
			className="flex flex-wrap items-center gap-2"
		>
			<Select
				value={fit}
				onValueChange={(value) => {
					const next = PICTURE_FITS.find((f) => f === value);
					if (next) {
						setFit(next);
					}
				}}
			>
				<SelectTrigger
					className="h-8 w-32 text-xs"
					aria-label="Picture fit"
					title={`How a picture fills the banner's screen: ${FIT_OPTIONS[fit].hint}`}
					data-testid="announcement-picture-fit"
				>
					<span className="flex items-center gap-1.5">
						<FitIcon aria-hidden className="size-3.5" />
						<SelectValue />
					</span>
				</SelectTrigger>
				<SelectContent>
					{PICTURE_FITS.map((f) => {
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
			<Button
				size="sm"
				variant="outline"
				disabled={uploading}
				onClick={() => input.current?.click()}
				title="Upload a picture (PNG, JPEG, GIF - animated too -, WebP; up to 8 MB) and put it into the message"
			>
				{uploading ? <Spinner loading /> : <ImagePlusIcon />}
				Upload picture
			</Button>
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
			<span className="text-xs text-content-secondary">Presets:</span>
			{BANNER_PRESET_PICTURES.map((preset) => (
				<button
					key={preset.name}
					type="button"
					title={`Insert ${preset.name}`}
					aria-label={`Insert the preset picture ${preset.name}`}
					data-testid={`announcement-preset-${preset.name}`}
					onClick={() =>
						onInsert(pictureMarkdown(preset.name, preset.url, fit))
					}
					className="flex h-8 w-12 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-solid border-border bg-[#09090b] p-0.5 hover:border-content-link"
				>
					<img
						src={preset.url}
						alt=""
						className="max-h-full max-w-full object-contain"
					/>
				</button>
			))}
		</div>
	);
};
