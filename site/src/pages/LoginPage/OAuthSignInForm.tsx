import { cn } from "cn";
import { KeyIcon } from "lucide-react";
import type { AuthMethods } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";

type OAuthSignInFormProps = {
	isSigningIn: boolean;
	redirectTo: string;
	authMethods?: AuthMethods;
};

/** Platform: the Keycloak logo the sign-in page shows as Keycloak's button (site/static). */
const KEYCLOAK_LOGO = "/keycloak-sign-in.png";

/** The provider is Keycloak: its icon (the chart's oidc.iconUrl) is Keycloak's. */
const isKeycloak = (iconUrl: string) => /\/keycloak\.(svg|png)$/i.test(iconUrl);

/**
 * Platform: the OIDC provider as one large button, centered. Keycloak's is its
 * logo; any other provider's, its icon on a large square. Everyone knows what
 * it is for, so its sign-in text is not shown: it is the button's accessible
 * name only.
 */
export const OAuthSignInForm: React.FC<OAuthSignInFormProps> = ({
	isSigningIn,
	redirectTo,
	authMethods,
}) => {
	if (!authMethods?.oidc.enabled) {
		return null;
	}
	const href = `/api/v2/users/oidc/callback?redirect=${encodeURIComponent(
		redirectTo,
	)}`;
	const label = authMethods.oidc.signInText || "OpenID Connect";
	const { iconUrl } = authMethods.oidc;

	if (isKeycloak(iconUrl)) {
		return (
			<div className="flex justify-center">
				<a
					href={href}
					aria-label={label}
					aria-disabled={isSigningIn || undefined}
					data-testid="oidc-sign-in"
					className={cn(
						"block rounded-lg p-1 outline-none",
						"transition-[filter,transform] duration-150 hover:scale-[1.03] hover:brightness-110",
						"focus-visible:ring-2 focus-visible:ring-content-link",
						isSigningIn && "pointer-events-none opacity-60",
					)}
				>
					<img
						src={KEYCLOAK_LOGO}
						alt=""
						width={200}
						height={128}
						draggable={false}
						className="block h-auto w-[200px]"
					/>
				</a>
			</div>
		);
	}

	return (
		<div className="flex justify-center">
			<Button
				variant="outline"
				asChild
				className="size-20 rounded-xl p-3"
				disabled={isSigningIn}
				type="submit"
			>
				<a href={href} aria-label={label} data-testid="oidc-sign-in">
					{iconUrl ? (
						// The button's own icon size (size-icon-lg) is for icons beside text.
						<ExternalImage alt="" src={iconUrl} className="size-12!" />
					) : (
						<KeyIcon aria-hidden className="size-10!" />
					)}
				</a>
			</Button>
		</div>
	);
};
