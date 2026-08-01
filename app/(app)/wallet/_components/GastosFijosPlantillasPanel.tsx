"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import { setActivaPlantillaAction } from "@/lib/actions/gasto-fijo-plantilla";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

import { GastoFijoPlantillaDialog } from "./GastoFijoPlantillaDialog";
import { estadoPlantillaGastoFijo } from "./gasto-fijo-estado-label";
import {
  COLUMNAS_DESCARGA_GASTOS_FIJOS,
  filaDescargaGastoFijo,
} from "./gastos-fijos-descarga-columnas";
import { money } from "./wallet-labels";

/** Nombre visible del panel: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Plantillas de gasto fijo";

// Feature 45 (T24, R22b/R23/R24/R25/R26) — panel CRUD de PLANTILLAS de gasto fijo (solo
// maestro; la página ya validó el rol). Lista todas las plantillas (activas e inactivas),
// permite crear/editar (diálogo reutilizado) y activar/desactivar (NUNCA borrar, R25: la
// desactivación es el mecanismo para dejar de generar). Deja explícito que los egresos de
// gasto fijo los emite el CRON mensual automáticamente, no este panel. Money-safe: el monto
// llega como STRING y se renderiza TAL CUAL con `money`, sin parseFloat/Number.

export interface GastosFijosPlantillasPanelProps {
  plantillas: GastoFijoPlantillaDTO[];
  /** Callback tras crear/editar/activar/desactivar (para que el módulo recargue la lista). */
  onCambio?: () => void;
}

export function GastosFijosPlantillasPanel({
  plantillas,
  onCambio,
}: GastosFijosPlantillasPanelProps) {
  const router = useRouter();
  const toast = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<GastoFijoPlantillaDTO | null>(null);
  // id de la plantilla cuyo toggle activo está en vuelo (deshabilita solo esa fila).
  const [alternando, setAlternando] = useState<string | null>(null);

  function abrirCrear() {
    setEditando(null);
    setDialogOpen(true);
  }

  function abrirEditar(plantilla: GastoFijoPlantillaDTO) {
    setEditando(plantilla);
    setDialogOpen(true);
  }

  async function alternarActiva(plantilla: GastoFijoPlantillaDTO) {
    setAlternando(plantilla.id);
    try {
      const result = await setActivaPlantillaAction({
        id: plantilla.id,
        activa: !plantilla.activa,
      });

      if (result.status === "ok") {
        toast.success(
          plantilla.activa
            ? "Plantilla desactivada. No se generará en los próximos meses."
            : "Plantilla activada. Se generará cada mes.",
        );
        onCambio?.();
        router.refresh();
        return;
      }
      if (result.status === "not_found") {
        toast.error("La plantilla ya no existe.");
        onCambio?.();
        return;
      }
      if (result.status === "forbidden") {
        toast.error("No tenés permiso para administrar plantillas.");
        return;
      }
      if (result.status === "validation_error") {
        toast.error("No se pudo actualizar la plantilla.");
        return;
      }
      // unauthenticated
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } finally {
      setAlternando(null);
    }
  }

  // Columnas construidas inline (baratas): cierran sobre los handlers/estado de la fila.
  const columns: Column<GastoFijoPlantillaDTO>[] = [
    { id: "concepto", value: "Concepto", render: (p) => p.concepto },
    {
      id: "monto",
      value: "Monto mensual",
      // Money-safe (R12): STRING tal cual, sin parseFloat/Number.
      render: (p) => money(p.monto),
    },
    {
      id: "estado",
      value: "Estado",
      // Feature 170 (T D.3): el TEXTO del estado sale de `gasto-fijo-estado-label` (módulo
      // puro), el mismo que lee el archivo de la descarga (R8). Aquí queda el color.
      render: (p) => (
        <Badge variant={p.activa ? "default" : "secondary"}>
          {estadoPlantillaGastoFijo(p.activa)}
        </Badge>
      ),
    },
    {
      id: "acciones",
      value: "Acciones",
      render: (p) => (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => abrirEditar(p)}
          >
            Editar
          </Button>
          <Button
            type="button"
            variant={p.activa ? "ghost" : "default"}
            size="sm"
            disabled={alternando === p.id}
            onClick={() => void alternarActiva(p)}
          >
            {p.activa ? "Desactivar" : "Activar"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Gastos fijos (plantillas)</CardTitle>
            <CardDescription>
              El sistema cobra estos gastos automáticamente cada mes. No los registres a mano:
              administrá acá las plantillas y desactivá las que ya no correspondan.
            </CardDescription>
          </div>
          <Button type="button" onClick={abrirCrear}>
            Nueva plantilla
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto">
          <DataTable
            columns={columns}
            data={plantillas}
            rowKey="id"
            ariaLabel={TITULO_DESCARGA}
            emptyMessage="Todavía no hay plantillas de gasto fijo."
            /**
             * Feature 170 (T D.3, R1/R7/R26/R30/R32) — descarga de FAMILIA B: el array de
             * props ES el conjunto entero (el módulo lo pide sin paginar), así que el
             * archivo se proyecta de lo que el panel ya pinta, sin releer nada. Salen
             * TODAS las plantillas, activas e inactivas, igual que la tabla: aquí no hay
             * filtro de pantalla que respetar.
             */
            descarga={{
              titulo: TITULO_DESCARGA,
              columnas: COLUMNAS_DESCARGA_GASTOS_FIJOS,
              obtenerFilas: () => filasLocales(plantillas, filaDescargaGastoFijo),
            }}
          />
        </div>
      </CardContent>

      <GastoFijoPlantillaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        plantilla={editando}
        onGuardado={onCambio}
      />
    </Card>
  );
}
