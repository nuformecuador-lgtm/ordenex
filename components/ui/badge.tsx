import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        // Feature 210: la variante `destructive` que traía shadcn SE RETIRA. Pintaba
        // `text-destructive` sobre `bg-destructive/10`, es decir el MISMO color como texto y como
        // fondo al 10%: medido, 3.29:1 en claro y 4.43:1 en oscuro, cuando AA pide 4.5. No tenía
        // arreglo por token porque le faltaba la mitad del par: a diferencia de las semánticas de
        // abajo, `destructive` no tiene un `-strong` con el que contrastar.
        //
        // No se le inventa un par: `danger` YA es esa misma señal con la forma correcta (5.30 en
        // claro, 5.20 en oscuro). Dos variantes para un mismo significado son la duplicación que
        // la 188/R16 persigue, así que queda una. Sus dos únicos consumidores —el badge «Anulado»
        // de los pagos y el «Rechazado» del histórico— pasan a `danger`.
        //
        // Si alguien escribe `variant="destructive"` en un Badge, el compilador lo manda aquí.
        // `--destructive` sigue vivo para Button, Alert y los `aria-invalid` de arriba, que no son
        // texto sobre un tinte de sí mismos.
        //
        // Semánticos: fondo suave (-soft) + texto contrast-safe (-strong, >=4.5:1).
        // En dark el -soft es demasiado claro, se usa la técnica soft-badge base/15;
        // el texto -strong ya trae su variante dark vía token.
        success: "bg-success-soft text-success-strong dark:bg-success/15",
        warning: "bg-warning-soft text-warning-strong dark:bg-warning/15",
        info: "bg-info-soft text-info-strong dark:bg-info/15",
        danger: "bg-danger-soft text-danger-strong dark:bg-danger/15",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
