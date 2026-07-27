"use client";

// Small hook over the module-level directory cache (lib/client/directory) — loads once and
// re-renders the consumer when the roster arrives.

import { useEffect, useState } from "react";
import { directory, loadDirectory, type DirectoryUser } from "@/lib/client/directory";

export function useDirectoryUsers(): DirectoryUser[] {
  const [users, setUsers] = useState<DirectoryUser[]>(() => directory());
  useEffect(() => {
    let on = true;
    void loadDirectory().then((u) => {
      if (on) setUsers(u);
    });
    return () => {
      on = false;
    };
  }, []);
  return users;
}
