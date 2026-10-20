import type {
	DeploymentConfig,
	UserAppearanceSettings,
} from "#/api/typesGenerated";
import { DEFAULT_TERMINAL_FONT, terminalFonts } from "#/theme/constants";

export function getTerminalConfig(
	config: DeploymentConfig | undefined,
	appearance: UserAppearanceSettings | undefined,
	proxyPathAppURL: string | undefined,
) {
	return {
		renderer: config?.config?.web_terminal_renderer,
		baseUrl:
			process.env.NODE_ENV !== "development" ? proxyPathAppURL : undefined,
		fontFamily:
			terminalFonts[appearance?.terminal_font || DEFAULT_TERMINAL_FONT],
	};
}

/** Platform: the app a template gives in place of the web terminal (the DATAFLOW template's): Ghostty. */
export const GHOSTTY_APP = "ghostty";

/**
 * Platform: the emulator an agent's terminals use - Ghostty's (ghostty-web) where its template gives the Ghostty app
 * in place of the web terminal, or where the link asks for it (?renderer=ghostty); else the deployment's renderer.
 */
export function terminalRenderer(
	configured: string | undefined,
	agent: { apps?: readonly { slug: string }[] } | undefined,
	asked?: string | null,
): string | undefined {
	return asked === "ghostty" ||
		agent?.apps?.some((app) => app.slug === GHOSTTY_APP)
		? "ghostty"
		: configured;
}
