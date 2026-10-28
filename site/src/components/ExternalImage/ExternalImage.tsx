import { LiveLava } from "#/modules/platform/lava/LiveLava";
import { useLavaImage } from "#/modules/platform/lava/useLavaImage";
import { useAppearance } from "#/theme/appearance";
import { getExternalImageStylesFromUrl } from "#/theme/externalImages";

export const ExternalImage: React.FC<React.ComponentProps<"img">> = ({
	style,
	alt = "",
	...props
}) => {
	const { externalImages } = useAppearance();
	// Platform: a lava picture is drawn live, each copy its own.
	const lava = useLavaImage(props.src);
	if (lava) {
		return (
			<LiveLava
				settings={lava}
				alt={alt}
				className={props.className}
				style={style}
			/>
		);
	}

	return (
		<img
			alt={alt}
			style={{
				...getExternalImageStylesFromUrl(externalImages, props.src),
				...style,
			}}
			{...props}
		/>
	);
};
