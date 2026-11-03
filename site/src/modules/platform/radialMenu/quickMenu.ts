import { useQuery } from "react-query";
import { quickMenu } from "#/api/queries/quickMenu";

export { quickMenuKey } from "#/api/queries/quickMenu";
export const useQuickMenu = () => useQuery(quickMenu());
