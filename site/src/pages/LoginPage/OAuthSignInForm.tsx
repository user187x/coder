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
			<Button asChild size="lg" className="w-full" disabled={isSigningIn}>
				<a
					href={isSigningIn ? undefined : href}
					aria-label={label}
					aria-disabled={isSigningIn || undefined}
					data-testid="oidc-sign-in"
				>
					<img
						src={KEYCLOAK_LOGO}
						alt=""
						draggable={false}
						className="h-7! w-auto! max-w-full object-contain p-0!"
					/>
				</a>
			</Button>
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
