import { DownloadIcon } from "lucide-react";
import { ImagesAPI } from "#/api/images";
import { Button } from "#/components/Button/Button";

export const ImageDownloadButton: React.FC<{
	imageRef: string;
	name?: string;
	exportLabel?: boolean;
}> = ({ imageRef, name = imageRef, exportLabel = false }) => (
	<Button
		asChild
		variant="outline"
		size={exportLabel ? "sm" : "icon"}
		title="Download (docker load)"
	>
		<a
			href={ImagesAPI.downloadRefUrl(imageRef)}
			download
			aria-label={`${exportLabel ? "Export" : "Download"} ${name}`}
			onClick={(event) => event.stopPropagation()}
		>
			<DownloadIcon aria-hidden />
			{exportLabel && "Export"}
		</a>
	</Button>
);
