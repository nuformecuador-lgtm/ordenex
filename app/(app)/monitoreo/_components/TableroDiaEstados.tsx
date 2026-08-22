// Feature 192 (F2.3) + Feature 258 (F2.1) — los estados de la pantalla, cada uno
// DISTINGUIBLE en el DOM por su `data-slot` (R30) y cada uno con SU icono (R24/R25).
//
// Son cosas distintas y no pueden parecer la misma:
//   - CARGANDO (skeleton): todavia no hay dato.
//   - VACIO (R33 de la 192): hay dato y dice que no hay ninguna orden asignada PARA HOY en el
//     alcance del actor. NO es un error, y por eso no se pinta como tal.
//   - FALLO DE REFRESCO (R9/R32): hay dato viejo en pantalla y la ultima re-consulta fallo. El
//     aviso acompaña a las tarjetas ya cargadas; NUNCA las sustituye ni las pone a cero.
//   - SIN COINCIDENCIAS (R42): el vacio lo produjo LO QUE ESCRIBISTE, no el dia. Texto e
//     icono distintos del de arriba, y una salida para quitar el filtro.
//
// ─── EL ICONO NUNCA ES EL UNICO PORTADOR (R29) ────────────────────────────────────────────
// Todos van `aria-hidden` (o los pinta la primitiva como decorativos) y el mensaje sigue
// siendo legible como texto con los `<svg>` suprimidos. El icono acelera el reconocimiento;
// no lo sustituye.
//
// Componentes puros, sin estado propio: quien los monta decide cual toca.

import { CalendarDays, Loader2, Search, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const CARGANDO = "Cargando el tablero del día";

// ─── FEATURE 259 (T7.1) — R23/R24/R25: el vacio dice QUE cuenta la pantalla, y ya no promete ──
// Hasta el 2026-08-21 el titulo decia «Sin órdenes asignadas hoy» y la descripcion cerraba con
// «En cuanto se asigne la primera, aparecerá aquí». Esa promesa paso a ser FALSA con el criterio
// nuevo: el tablero cuenta por el dia PARA EL QUE se asigno la orden, asi que lo que se asigne
// hoy para mañana no aparece aqui — aparece en el tablero de mañana. El texto nuevo describe lo
// que la pantalla cuenta y dice DONDE va a parar lo demas, en vez de prometer algo que no ocurre.
// Lenguaje de quien opera (R25): «para hoy», nunca el nombre de una columna ni una sigla.
const VACIO_TITULO = "Sin órdenes asignadas para hoy";
const VACIO_DESCRIPCION =
  "Ningún mensajero tiene órdenes asignadas para hoy dentro de tu alcance. El tablero muestra el trabajo de hoy: lo que se asigne para otro día aparecerá en el tablero de ese día.";

const FALLO_TITULO = "No se pudo actualizar";
const FALLO_DESCRIPCION =
  "Se siguen mostrando los últimos datos obtenidos; puede que ya no estén al día. Se reintentará solo.";

const SIN_COINCIDENCIAS_TITULO = "Ningún mensajero coincide con el filtro";
const SIN_COINCIDENCIAS_DESCRIPCION =
  "El día sí tiene órdenes asignadas: lo que no encuentra nada es el texto que escribiste.";
export const QUITAR_FILTRO = "Quitar el filtro";

/**
 * Esqueleto de carga: misma rejilla que el tablero real, para que no salte el layout.
 *
 * R28 — el icono NO sustituye el anuncio accesible: la region conserva `role="status"`,
 * `aria-busy="true"` y su nombre accesible, y el `Loader2` va dentro y `aria-hidden`.
 * `motion-safe:` deja quieta la rueda para quien pidio menos movimiento.
 */
export function TableroDiaSkeleton({ tarjetas = 6 }: Readonly<{ tarjetas?: number }>) {
  return (
    <div
      data-slot="tablero-dia-skeleton"
      role="status"
      aria-busy="true"
      aria-label={CARGANDO}
      className="flex flex-col gap-3"
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        {CARGANDO}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: tarjetas }, (_, indice) => (
          <Card key={indice} aria-hidden="true">
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * R21/R33 — vacio EXPLICITO, con la primitiva `EmptyState`. Es un estado normal del dia, no
 * un fallo: por eso no hay ningun `role="alert"` aqui.
 *
 * `CalendarDays` y no `Inbox`: lo que esta vacio es EL DIA, no una bandeja. `Inbox` —el que
 * usa el listado de ordenes— diria «esta lista no tiene resultados», que es otra cosa.
 * El icono entra por la prop `icon` (R26), de modo que la primitiva lo pinte decorativo.
 */
export function TableroDiaVacio() {
  return (
    <Card data-slot="tablero-dia-vacio">
      <CardContent>
        <EmptyState
          icon={CalendarDays}
          title={VACIO_TITULO}
          description={VACIO_DESCRIPCION}
        />
      </CardContent>
    </Card>
  );
}

/**
 * R22/R32 — el refresco fallo: se avisa SIN vaciar el tablero ni mostrar ceros.
 *
 * `TriangleAlert` y no un icono de rotura: la señal es «cuidado con lo que estas leyendo»,
 * no «se rompio». Los datos siguen ahi y pueden estar viejos.
 *
 * ⚠️ El icono va como PRIMER HIJO del `Alert` (R27): la primitiva aplica
 * `has-[>svg]:grid-cols-[auto_1fr]` y sin esa posicion la rejilla de dos columnas no se forma.
 */
export function TableroDiaAvisoRefresco() {
  return (
    <Alert data-slot="tablero-dia-aviso-refresco" variant="destructive">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{FALLO_TITULO}</AlertTitle>
      <AlertDescription>{FALLO_DESCRIPCION}</AlertDescription>
    </Alert>
  );
}

/**
 * R42 — el vacio DEL FILTRO. Distinto en texto y en `data-slot` del vacio del dia, con su
 * propio icono (`Search`: el vacio lo produjo lo que escribiste) y con una salida.
 *
 * Sin la accion, quien filtro mal se queda mirando una pantalla vacia sin saber que el dia si
 * tiene trabajo.
 */
export function TableroDiaSinCoincidencias({
  onQuitarFiltro,
}: Readonly<{ onQuitarFiltro: () => void }>) {
  return (
    <Card data-slot="tablero-dia-sin-coincidencias">
      <CardContent>
        <EmptyState
          icon={Search}
          title={SIN_COINCIDENCIAS_TITULO}
          description={SIN_COINCIDENCIAS_DESCRIPCION}
          action={
            <Button type="button" variant="outline" onClick={onQuitarFiltro}>
              {QUITAR_FILTRO}
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
