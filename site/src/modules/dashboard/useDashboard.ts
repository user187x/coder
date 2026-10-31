import { useContext } from "react";
import { DashboardContext, type DashboardValue } from "./DashboardProvider";

export const useDashboard = (): DashboardValue => {
	const context = useContext(DashboardContext);

	if (!context) {
		throw new Error("useDashboard must be used within DashboardProvider");
	}

	return context;
};
