import { cn } from "cn";
import { DEFAULT_LOGO_URL, usePlatformSnapshot } from "#/contexts/platformBoot";
import { getApplicationName, getLogoURL } from "#/utils/appearance";
import { ExternalImage } from "../ExternalImage/ExternalImage";

/**
 * The logo's address: the one uploaded in General > Customize, else the custom
 * logo of the deployment's appearance settings, else the default logo (brix).
 * Shared with the navbar's tile (NavbarLogo).
 */
export const useProductLogoURL = (): string => {
	const { logoURL: uploadedLogoURL, logoEnabled } = usePlatformSnapshot();
	return logoEnabled ? uploadedLogoURL || getLogoURL() || DEFAULT_LOGO_URL : "";
};

/**
 * The logo uploaded in General > Customize, else the custom logo of the
 * deployment's appearance settings, else the default logo (brix), everywhere.
 */
export const ProductLogo: React.FC<{ className?: string }> = ({
	className,
}) => {
	const applicationName = getApplicationName();
	const logoURL = useProductLogoURL();

	return logoURL ? (
		<ExternalImage
			alt={applicationName}
			src={logoURL}
			// This prevent browser to display the ugly error icon if the
			// image path is wrong or user didn't finish typing the url
			onError={(e) => {
				e.currentTarget.style.display = "none";
			}}
			onLoad={(e) => {
				e.currentTarget.style.display = "inline";
			}}
			className={cn("h-12 max-w-[200px] application-logo", className)}
		/>
	) : null;
};
