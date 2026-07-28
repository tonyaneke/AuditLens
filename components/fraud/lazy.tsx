"use client";

// Code-split dialog entry points: these dialogs only render inside a modal, so their code
// (forms, AI prompts, export builders) loads on first open instead of with the page bundle.

import dynamic from "next/dynamic";

export const FraudDialog = dynamic(() => import("./dialogs").then((m) => m.FraudDialog), { loading: () => null });
export const FraudActionDialog = dynamic(() => import("./dialogs").then((m) => m.FraudActionDialog), { loading: () => null });
export const FraudDownloadDialog = dynamic(() => import("./dialogs").then((m) => m.FraudDownloadDialog), { loading: () => null });
export const FraudPlanDialog = dynamic(() => import("./dialogs").then((m) => m.FraudPlanDialog), { loading: () => null });
export const FraudUpdateDialog = dynamic(() => import("./dialogs").then((m) => m.FraudUpdateDialog), { loading: () => null });
export const GenerateFraudRisksDialog = dynamic(() => import("./dialogs").then((m) => m.GenerateFraudRisksDialog), { loading: () => null });
