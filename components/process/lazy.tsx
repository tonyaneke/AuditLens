"use client";

// Code-split dialog entry points — modal-only code loads on first open, not with the page.

import dynamic from "next/dynamic";

export const ProcNewDialog = dynamic(() => import("./dialogs").then((m) => m.ProcNewDialog), { loading: () => null });
export const ProcFindingDialog = dynamic(() => import("./dialogs").then((m) => m.ProcFindingDialog), { loading: () => null });
export const ProcMetaDialog = dynamic(() => import("./dialogs").then((m) => m.ProcMetaDialog), { loading: () => null });
export const ProcStepDialog = dynamic(() => import("./dialogs").then((m) => m.ProcStepDialog), { loading: () => null });
export const ProposeProcessDialog = dynamic(() => import("./dialogs").then((m) => m.ProposeProcessDialog), { loading: () => null });
export const RaiseProcFindingDialog = dynamic(() => import("./dialogs").then((m) => m.RaiseProcFindingDialog), { loading: () => null });
