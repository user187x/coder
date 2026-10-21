import { cn } from "cn";
import { useState } from "react";
import { NavLink } from "react-router";
import { Avatar } from "#/components/Avatar/Avatar";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { useProductLogoURL } from "#/components/Icons/ProductLogo";
import { getApplicationName } from "#/utils/appearance";

/**
 * The trigger round each of the top bar's square tiles - the user menu's avatar (UserDropdown) and the logo
 * (NavbarLogo) - so both look and behave alike: no box of its own, the tile (an Avatar of size lg) is what shows.
 */
export const navbarTileTriggerClass =
	"relative inline-flex bg-transparent border-0 cursor-pointer p-0";

/** The canvas the logo's corners are read from: the picture drawn at most this many pixels a side. */
const SAMPLE_PX = 64;

/** A corner whose alpha is below this shows what is behind the picture. */
const OPAQUE_ALPHA = 250;

/**
 * Whether a loaded picture's background shows through: any of its four corner pixels less than opaque. A picture
 * that cannot be read (a canvas tainted by another origin, no 2D context) counts as opaque.
 */
export const hasTransparentCorners = (image: HTMLImageElement): boolean => {
	try {
		const width = Math.min(image.naturalWidth || SAMPLE_PX, SAMPLE_PX);
		const height = Math.min(image.naturalHeight || SAMPLE_PX, SAMPLE_PX);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) {
			return false;
		}
		context.drawImage(image, 0, 0, width, height);
		const corners: [number, number][] = [
			[0, 0],
			[width - 1, 0],
			[0, height - 1],
			[width - 1, height - 1],
		];
		return corners.some(
			([x, y]) => context.getImageData(x, y, 1, 1).data[3] < OPAQUE_ALPHA,
		);
	} catch {
		return false;
	}
};

/**
 * Platform: the top bar's logo, in the same tile as the user's avatar (the bordered, rounded square). A logo with an
 * opaque background (a flag, a photo) fills it as a squircle - cropped square, its corners rounded like the tile's;
 * one whose background is transparent (a PNG, SVG or GIF with alpha) is shown whole, as it is. Which it is comes from
 * its corner pixels, read once it has loaded. It links to the workspaces, as the bare logo did.
 */
export const NavbarLogo: React.FC = () => {
	const logoURL = useProductLogoURL();
	// The picture last read, and what its corners said: a new logo is read again.
	const [sampled, setSampled] = useState<{
		src: string;
		transparent: boolean;
	}>();
	const transparent =
		sampled?.src === logoURL ? sampled.transparent : undefined;
	const shape =
		transparent === undefined
			? "pending"
			: transparent
				? "transparent"
				: "opaque";

	return (
		<NavLink
			to="/workspaces"
			className={navbarTileTriggerClass}
			data-testid="navbar-logo"
		>
			<Avatar
				size="lg"
				className="p-0.5"
				data-testid="navbar-logo-tile"
				data-logo-shape={shape}
			>
				<ExternalImage
					alt={getApplicationName()}
					src={logoURL}
					// No broken-picture icon for a logo that cannot be loaded: the tile stays, empty.
					onError={(e) => {
						e.currentTarget.style.display = "none";
					}}
					onLoad={(e) => {
						e.currentTarget.style.display = "";
						setSampled({
							src: logoURL,
							transparent: hasTransparentCorners(e.currentTarget),
						});
					}}
					className={cn(
						"application-logo size-full",
						shape === "opaque"
							? "rounded-[6px] object-cover"
							: "object-contain",
					)}
				/>
			</Avatar>
		</NavLink>
	);
};
