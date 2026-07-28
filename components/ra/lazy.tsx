"use client";

// Code-split dialog entry points — modal-only code loads on first open, not with the page.

import dynamic from "next/dynamic";

export const RaUnitDialog = dynamic(() => import("./dialogs").then((m) => m.RaUnitDialog), { loading: () => null });
export const GeneratePlanDialog = dynamic(() => import("./dialogs").then((m) => m.GeneratePlanDialog), { loading: () => null });
export const GenerateUniverseDialog = dynamic(() => import("./dialogs").then((m) => m.GenerateUniverseDialog), { loading: () => null });
export const NewPlanDialog = dynamic(() => import("./dialogs").then((m) => m.NewPlanDialog), { loading: () => null });
export const RaDownloadDialog = dynamic(() => import("./dialogs").then((m) => m.RaDownloadDialog), { loading: () => null });
