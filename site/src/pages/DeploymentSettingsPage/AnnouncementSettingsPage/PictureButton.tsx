import { ImagePlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { getErrorMessage } from "#/api/errors";
import { PlatformAPI } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import { Spinner } from "#/components/Spinner/Spinner";

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

/** The Markdown for a picture: its file name (without the extension) as its description. */
export const pictureMarkdown = (fileName: string, url: string) => {
	const alt =
		fileName
			.replace(/\.[^.]+$/, "")
			.replace(/[[\]()\\*_`~!]/g, "")
			.trim()
			.slice(0, 80) || "picture";
	return `![${alt}](${url})`;
};

type PictureButtonProps = {
	/** Puts the picture's Markdown into the message, at the caret. */
	onInsert: (markdown: string) => void;
	onProblem: (problem: string) => void;
};

/**
 * Platform: General > Announcement > Insert picture. Uploads a picture (PNG, JPEG,
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
			onInsert(pictureMarkdown(file.name, picture.url));
		} catch (error) {
			onProblem(getErrorMessage(error, "The picture could not be uploaded."));
		} finally {
			setUploading(false);
		}
	};

	return (
		<>
			<Button
				size="sm"
				variant="outline"
				disabled={uploading}
				onClick={() => input.current?.click()}
				title="Upload a picture (PNG, JPEG, GIF - animated too -, WebP; up to 8 MB) and put it into the message"
			>
				{uploading ? <Spinner loading /> : <ImagePlusIcon />}
				Insert picture
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
		</>
	);
};
