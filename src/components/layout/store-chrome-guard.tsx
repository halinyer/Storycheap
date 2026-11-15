"use client";

import React, { Suspense } from "react";
import { usePathname } from "next/navigation";

function StoreChromeInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) {
    return null;
  }
  return <>{children}</>;
}

export function StoreChromeGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <StoreChromeInner>{children}</StoreChromeInner>
    </Suspense>
  );
}
