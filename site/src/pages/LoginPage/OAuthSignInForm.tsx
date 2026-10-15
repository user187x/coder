import { KeyIcon } from "lucide-react";
import type { AuthMethods } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";

type OAuthSignInFormProps = {
	isSigningIn: boolean;
	redirectTo: string;
	authMethods?: AuthMethods;
};

/**
 * Platform: the OIDC provider (Keycloak) as one large icon, centered. Everyone
 * knows what it is for, so its sign-in text is not shown: it is the button's
 * accessible name only.
 */
export const OAuthSignInForm: React.FC<OAuthSignInFormProps> = ({
	isSigningIn,
	redirectTo,
	authMethods,
}) => {
	return (
		<div className="flex justify-center">
			{authMethods?.oidc.enabled && (
				<Button
					variant="outline"
					asChild
					className="size-20 rounded-xl p-3 [&>img]:size-12 [&>svg]:size-10"
					disabled={isSigningIn}
					type="submit"
				>
					<a
						href={`/api/v2/users/oidc/callback?redirect=${encodeURIComponent(
							redirectTo,
						)}`}
						aria-label={authMethods.oidc.signInText || "OpenID Connect"}
						data-testid="oidc-sign-in"
					>
						{authMethods.oidc.iconUrl ? (
							<ExternalImage alt="" src={authMethods.oidc.iconUrl} />
						) : (
							<KeyIcon aria-hidden />
						)}
					</a>
				</Button>
			)}
		</div>
	);
};
