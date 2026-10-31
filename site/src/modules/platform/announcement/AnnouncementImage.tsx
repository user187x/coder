import { useAnnouncementImage } from "./useAnnouncementImage";

export const AnnouncementImage = ({
	src,
	alt,
	...props
}: {
	src: string;
	alt: string;
	className?: string;
	draggable?: boolean;
}) => {
	const image = useAnnouncementImage(src);
	return image ? <img {...props} src={image} alt={alt} /> : <span>{alt}</span>;
};
