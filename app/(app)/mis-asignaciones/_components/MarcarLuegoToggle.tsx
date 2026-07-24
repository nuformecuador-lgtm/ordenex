"use client";

// Feature 115 (T8 / R5/R6) — control de la card para marcar/quitar una orden como
// "gestionar más tarde". Vive dentro de `MisAsignacionesModule`, que solo se monta desde
// una página que ya hace `notFound()` para roles ≠ `mensajero`; la Server Action
// `marcarGestionarLuego` revalida rol/propiedad (`forbidden`/`not_found`) como defensa en
// profundidad. Es una MUTACIÓN interna del mismo proyecto → Server Action, no Route API.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { marcarGestionarLuego } from "@/lib/actions/orden-mensajero-meta";

export interface MarcarLuegoToggleProps {
  /** Orden sobre la que se aplica la marca privada del mensajero. */
  ordenId: string;
  /** Estado actual de la marca (viene del DTO del server, R17). */
  marcada: boolean;
  /** Nº de remisión, solo para construir el nombre accesible del control. */
  numRemision: string;
}

// R9 (valor EXPLÍCITO, [D2]): el toggle envía el valor DESEADO (`!marcada`), no un flip ciego
// del server. Idempotente y seguro ante doble click.
export function MarcarLuegoToggle({
  ordenId,
  marcada,
  numRemision,
}: MarcarLuegoToggleProps) {
  const router = useRouter();
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);
  // Cerrojo SÍNCRONO anti-doble-click: `disabled` solo engancha tras el re-render; el ref
  // cambia YA en el primer click y descarta el segundo antes de facturar la action (patrón
  // de `SincronizarRutaButton`).
  const enVueloRef = useRef(false);

  async function handleClick() {
    if (enVueloRef.current) return;
    enVueloRef.current = true;
    setProcesando(true);
    try {
      const result = await marcarGestionarLuego({
        ordenId,
        marcarLuego: !marcada, // R5 (marcar) / R6 (quitar): el valor negado del actual
      });
      switch (result.status) {
        case "ok":
          // Happy path SIN toast: el módulo es server-driven; refrescar relee el DTO y con él
          // el badge y el reordenado de presentación.
          router.refresh();
          break;
        case "forbidden":
          toast.error("No puedes cambiar esta marca en esta orden.");
          break;
        case "not_found":
          toast.error("La orden ya no está disponible.");
          break;
        case "unauthenticated":
          toast.error("Tu sesión expiró. Inicia sesión de nuevo.");
          break;
        case "validation_error":
          toast.error("No se pudo actualizar la marca.");
          break;
      }
    } finally {
      enVueloRef.current = false;
      setProcesando(false);
    }
  }

  return (
    <Button
      type="button"
      variant={marcada ? "secondary" : "ghost"}
      size="sm"
      className="w-fit"
      loading={procesando}
      aria-pressed={marcada}
      aria-label={
        marcada
          ? `Quitar la marca «gestionar más tarde» de la orden ${numRemision}`
          : `Marcar la orden ${numRemision} para gestionar más tarde`
      }
      onClick={handleClick}
    >
      {procesando ? null : <Clock aria-hidden="true" />}
      Gestionar más tarde
    </Button>
  );
}
