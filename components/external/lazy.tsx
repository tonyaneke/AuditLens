"use client";

// Code-split dialog entry points — modal-only code loads on first open, not with the page.

import dynamic from "next/dynamic";

export const ExtAssignDialog = dynamic(() => import("./dialogs").then((m) => m.ExtAssignDialog), { loading: () => null });
export const ExtEditDialog = dynamic(() => import("./dialogs").then((m) => m.ExtEditDialog), { loading: () => null });
export const ExtCommentaryDialog = dynamic(() => import("./dialogs").then((m) => m.ExtCommentaryDialog), { loading: () => null });
export const ExtImportDialog = dynamic(() => import("./dialogs").then((m) => m.ExtImportDialog), { loading: () => null });
export const ExtRaiseDialog = dynamic(() => import("./dialogs").then((m) => m.ExtRaiseDialog), { loading: () => null });
