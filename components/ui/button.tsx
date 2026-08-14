import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        // Botón de marca en contorno: fondo del background, borde y texto naranja.
        // Introducido para el flujo de carga masiva; no altera `default`/`outline`.
        "brand-outline":
          "border-brand bg-background text-brand hover:bg-brand-soft hover:text-brand-dark aria-expanded:bg-brand-soft aria-expanded:text-brand-dark focus-visible:border-brand focus-visible:ring-brand/30 dark:bg-transparent dark:text-brand-light dark:hover:bg-brand/15 dark:hover:text-brand-light",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        // Feature 222 — el par de este botón NO puede salir de `--destructive`, y aquí está el
        // porqué con los números medidos (`tests/fixtures/contraste.ts`, aritmética validada
        // contra razones publicadas de WCAG; guardia en `contraste-tokens.guardia.test.ts`).
        //
        // Pintaba `text-destructive` sobre `bg-destructive/10`: el MISMO color como texto y como
        // fondo a un 10 %. Medido sobre la tarjeta — 3.29 en claro y 4.43 en oscuro, cuando AA
        // para texto normal pide 4.5. Bajo umbral en los DOS temas, y con el cursor encima
        // todavía peor, porque el fondo se hunde hacia la propia tinta: 2.90 y 3.68.
        //
        // Se sigue el precedente de la feature 210, que resolvió ESTE MISMO par para el `Badge`
        // (`badge.tsx`): `--destructive` no tiene un `-strong` —a diferencia de las semánticas de
        // al lado— así que no había arreglo por token, y la variante pasa al par de `danger`, que
        // sí lo tiene. No se inventa un token nuevo ni se toca `--destructive`, del que dependen
        // `Alert` y los `aria-invalid` de media app (los de la clase base, aquí arriba).
        //
        // ── EL HOVER ES OPACO A PROPÓSITO, y no un tinte más hondo
        // Una capa `hover:bg-danger/20` mide 4.99 sobre la tarjeta pero 4.44 sobre `secondary` y
        // 4.44 sobre el `muted` oscuro: un fondo con alfa vale lo que valga la superficie que
        // tenga debajo, y el botón no sabe dónde lo montan. `--danger-strong` opaco NO depende de
        // ella: 6.47 en claro y 5.89 en oscuro, en cualquier sitio. `text-card` acompaña al vuelco
        // porque gira con el tema igual que el fondo (blanco sobre rojo oscuro en claro; azul
        // oscuro sobre rojo claro en oscuro), así que un solo par de clases sirve para los dos.
        //
        // `dark:hover:bg-danger-strong` repite al `hover:` de arriba por especificidad, no por
        // gusto: `dark:bg-danger/15` empata con `hover:bg-danger-strong` (dos clases cada una) y
        // el desempate sería el orden del CSS compilado. Escrito así, gana siempre el hover.
        //
        // El borde y el anillo de foco SIGUEN en `--destructive`: son indicadores no textuales
        // (WCAG 1.4.11), no caen bajo el 1.4.3 que esta ficha viene a cumplir, y son los mismos
        // que la clase base usa para `aria-invalid`. Cambiarlos sería otra decisión, sin medición
        // que la respalde en esta ficha.
        //
        // DEUDA VIVA, la misma que dejó dicha la 210 y que esta ficha NO cierra: `destructive` y
        // `danger` quedan como dos nombres del mismo aspecto (en claro `--destructive` y
        // `--color-danger` son el mismo hex; en oscuro `--destructive` y `--danger-strong` lo
        // son). Unificarlos es limpieza de paleta, no contraste.
        destructive:
          "bg-danger-soft text-danger-strong hover:bg-danger-strong hover:text-card focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-danger/15 dark:hover:bg-danger-strong dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * Acción async en curso. Antepone un spinner al contenido, fuerza `disabled`
     * (anti-doble-envío) y expone `aria-busy` para lectores de pantalla. El giro
     * respeta `prefers-reduced-motion` (se detiene) sin perder el estado disabled.
     */
    loading?: boolean
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <Loader2
          className="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
