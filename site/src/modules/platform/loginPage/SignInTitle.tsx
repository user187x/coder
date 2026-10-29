import { useQuery } from "react-query";
import { LOGIN_PAGE_DEFAULT, type LoginPageSettings } from "#/api/platform";
import { loginPage } from "#/api/queries/platform";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { ContourTitle } from "#/modules/platform/contourTitle/ContourTitle";

const SIGNED_OUT_KEY = "coder-ui-signed-out";

/** Signing out marks this tab, so the sign-in page it lands on says the sign-out message. */
export const markSignedOut = () => {
	try {
		sessionStorage.setItem(SIGNED_OUT_KEY, "1");
	} catch {
		// Not marked: the sign-in page shows its usual message.
	}
};

/** Signing in clears the mark. */
export const clearSignedOut = () => {
	try {
		sessionStorage.removeItem(SIGNED_OUT_KEY);
	} catch {
		// Nothing to clear.
	}
};

export const justSignedOut = () => {
	try {
		return sessionStorage.getItem(SIGNED_OUT_KEY) === "1";
	} catch {
		return false;
	}
};

/** The sign-in page's settings: boot.js's copy at once, the platform service's after. */
export const useLoginPageSettings = (): LoginPageSettings => {
	const query = useQuery({
		...loginPage(window.__cuiLoginPage),
		retry: false,
	});
	return { ...LOGIN_PAGE_DEFAULT, ...query.data };
};

type SignInTitleProps = {
	settings: LoginPageSettings;
	/** The deployment's name: the title when none is set. */
	applicationName: string;
	/** Right after signing out: the sign-out message instead of the sign-in one. */
	signedOut: boolean;
};

/**
 * The sign-in page's heading (where signing out lands too): the title, drawn
 * with its effect (ContourTitle), and the message set in Customize > Sign-in
 * page, the sign-out one right after signing out.
 */
export const SignInTitle: React.FC<SignInTitleProps> = ({
	settings,
	applicationName,
	signedOut,
}) => {
	const message =
		signedOut && settings.signedOutMessage
			? settings.signedOutMessage
			: settings.message;
	if (settings.headingMode === "none" && !message) return null;
	return (
		<div className="mb-8 flex flex-col items-center gap-3">
			{settings.headingMode !== "none" && (
				<h1 className="m-0 flex justify-center leading-none">
					{settings.headingMode === "image" && settings.headingImage ? (
						<ExternalImage
							src={settings.headingImage}
							alt={settings.title || applicationName}
							className="max-h-32 max-w-full object-contain"
						/>
					) : (
						<ContourTitle
							text={settings.title || applicationName}
							effect={settings.effect}
							color={settings.color}
							speed={settings.speed}
						/>
					)}
				</h1>
			)}
			{message && (
				<p
					className="m-0 max-w-sm whitespace-pre-line text-center text-sm text-content-secondary"
					data-testid="sign-in-message"
					data-kind={
						signedOut && settings.signedOutMessage ? "signed-out" : "sign-in"
					}
				>
					{message}
				</p>
			)}
		</div>
	);
};
