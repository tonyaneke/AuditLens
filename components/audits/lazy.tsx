"use client";

// Code-split dialog entry points — modal-only code loads on first open, not with the page.

import dynamic from "next/dynamic";

export const ModalAuditDialog = dynamic(() => import("./dialogs").then((m) => m.ModalAuditDialog), { loading: () => null });
export const ModalReportDialog = dynamic(() => import("./dialogs").then((m) => m.ModalReportDialog), { loading: () => null });
export const ModalTestDialog = dynamic(() => import("./dialogs").then((m) => m.ModalTestDialog), { loading: () => null });
export const ModalTORDialog = dynamic(() => import("./dialogs").then((m) => m.ModalTORDialog), { loading: () => null });
export const ModalFrontMatterDialog = dynamic(() => import("./dialogs").then((m) => m.ModalFrontMatterDialog), { loading: () => null });
