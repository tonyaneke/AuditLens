"use client";

// Code-split dialog entry points — modal-only code loads on first open, not with the page.

import dynamic from "next/dynamic";

export const ModalAuditDialog = dynamic(() => import("./dialogs").then((m) => m.ModalAuditDialog), { loading: () => null });
export const ModalReportDialog = dynamic(() => import("./dialogs").then((m) => m.ModalReportDialog), { loading: () => null });
export const ModalTestDialog = dynamic(() => import("./dialogs").then((m) => m.ModalTestDialog), { loading: () => null });
export const ModalTORDialog = dynamic(() => import("./dialogs").then((m) => m.ModalTORDialog), { loading: () => null });
export const ModalFrontMatterDialog = dynamic(() => import("./dialogs").then((m) => m.ModalFrontMatterDialog), { loading: () => null });
export const ModalPlanPromptDialog = dynamic(() => import("./dialogs").then((m) => m.ModalPlanPromptDialog), { loading: () => null });
export const ModalEditPlanDialog = dynamic(() => import("./dialogs").then((m) => m.ModalEditPlanDialog), { loading: () => null });
export const ModalRaiseExceptionDialog = dynamic(() => import("./dialogs").then((m) => m.ModalRaiseExceptionDialog), { loading: () => null });
export const ModalGenerateObsDialog = dynamic(() => import("./dialogs").then((m) => m.ModalGenerateObsDialog), { loading: () => null });
export const ModalExecPromptDialog = dynamic(() => import("./dialogs").then((m) => m.ModalExecPromptDialog), { loading: () => null });
export const ModalScanRepeatsDialog = dynamic(() => import("./dialogs").then((m) => m.ModalScanRepeatsDialog), { loading: () => null });
export const ModalSopBulkDialog = dynamic(() => import("./dialogs").then((m) => m.ModalSopBulkDialog), { loading: () => null });
export const ModalBulkImportDialog = dynamic(() => import("./dialogs").then((m) => m.ModalBulkImportDialog), { loading: () => null });
export const ModalReassignObsDialog = dynamic(() => import("./dialogs").then((m) => m.ModalReassignObsDialog), { loading: () => null });
