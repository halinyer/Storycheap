import React from "react";
import { cn } from "@/lib/utils";

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-xl bg-slate-800/40 relative overflow-hidden skeleton-shimmer",
        className
      )}
      {...props}
    />
  );
}
