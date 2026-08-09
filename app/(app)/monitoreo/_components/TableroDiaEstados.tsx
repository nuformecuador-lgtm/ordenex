// Feature 192 (F2.3) — los estados de la pantalla, cada uno DISTINGUIBLE en el DOM.
//
// Son tres cosas distintas y no pueden parecer la misma:
//   - CARGANDO (skeleton): todavia no hay dato.
//   - VACIO (R33): hay dato y dice que hoy no hay ninguna orden asignada en el alcance del
//     actor. NO es un error, y por eso no se pinta como tal.
//   - FALLO DE REFRESCO (R32): hay dato viejo en pantalla y la ultima re-consulta fallo. El
//     aviso acompaña a las tarjetas ya cargadas; NUNCA las sustituye ni las pone a cero.
//
// Componentes puros, sin estado propio: quien los monta decide cual toca.

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const CARGANDO = "Cargando el tablero del día";

const VACIO_TITULO = "Sin órdenes asignadas hoy";
const VACIO_DESCRIPCION =
  "Ningún mensajero tiene órdenes asignadas hoy dentro de tu alcance. En cuanto se asigne la primera, aparecerá aquí.";

const FALLO_TITULO = "No se pudo actualizar";
const FALLO_DESCRIPCION =
  "Se siguen mostrando los últimos datos obtenidos; puede que ya no estén al día. Se reintentará solo.";

/** Esqueleto de carga: misma rejilla que el tablero real, para que no salte el layout. */
export function TableroDiaSkeleton({ tarjetas = 6 }: Readonly<{ tarjetas?: number }>) {
  return (
    <div
      data-slot="tablero-dia-skeleton"
      role="status"
      aria-busy="true"
      aria-label={CARGANDO}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
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
  );
}

/** R33 — vacio EXPLICITO. Es un estado normal del dia, no un fallo. */
export function TableroDiaVacio() {
  return (
    <Card data-slot="tablero-dia-vacio">
      <CardHeader>
        <p className="font-heading text-base">{VACIO_TITULO}</p>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{VACIO_DESCRIPCION}</p>
      </CardContent>
    </Card>
  );
}

/** R32 — el refresco fallo: se avisa SIN vaciar el tablero ni mostrar ceros. */
export function TableroDiaAvisoRefresco() {
  return (
    <Alert data-slot="tablero-dia-aviso-refresco" variant="destructive">
      <AlertTitle>{FALLO_TITULO}</AlertTitle>
      <AlertDescription>{FALLO_DESCRIPCION}</AlertDescription>
    </Alert>
  );
}
