import Link from "next/link";
import { Compass } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NoEncontradoStateProps {
  /**
   * Destino de la salida. Lo calcula QUIEN monta esta pieza: el portal manda al inicio de
   * ESE rol y la pantalla pública manda a `/`. Aquí entra ya resuelto porque este componente
   * es presentación pura y no resuelve sesión.
   */
  hrefInicio: string;
  /** Etiqueta de la salida. Entra por prop para que la traducción futura no toque esto. */
  etiquetaInicio?: string;
}

/**
 * ⭑ FICHA 438 — LO QUE SE PINTA CUANDO UNA RUTA NO SE PUEDE ABRIR. Una sola pieza, montada por
 * las DOS pantallas de `not-found` del árbol (`app/(app)/not-found.tsx` y `app/not-found.tsx`).
 *
 * ── LA FRASE ES EL REQUISITO, Y ES DE SEGURIDAD, NO DE ESTILO
 *
 * «Esta página no existe, o no es para tu cuenta.» dice LAS DOS COSAS a la vez y no dice cuál.
 * Eso es deliberado y viene de la ficha 433: el acotamiento por rol de la ayuda responde
 * `notFound()` —no un 403— porque «no existe» y «no podés leerlo» tienen que ser
 * INDISTINGUIBLES. Los slugs son adivinables (`/ayuda/oficina/wallet-caja`), así que una
 * pantalla que dijera «no tenés acceso» le confirmaría a un mensajero que ese documento
 * EXISTE por el simple hecho de negárselo. La negativa sería el dato.
 *
 * Por eso esta pieza:
 *   · NO recibe ningún dato sobre el motivo —no hay prop `motivo`, `permiso` ni `existe`—, así
 *     que no TIENE con qué ramificar aunque alguien quisiera. La imposibilidad es estructural,
 *     no una promesa escrita en un comentario.
 *   · Su texto está FIJO aquí dentro y no entra por prop: dos montajes no pueden decir cosas
 *     distintas, y el 404 del portal y el de fuera se leen igual.
 *
 * Lo vigila `tests/unit/guards/no-encontrado-no-delata.guardia.test.ts`, que se pone rojo si
 * aparece vocabulario que nombre el caso («no tenés acceso», «sin permiso», «403»…) o si esta
 * interfaz gana una prop por la que el motivo pudiera entrar.
 *
 * ── Y DEJA SALIR
 *
 * Una pantalla de error sin salida es un callejón: quien llega aquí desde una URL escrita a
 * mano no tiene «atrás» útil. Por eso hay SIEMPRE un enlace de vuelta. No hay buscador ni
 * «quizás quisiste ir a…»: esto es un error, no un sitio donde quedarse.
 *
 * Reusa `EmptyState` —el vocabulario de la app para «mensaje centrado + salida», DESIGN.md—
 * con el disco del icono en neutro: aquí NO se ha roto nada (a diferencia de `ErrorState`, que
 * lo tiñe de `danger` justo para distinguir «algo falló» de «aquí no hay nada»).
 */
export function NoEncontradoState({
  hrefInicio,
  etiquetaInicio = "Ir al inicio",
}: Readonly<NoEncontradoStateProps>) {
  return (
    // `role="status"`: al llegar aquí por navegación dentro de la app (sin recarga) el
    // contenido se sustituye sin que el lector de pantalla anuncie nada, y la persona se queda
    // esperando una pantalla que ya no va a llegar. Es `status` y no `alert` a propósito: no
    // se ha roto nada, no hay urgencia que interrumpa lo que se esté leyendo.
    <div role="status">
      <EmptyState
        icon={Compass}
        title="Esta página no existe, o no es para tu cuenta."
        description="Revisá la dirección por si trae una letra de más, o volvé al inicio."
        action={
          // ⚠️ `cn(...)` Y NO `buttonVariants(...)` A PELO, y no es manía de estilo: MEDIDO en
          // el navegador el 2026-09-17, a pelo el enlace sale SIN BORDE —`border-top-color:
          // rgba(0,0,0,0)`— y con `bg-background` (#f7f8fc) sobre un fondo de página del MISMO
          // #f7f8fc, o sea que la única salida de la pantalla se lee como texto en negrita.
          // La causa: la base de `buttonVariants` trae `border border-transparent` y la variante
          // `outline` trae `border-border`; las dos sobreviven en la cadena y el transparente
          // gana en la cascada. El componente `<Button>` no lo sufre porque pasa por `cn`
          // (tailwind-merge), que colapsa el par y deja el último. Aquí no hay `<Button>`
          // —es un `<Link>`, y tiene que serlo: es navegación, no una acción—, así que el
          // `cn` hay que ponerlo a mano. Re-medido tras el arreglo: borde de 1px visible.
          <Link href={hrefInicio} className={cn(buttonVariants({ variant: "outline" }))}>
            {etiquetaInicio}
          </Link>
        }
      />
    </div>
  );
}
