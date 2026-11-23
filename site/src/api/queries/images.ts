export const imagesKey = ["platform", "images"] as const;
export const imagesInUseKey = [...imagesKey, "in-use"] as const;
export const dependencyImagesKey = [...imagesKey, "dependencies"] as const;
export const trivyScannerKey = [...imagesKey, "settings", "trivy"] as const;
export const securityDataKey = [...imagesKey, "security-data"] as const;
