import { Loader2 } from "lucide-react";

export default function PreviewLoading() {
  return (
    <div className="flex h-screen w-screen flex-col bg-white">
      {/* Mock Header Skeleton */}
      <div className="flex h-14 items-center justify-between border-b border-gray-100 px-4 shadow-sm animate-pulse">
        <div className="h-6 w-32 rounded bg-gray-200" />
        <div className="flex gap-4">
          <div className="h-5 w-16 rounded bg-gray-200" />
          <div className="h-5 w-16 rounded bg-gray-200" />
          <div className="h-5 w-16 rounded bg-gray-200" />
        </div>
      </div>

      {/* Main Content Skeleton */}
      <div className="flex flex-1 p-8 gap-8 animate-pulse">
        {/* Left column (hero/text mockup) */}
        <div className="flex w-1/2 flex-col justify-center gap-6">
          <div className="h-12 w-3/4 rounded-lg bg-gray-200" />
          <div className="h-6 w-full rounded bg-gray-100" />
          <div className="h-6 w-5/6 rounded bg-gray-100" />
          <div className="h-6 w-2/3 rounded bg-gray-100" />
          
          <div className="mt-4 flex gap-4">
            <div className="h-10 w-32 rounded-full bg-gray-300" />
            <div className="h-10 w-32 rounded-full bg-gray-200" />
          </div>
        </div>

        {/* Right column (image/card mockup) */}
        <div className="flex w-1/2 items-center justify-center">
          <div className="flex h-full max-h-[500px] w-full items-center justify-center rounded-2xl bg-gray-100 border border-gray-200">
            <Loader2 className="h-10 w-10 animate-spin text-gray-300" />
          </div>
        </div>
      </div>
    </div>
  );
}
