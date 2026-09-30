"use client";

import { useEffect, useState } from "react";
import type { AdminRuntimeFeatures } from "@/lib/runtime-features";

const disabled: AdminRuntimeFeatures = { transportModuleEnabled: false };

export function useRuntimeFeatures(): AdminRuntimeFeatures {
  const [features, setFeatures] = useState<AdminRuntimeFeatures>(disabled);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/runtime-features", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : disabled)
      .then((value) => {
        if (!active) return;
        setFeatures({
          transportModuleEnabled: value?.transportModuleEnabled === true,
        });
      })
      .catch(() => {
        if (active) setFeatures(disabled);
      });
    return () => { active = false; };
  }, []);

  return features;
}
