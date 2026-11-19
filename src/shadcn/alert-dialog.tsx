// Adapted from shadcn/ui new-york-v4 Alert Dialog (MIT). Native dialog keeps
// the top layer and escape behavior without injecting scroll styles into body.
import * as React from "react"
import { createPortal } from "react-dom"
import { Button } from "./button"
import { cn } from "./utils"

export function AlertDialogContent({
  className, ...props
}: React.ComponentPropsWithoutRef<"dialog">) {
  const anchor = React.useRef<HTMLSpanElement>(null)
  const dialog = React.useRef<HTMLDialogElement>(null)
  const [container, setContainer] = React.useState<Element | null | undefined>()

  React.useLayoutEffect(() => {
    setContainer(typeof createPortal === "function"
      ? anchor.current?.closest(".prism-shell")?.querySelector("[data-prism-portal]") ?? null
      : null)
  }, [])
  React.useLayoutEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [container])

  const content = container === undefined ? null : <dialog
    ref={dialog}
    data-slot="alert-dialog-content"
    className={cn("rounded-lg border border-border bg-background p-6 shadow-lg", className)}
    {...props}
  />

  return <React.Fragment>
    <span ref={anchor} hidden />
    {container && content ? createPortal(content, container) : content}
  </React.Fragment>
}

export function AlertDialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<"h2">) {
  return <h2 data-slot="alert-dialog-title" className={cn("text-lg font-semibold", className)} {...props} />
}

export function AlertDialogDescription({ className, ...props }: React.ComponentPropsWithoutRef<"p">) {
  return <p data-slot="alert-dialog-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export function AlertDialogCancel(props: React.ComponentPropsWithoutRef<"button">) {
  return <Button variant="outline" data-slot="alert-dialog-cancel" {...props} />
}

export function AlertDialogAction(props: React.ComponentPropsWithoutRef<"button">) {
  return <Button variant="destructive" data-slot="alert-dialog-action" {...props} />
}
