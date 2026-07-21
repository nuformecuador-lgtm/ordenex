"use client";

import { Trophy } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/DataTable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PremioRankingDTO, RankingRowDTO } from "@/lib/types/ranking";

import { PremioInputRow } from "./PremioInputRow";
import {
  PREMIOS_LABELS,
  RANKING_COLUMNAS,
  RANKING_LABELS,
  SIN_DATO,
  conteoCrudo,
  porcentaje,
} from "./ranking-labels";

// Columnas de la tabla del ranking (R13/R6): posición, nombre, % del día y conteo crudo
// (entregadas/asignadas). El ORDEN de las filas ya viene resuelto del servidor (R4/R5); la
// tabla solo presenta. Vive fuera del componente porque no depende de props ni de estado.
const RANKING_COLUMNS: Column<RankingRowDTO>[] = [
  {
    id: "posicion",
    value: RANKING_COLUMNAS.posicion,
    render: (fila) => (
      <span className="font-medium">{fila.posicion ?? SIN_DATO}</span>
    ),
  },
  { id: "nombre", value: RANKING_COLUMNAS.mensajero, render: (fila) => fila.nombre },
  {
    id: "porcentaje",
    value: RANKING_COLUMNAS.porcentaje,
    render: (fila) => porcentaje(fila.pct),
  },
  {
    id: "conteo",
    value: RANKING_COLUMNAS.conteo,
    render: (fila) => (
      <span className="tabular-nums">
        {conteoCrudo(fila.entregadasHoy, fila.asignadasHoy)}
      </span>
    ),
  },
];

// Feature 76 (T9) — módulo cliente del ranking DIARIO. Recibe los datos YA serializados
// (STRING) + `esEditable` por props desde el Server Component `page.tsx` (que validó rol y
// pre-fetch; patrón /wallet). El cliente NUNCA recibe Prisma.Decimal ni recalcula montos/
// porcentajes. Dos secciones:
//  1. Tabla del ranking (R13/R6): posición, nombre, % del día, conteo crudo entregadas/
//     asignadas. El ORDEN ya viene resuelto del servidor (R4/R5) — se respeta tal cual.
//  2. Tabla de premios del podio (R8/R14/R15): una fila por posición 1-3, asociando el
//     premio al mensajero elegible de esa posición (o "sin ocupante" si no hay, R15).
//     Editable solo si `esEditable` (maestro, R16); el mensajero ve solo-lectura (R17).

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
          <CardTitle>Ranking del día</CardTitle>
          <CardDescription>
            Ordenado por porcentaje de entregas exitosas del día. El conteo crudo
            (entregadas / asignadas) hace el porcentaje auditable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={RANKING_COLUMNS}
            data={ranking}
            rowKey="mensajeroId"
            ariaLabel={RANKING_LABELS.tablaAria}
            emptyState={{ icon: Trophy, title: RANKING_LABELS.vacio }}
          />
        </CardContent>
      </Card>

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
