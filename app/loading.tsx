import { BuiCard, BuiSkeleton } from "@/components/boardui/Card";

export default function Loading() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-5xl items-center justify-center px-4 py-10">
      <div className="w-full max-w-md" role="status" aria-live="polite" aria-label="Loading page">
        <BuiCard className="p-5">
          <div className="space-y-4">
            <BuiSkeleton className="h-3 w-28" />
            <BuiSkeleton className="h-8 w-3/4" />
            <div className="space-y-2">
              <BuiSkeleton className="h-4" />
              <BuiSkeleton className="h-4 w-2/3" />
            </div>
          </div>
        </BuiCard>
      </div>
    </div>
  );
}
