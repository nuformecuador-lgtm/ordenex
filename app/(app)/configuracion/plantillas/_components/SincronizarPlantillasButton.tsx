"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { sincronizarPlantillasWhatsapp } from "@/lib/actions/plantillas-sync";

// Integracion WhatsApp — boton para que el maestro dispare la sincronizacion de plantillas
// (Meta -> local) sin esperar al cron de 24 h. Trae los templates de Meta y actualiza/importa
// las plantillas locales por nombre. Al terminar, refresca el listado (onSincronizado).

export interface SincronizarPlantillasButtonProps {
  /** Se invoca tras una sincronizacion `ok` para refrescar el listado. */
  onSincronizado?: () => void;
}

export function SincronizarPlantillasButton({
  onSincronizado,
}: Readonly<SincronizarPlantillasButtonProps>) {
  const [cargando, setCargando] = useState(false);
  const toast = useToast();

  async function handleClick() {
    if (cargando) return;
    setCargando(true);
    try {
      const r = await sincronizarPlantillasWhatsapp();
      if (r.status === "ok") {
        toast.success(
          `Sincronización lista: ${r.actualizadas} actualizadas, ${r.creadas} creadas` +
            (r.omitidas > 0 ? `, ${r.omitidas} omitidas` : "") +
            ` (de ${r.leidas} en Meta).`,
        );
        onSincronizado?.();
        return;
      }
      toast.error(mensajeError(r));
    } finally {
      setCargando(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={handleClick} disabled={cargando}>
      <RefreshCw className={`size-4${cargando ? " animate-spin" : ""}`} aria-hidden="true" />
      {cargando ? "Sincronizando…" : "Sincronizar con WhatsApp"}
    </Button>
  );
}

function mensajeError(r: { status: string; detalle?: string }): string {
  switch (r.status) {
    case "no_configurado":
      return "WhatsApp aún no está configurado.";
    case "forbidden":
      return "No tienes permiso para sincronizar.";
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a entrar.";
    default:
      return `No se pudo sincronizar${r.detalle ? `: ${r.detalle}` : "."}`;
  }
}
