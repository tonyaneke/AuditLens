"use client";

// Code-split dialog entry points — modal-only code loads on first open, not with the page.

import dynamic from "next/dynamic";

export const DeleteUserDialog = dynamic(() => import("./dialogs").then((m) => m.DeleteUserDialog), { loading: () => null });
export const DepartmentDialog = dynamic(() => import("./dialogs").then((m) => m.DepartmentDialog), { loading: () => null });
export const ExcoRecipientDialog = dynamic(() => import("./dialogs").then((m) => m.ExcoRecipientDialog), { loading: () => null });
export const UserDialog = dynamic(() => import("./dialogs").then((m) => m.UserDialog), { loading: () => null });
