import {
	ChevronDownIcon,
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { Spinner } from "#/components/Spinner/Spinner";

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
 * Platform: General > Announcement > Insert picture > Center, Span, Tile,
 * Fill or Stretch (how it fills the banner's screen). Uploads a picture (PNG, JPEG,
 * GIF - animated too -, WebP or AVIF, up to 8 MB) to the platform service,
 * which keeps it as it is and serves it on the Coder site, and puts it into
 * the message as Markdown. A large one rolls through the banner's screen; a
 * small one sits in the line.
 */
export const PictureButton: React.FC<PictureButtonProps> = ({
	onInsert,
	onProblem,
}) => {
	const input = useRef<HTMLInputElement>(null);
	const fit = useRef<PictureFit>("span");
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
			onInsert(pictureMarkdown(file.name, picture.url, fit.current));
		} catch (error) {
			onProblem(getErrorMessage(error, "The picture could not be uploaded."));
		} finally {
			setUploading(false);
		}
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="sm"
						variant="outline"
						disabled={uploading}
						title="Upload a picture (PNG, JPEG, GIF - animated too -, WebP; up to 8 MB) and put it into the message"
					>
						{uploading ? <Spinner loading /> : <ImagePlusIcon />}
						Insert picture
						<ChevronDownIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-72">
					<DropdownMenuLabel>
						How it fills the banner's screen
					</DropdownMenuLabel>
					{PICTURE_FITS.map((f) => {
						const { label, hint, icon: Icon } = FIT_OPTIONS[f];
						return (
							<DropdownMenuItem
								key={f}
								data-testid={`announcement-picture-${f}`}
								onSelect={() => {
									fit.current = f;
									input.current?.click();
								}}
							>
								<Icon aria-hidden />
								<span className="flex flex-col">
									<span>{label}</span>
									<span className="text-xs text-content-secondary">{hint}</span>
								</span>
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
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
		</>
	);
};
