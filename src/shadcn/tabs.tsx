// Adapted from shadcn/ui new-york-v4 Tabs (MIT). PRISM owns the selected
// state, stable DOM IDs, manual keyboard activation, and mounted panels.
import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "./utils"

const tabsListVariants = cva("items-center text-muted-foreground", {
  variants: { variant: { default: "rounded-lg bg-muted", line: "bg-transparent" } },
  defaultVariants: { variant: "line" },
})

export const TabsList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  function TabsList({ className, ...props }, ref) {
    return <div ref={ref} data-slot="tabs-list" data-variant="line"
      className={cn(tabsListVariants(), className)} {...props} />
  }
)

export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<"button">) {
  return <button data-slot="tabs-trigger"
    className={cn(
      "relative inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent text-sm font-medium",
      "whitespace-nowrap hover:text-foreground focus-visible:border-ring disabled:opacity-50",
      className
    )}
    {...props}
  />
}
