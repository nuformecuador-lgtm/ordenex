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
        // Feature 210 — `destructive` pintaba `text-destructive` sobre `bg-destructive/10`: el
        // MISMO color como texto y como fondo al 10%. Medido: 3.29:1 en claro y 4.43:1 en oscuro,
        // cuando AA pide 4.5. No tenía arreglo por token porque le faltaba la mitad del par: a
        // diferencia de las semánticas de abajo, `--destructive` no tiene un `-strong`.
        //
        // Así que la variante APUNTA AL PAR DE `danger`, que es la misma señal con la forma
        // correcta del repo (5.30 en claro, 5.20 en oscuro). No se le inventa un token nuevo.
        //
        // ── POR QUÉ SIGUE EXISTIENDO EL NOMBRE, y no se retiró
        // El primer intento la borró y pasó a `danger` sus dos consumidores... que eran los DOS
        // ÚNICOS que un censo textual encontraba. `typecheck` destapó NUEVE más que no escriben
        // el literal en el JSX: lo calculan desde un mapa de estados (`CuentasPorPagarTable`,
        // `SaldosTiendasTable`, `DesgloseMovimientosTienda`, `DesglosePagosMensajero`,
        // `SaldoTiendaCard`, `CuentaPorPagarCard`, `DesgloseTiendaLedger`, …). Corregir las clases
        // arregla los ONCE de una vez; retirar el nombre obligaba a tocar nueve archivos más para
        // el mismo resultado visual.
        //
        // DEUDA VIVA, dicha y no escondida: `destructive` y `danger` quedan como dos nombres del
        // mismo aspecto, que es la duplicación que la 188/R16 persigue. Unificarlos es mecánico
        // (11 sitios) y no entra aquí: esta ficha es de contraste, no de renombrado.
        //
        // `--destructive` sigue vivo y sin tocar para Button, Alert y los `aria-invalid` de
        // arriba, que no son texto sobre un tinte de sí mismos.
        destructive: "bg-danger-soft text-danger-strong dark:bg-danger/15",
        // Semánticos: fondo suave (-soft) + texto contrast-safe (-strong, >=4.5:1).
        // En dark el -soft es demasiado claro, se usa la técnica soft-badge base/15;
        // el texto -strong ya trae su variante dark vía token.
        success: "bg-success-soft text-success-strong dark:bg-success/15",
        warning: "bg-warning-soft text-warning-strong dark:bg-warning/15",
        info: "bg-info-soft text-info-strong dark:bg-info/15",
        danger: "bg-danger-soft text-danger-strong dark:bg-danger/15",
        // Feature 292 — los cuatro pares de `--chart-*`, con la MISMA forma que los semánticos
        // de arriba: `-soft` de fondo en claro, `-strong` de texto, y en oscuro el fondo se
        // compone del acento al 15 % porque ahí no hay `-soft`.
        //
        // POR QUÉ EXISTEN, y por qué se llaman así. Hay pantallas que ya pintan una serie de
        // categorías con `--chart-N` —un segmento de barra, un punto de leyenda— y necesitan un
        // chip DEL MISMO COLOR al lado. Sin par no se puede: un `--chart-N` es un color plano y
        // usarlo como texto sobre sí mismo al 10 % es exactamente el 3.29:1 que la 210 arregló.
        // El nombre es el del token para que el chip y su serie se lean como lo mismo; nombrarlas
        // por su significado («devueltas», «en reparto») metería el dominio de una pantalla dentro
        // de una primitiva, que es justo lo que no puede pasar aquí.
        //
        // Los cuatro pares cumplen AA para texto normal en los DOS temas (5.98 / 6.38 / 9.45 /
        // 8.49 en claro; 6.91 / 7.02 / 8.45 / 6.48 en oscuro) y los ata, token a token,
        // `tests/unit/guards/contraste-tokens.guardia.test.ts`.
        chart6: "bg-chart-6-soft text-chart-6-strong dark:bg-chart-6/15",
        chart11: "bg-chart-11-soft text-chart-11-strong dark:bg-chart-11/15",
        chart12: "bg-chart-12-soft text-chart-12-strong dark:bg-chart-12/15",
        chart13: "bg-chart-13-soft text-chart-13-strong dark:bg-chart-13/15",
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
