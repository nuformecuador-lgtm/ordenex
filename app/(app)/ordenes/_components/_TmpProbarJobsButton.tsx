"use client";

// ============================================================================
// ⚠️  COMPONENTE TEMPORAL DE PRUEBA — BORRAR ANTES DE MERGEAR A `dev`  ⚠️
// ============================================================================
//
// Boton que dispara a mano el drenador de la cola de jobs (feature 90) para
// poder probarlo en local, donde no hay Vercel Cron. Ver el encabezado de
// `lib/actions/_tmp-probar-jobs.ts` para el detalle y los pasos de borrado.
//
// COMO BORRARLO:
//   1. borrar este archivo;
//   2. borrar `lib/actions/_tmp-probar-jobs.ts`;
//   3. quitar el bloque marcado `TEMPORAL` de `app/(app)/ordenes/page.tsx`.
//
// NO tiene tests y NO debe ganarlos: no es una funcionalidad del producto.
// El estilo es deliberadamente "de andamio" (borde punteado, etiqueta TEMP)
// para que NADIE lo confunda con UI definitiva si llega a una demo.
// ============================================================================

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { probarDrenarJobs } from "@/lib/actions/_tmp-probar-jobs";

export function TmpProbarJobsButton() {
  const [cargando, setCargando] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const toast = useToast();

  async function handleClick() {
    setCargando(true);
    try {
      const r = await probarDrenarJobs();
      const detalle = r.conteos ? JSON.stringify(r.conteos) : "";
      setUltimo(detalle || r.mensaje);
      if (r.ok) toast.success(`${r.mensaje} ${detalle}`);
      else toast.error(`${r.mensaje} ${detalle}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error desconocido";
      setUltimo(msg);
      toast.error(`Fallo al drenar: ${msg}`);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="my-3 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-amber-500/70 bg-amber-50/50 p-3 dark:bg-amber-950/20">
      <span className="rounded bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">
        TEMP
      </span>
      <Button type="button" variant="outline" onClick={handleClick} disabled={cargando}>
        {cargando ? "Drenando…" : "Procesar cola de jobs"}
      </Button>
      <span className="text-xs text-muted-foreground">
        Dispara `/api/cron/procesar-jobs` sin esperar al cron. Andamio de prueba: se elimina
        antes de mergear.
      </span>
      {ultimo !== null && (
        <code className="w-full break-all text-xs text-muted-foreground">{ultimo}</code>
      )}
    </div>
  );
}
