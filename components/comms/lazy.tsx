"use client";

// Code-split dialog entry points for audit communications — loaded on first open.

import dynamic from "next/dynamic";

export const NewRequestDialog = dynamic(() => import("./RequestDialogs").then((m) => m.NewRequestDialog), { loading: () => null });
export const RequestThreadDialog = dynamic(() => import("./RequestDialogs").then((m) => m.RequestThreadDialog), { loading: () => null });
