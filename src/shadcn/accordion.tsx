// Adapted from shadcn/ui new-york-v4 Accordion (MIT). The native details
// element preserves Find in page, keyboard disclosure and mounted children.
import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "./utils"

export const AccordionItem = React.forwardRef<HTMLDetailsElement, React.ComponentPropsWithoutRef<"details">>(
  function AccordionItem({ className, ...props }, ref) {
    return <details ref={ref} data-slot="accordion-item" className={cn(className)} {...props} />
  }
)

export const AccordionTrigger = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<"summary">>(
  function AccordionTrigger({ className, children, ...props }, ref) {
    return <summary
      ref={ref}
      data-slot="accordion-trigger"
      className={cn("items-center gap-2 rounded-md text-left font-medium focus-visible:outline-ring", className)}
      {...props}
    >
      <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground"
        data-prism-disclosure-icon aria-hidden="true" />
      {children}
    </summary>
  }
)
