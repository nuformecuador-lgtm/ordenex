"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PremioRankingDTO, RankingRowDTO } from "@/lib/types/ranking";

import { PremioInputRow } from "./PremioInputRow";
import { PREMIOS_LABELS, RANKING_LABELS } from "./ranking-labels";

// Feature 76 (T9) — módulo cliente de los PREMIOS del ranking DIARIO. Recibe los datos YA
// serializados (STRING) + `esEditable` por props desde el Server Component `page.tsx` (que
// validó rol y pre-fetch; patrón /wallet). El cliente NUNCA recibe Prisma.Decimal ni
// recalcula montos/porcentajes.
//
// La PRESENTACIÓN del ranking (R13/R6/R3) ya no vive aquí: la resuelve `RankingPodio`
// (podio visual + lista). Este módulo conserva solo la tabla de premios del podio
// (R8/R14/R15): una fila por posición 1-3, asociando el premio al mensajero elegible de
// esa posición (o "sin ocupante" si no hay, R15). Sigue recibiendo `ranking` porque de ahí
// sale el ocupante de cada posición. Editable solo si `esEditable` (maestro, R16); el
// mensajero ve solo-lectura (R17).

export interface RankingModuleProps {
  ranking: RankingRowDTO[];
  premios: PremioRankingDTO[];
  esEditable: boolean;
}

export function RankingModule({ ranking, premios, esEditable }: RankingModuleProps) {
  // Premios ordenados por posición ascendente (1, 2, 3) para presentación estable.
  const premiosOrdenados = [...premios].sort((a, b) => a.posicion - b.posicion);

  // Ocupante ELEGIBLE de cada posición del podio (R14): la fila del ranking cuyo
  // `posicion` coincide. Si no existe, `null` → NO se inventa ocupante (R15).
  function ocupanteDe(posicion: number): string | null {
    const fila = ranking.find((r) => r.posicion === posicion);
    return fila ? fila.nombre : null;
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{PREMIOS_LABELS.titulo}</CardTitle>
          <CardDescription>{PREMIOS_LABELS.descripcion}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full max-w-full overflow-x-auto">
            <table
              aria-label={RANKING_LABELS.premiosAria}
              className="w-full border-collapse text-left text-sm"
            >
              <thead>
                <tr className="border-b">
                  <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                    {PREMIOS_LABELS.posicion}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                    {PREMIOS_LABELS.ocupante}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                    {PREMIOS_LABELS.monto}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                    {PREMIOS_LABELS.descripcionPremio}
                  </th>
                  {esEditable ? (
                    <th
                      scope="col"
                      className="px-3 py-2 font-medium text-muted-foreground"
                    >
                      {PREMIOS_LABELS.acciones}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {premiosOrdenados.map((premio) => (
                  <PremioInputRow
                    key={premio.posicion}
                    premio={premio}
                    ocupanteNombre={ocupanteDe(premio.posicion)}
                    esEditable={esEditable}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
