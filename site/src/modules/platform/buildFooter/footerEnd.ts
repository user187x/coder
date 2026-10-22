import { createContext } from "react";

/**
 * Platform: what the workspace card puts at the far right of its Build timeline footer (BuildFooterBar) - its Uptime
 * pill; the footer is made by the page (WorkspaceTimings), the card gives this.
 */
export const BuildFooterEnd = createContext<React.ReactNode>(null);
