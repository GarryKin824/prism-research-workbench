// Adapted from shadcn/ui new-york-v4 Native Select (MIT). Keep the native
// arrow and single element so wrapping labels and compact grids still work.
import * as React from "react"
import { cn } from "./utils"

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentPropsWithoutRef<"select">>(
  function NativeSelect({ className, ...props }, ref) {
    return <select
      ref={ref}
      data-slot="native-select"
      className={cn(
        "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive disabled:opacity-50",
        className
      )}
      {...props}
    />
  }
)
