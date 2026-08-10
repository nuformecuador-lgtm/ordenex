// Feature 192 (F2.3, R30) — bloque de TOTALES sobre las tarjetas presentadas.
//
// Usa el MISMO desglose que una tarjeta (`ContadoresTablero`), a proposito: si el total se
// pintara con su propia lista de contadores, podria quedarse sin uno y nadie lo notaria.
// Los numeros los suma el servicio (funcion pura), no este componente: aqui solo se pintan.

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TotalesTableroDia } from "@/lib/types/tablero-dia";

import { ContadoresTablero } from "./ContadoresTablero";

const TITULO = "Totales del día";
const ETIQUETA_ASIGNADAS = "Asignadas";

export function TableroDiaTotales({
  totales,
}: Readonly<{ totales: TotalesTableroDia }>) {
  return (
    <Card data-slot="tablero-dia-totales">
      <CardHeader>
        <CardTitle>{TITULO}</CardTitle>
        <CardAction>
          <div className="flex flex-col items-end" data-contador="asignadas">
            <span className="text-2xl leading-none font-semibold tabular-nums">
              {totales.asignadas}
            </span>
            <span className="text-xs text-muted-foreground">{ETIQUETA_ASIGNADAS}</span>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ContadoresTablero contadores={totales} />
      </CardContent>
    </Card>
  );
}
