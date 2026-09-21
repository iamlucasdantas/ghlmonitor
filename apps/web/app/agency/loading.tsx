import { Skeleton } from '@/components/ui/primitives';

/** RF-05: skeletons on every card, so the panel never flashes an empty state. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-96" />
    </div>
  );
}
