"use client";

// Feature 116 (F1 / R11/R14) — editor de la NOTA PRIVADA del mensajero para una orden. Es
// DISTINTA de la "Notas" de la TIENDA (`orden.notas`, que vive en `AsignacionDetalle`): esta
// nota es privada del mensajero (por `usuario_id`, invisible para otros roles y otros
// mensajeros) y se etiqueta "Mi nota" para separarla sin ambigüedad (R7). Es una MUTACIÓN
// interna del mismo proyecto → Server Action, no Route API. Los datos llegan por props desde el
// Server Component padre: el DTO ya trae `notaPrivada` filtrada por el actor autenticado.
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/useToast";
import {
  guardarNotaPrivada,
  limpiarNotaPrivada,
} from "@/lib/actions/notas-privadas-mensajero";

// Textos separados (i18n-ready), lenguaje claro. "Mi nota" la diferencia de "Notas" (tienda).
const ETIQUETA = "Mi nota";
const AYUDA =
  "Solo tú puedes ver esta nota; no la ven la tienda ni otros mensajeros.";
const PLACEHOLDER = "Escribe una nota para ti sobre esta entrega…";
const GUARDAR_OK = "Nota guardada.";
const LIMPIAR_OK = "Nota eliminada.";
const ERROR_GUARDAR = "No se pudo guardar tu nota. Inténtalo de nuevo.";
const ERROR_LIMPIAR = "No se pudo eliminar tu nota. Inténtalo de nuevo.";
const ERROR_SESION = "Tu sesión expiró. Inicia sesión de nuevo.";

export interface NotaPrivadaMensajeroProps {
  /** Orden sobre la que se escribe la nota privada. */
  ordenId: string;
  /**
   * Nota actual del mensajero (del DTO del server, ya filtrada por su `usuario_id`).
   * `null` = todavía sin nota (el editor arranca vacío).
   */
  notaInicial: string | null;
}

export function NotaPrivadaMensajero({
  ordenId,
  notaInicial,
}: NotaPrivadaMensajeroProps) {
  const router = useRouter();
  const toast = useToast();
  const textareaId = useId();
  const ayudaId = useId();
  const [valor, setValor] = useState<string>(notaInicial ?? "");
  const [procesando, setProcesando] = useState(false);
  // Cerrojo SÍNCRONO anti-doble-click: `disabled` solo engancha tras el re-render; el ref
  // descarta el segundo click YA en el primero (mismo patrón que `MarcarLuegoToggle`).
  const enVueloRef = useRef(false);

  // "Limpiar" solo tiene sentido si hay algo que borrar. Si el editor está vacío no hay nota
  // que quitar (y si hubiera una persistida, se mostraría aquí, haciéndolo no-vacío).
  const sinContenido = valor.trim() === "";

  async function handleGuardar() {
    if (enVueloRef.current) return;
    enVueloRef.current = true;
    setProcesando(true);
    try {
      const result = await guardarNotaPrivada({ ordenId, nota: valor });
      switch (result.status) {
        case "ok":
          // El server devuelve la nota resultante (`null` si quedó en blanco → equivale a
          // limpiar, R5). Se refleja en el editor sin esperar al refetch.
          setValor(result.nota ?? "");
          toast.success(result.nota === null ? LIMPIAR_OK : GUARDAR_OK);
          router.refresh(); // R14: relee el DTO del server (persistente ante recarga).
          break;
        case "unauthenticated":
          toast.error(ERROR_SESION);
          break;
        default:
          // forbidden / validation_error: motivo fijo, sin PII ni contenido de la nota (R17).
          toast.error(ERROR_GUARDAR);
      }
    } finally {
      enVueloRef.current = false;
      setProcesando(false);
    }
  }

  async function handleLimpiar() {
    if (enVueloRef.current) return;
    enVueloRef.current = true;
    setProcesando(true);
    try {
      const result = await limpiarNotaPrivada({ ordenId });
      switch (result.status) {
        case "ok":
          setValor("");
          toast.success(LIMPIAR_OK);
          router.refresh(); // R14
          break;
        case "unauthenticated":
          toast.error(ERROR_SESION);
          break;
        default:
          toast.error(ERROR_LIMPIAR);
      }
    } finally {
      enVueloRef.current = false;
      setProcesando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <StickyNote className="size-4 text-muted-foreground" aria-hidden="true" />
        <label htmlFor={textareaId} className="text-sm font-semibold">
          {ETIQUETA}
        </label>
      </div>
      <p id={ayudaId} className="text-xs text-muted-foreground">
        {AYUDA}
      </p>
      <Textarea
        id={textareaId}
        value={valor}
        onChange={(event) => setValor(event.target.value)}
        aria-describedby={ayudaId}
        rows={3}
        placeholder={PLACEHOLDER}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleLimpiar}
          disabled={procesando || sinContenido}
        >
          Limpiar
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleGuardar}
          loading={procesando}
        >
          Guardar
        </Button>
      </div>
    </div>
  );
}
