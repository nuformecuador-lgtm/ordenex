"use client";

import { useCallback, useMemo, useState } from "react";
import { Store } from "lucide-react";

import { ContactoButtons } from "@/components/shared/ContactoButtons";
import { EscanerGuiaCard } from "@/components/shared/EscanerGuiaCard";
import { useToast } from "@/hooks/useToast";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { useRecolectarPorGuia } from "./useRecolectarPorGuia";

// Feature 157 (R13-R24) — apartado PROPIO del mensajero para lo que va a recoger EN LA TIENDA.
//
// Es deliberadamente pobre comparado con el panel de gestión: aquí no hay entrega, ni cobro,
// ni evidencia, ni causa de devolución, ni resultado que elegir (R16). Recolectar es un acto
// físico de un paso —el paquete pasa de la tienda a la ruta hacia la bodega central— y la
// pantalla no debe sugerir lo contrario. Lo único que se ofrece es escanear (o teclear) la
// guía, más el contacto de la tienda por si el mensajero necesita avisar que va en camino.
//
// El bloque de acción es UNO para todo el apartado, no un botón por tarjeta: en la tienda se
// recogen decenas de paquetes seguidos y la acción natural es escanear en tanda (decisión del
// humano). Las tarjetas son la referencia de QUÉ hay que recoger, no controles.

const TITULO = "Por recolectar en tienda";

/** Conteo del banner. En singular/plural, sin jerga: el mensajero lee "3 paquetes". */
function textoConteo(n: number): string {
  return n === 1
    ? "1 paquete por recolectar en tienda."
    : `${n} paquetes por recolectar en tienda.`;
}

interface GrupoTienda {
  tiendaNombre: string;
  tiendaTelefono: string | null;
  ordenes: MiAsignacionDTO[];
}

/**
 * Agrupa por tienda (R14) conservando el orden de llegada: el mensajero recorre tiendas, no
 * órdenes sueltas, así que la lista se organiza por el sitio al que tiene que ir.
 */
function agruparPorTienda(ordenes: MiAsignacionDTO[]): GrupoTienda[] {
  const grupos = new Map<string, GrupoTienda>();
  for (const orden of ordenes) {
    const grupo = grupos.get(orden.tiendaNombre);
    if (grupo) {
      grupo.ordenes.push(orden);
      continue;
    }
    grupos.set(orden.tiendaNombre, {
      tiendaNombre: orden.tiendaNombre,
      tiendaTelefono: orden.tiendaTelefono ?? null,
      ordenes: [orden],
    });
  }
  return [...grupos.values()];
}

export interface RecoleccionTiendaPanelProps {
  /** Órdenes en `por_recolectar_en_tienda` asignadas al actor (R11). */
  porRecolectar: MiAsignacionDTO[];
  /**
   * Feature 111/R14: con un cierre pendiente el mensajero NO mueve guías. La lista sigue
   * visible (solo-visualización) pero el bloque de acción no se renderiza (R24).
   */
  bloqueado?: boolean;
  /** Se invoca tras una recolección exitosa (el módulo lo conecta a router.refresh()). */
  onRecolectada: () => void;
}

export function RecoleccionTiendaPanel({
  porRecolectar,
  bloqueado = false,
  onRecolectada,
}: Readonly<RecoleccionTiendaPanelProps>) {
  const toast = useToast();
  const { recolectar, procesando } = useRecolectarPorGuia(porRecolectar);
  // Confirmación PERSISTENTE de la última: el toast se va solo y en una tanda seguida el
  // mensajero necesita ver que la anterior sí entró (mismo criterio que `RecogerPaqueteCard`).
  const [ultima, setUltima] = useState<number | null>(null);

  const grupos = useMemo(() => agruparPorTienda(porRecolectar), [porRecolectar]);

  const recolectarGuia = useCallback(
    async (numGuia: number): Promise<boolean> => {
      const ok = await recolectar(numGuia);
      if (ok) {
        setUltima(numGuia);
        onRecolectada();
      }
      return ok;
    },
    [recolectar, onRecolectada],
  );

  /** Camino cámara: el QR de la etiqueta codifica `/paquete/<numGuia>`. */
  const onDecoded = useCallback(
    (texto: string) => {
      const numGuia = extractNumGuiaFromScan(texto);
      if (numGuia === null) {
        toast.error("Código inválido.");
        return;
      }
      void recolectarGuia(numGuia);
    },
    [recolectarGuia, toast],
  );

  /** Camino manual: lo tecleado ES el número (base 10, mismo criterio que la URL, R20). */
  const onManual = useCallback(
    async (valor: string): Promise<boolean> => {
      if (!/^\d+$/.test(valor)) return false;
      return recolectarGuia(Number(valor));
    },
    [recolectarGuia],
  );

  if (porRecolectar.length === 0) return null;

  return (
    <section aria-label={TITULO} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{TITULO}</h2>
        <p role="status" className="text-sm text-muted-foreground">
          {textoConteo(porRecolectar.length)}
        </p>
      </div>

      {/* R24: bloqueado por cierre pendiente -> la lista se ve, pero no hay cómo mover nada. */}
      {bloqueado ? null : (
        <EscanerGuiaCard
          ariaLabel="Recolectar por número de guía o escaneo"
          titulo="Recolectar en tienda"
          descripcion="Escanea o ingresa el número de guía"
          icono={Store}
          onDecoded={onDecoded}
          procesando={procesando}
          mensajeErrorCamara="No se pudo abrir la cámara."
          manual={{ onSubmit: onManual, submitLabel: "Confirmar recolección" }}
          exito={
            ultima === null ? undefined : (
              <>
                Guía <span className="font-semibold">{ultima}</span> recolectada
                correctamente.
              </>
            )
          }
        />
      )}

      {grupos.map((grupo) => (
        <div
          key={grupo.tiendaNombre}
          className="flex flex-col gap-2 rounded-2xl border border-border p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{grupo.tiendaNombre}</h3>
            {/* R15: el interlocutor de una recolección es la TIENDA, no el destinatario.
                Sin teléfono registrado no se pintan botones que no llevan a ninguna parte. */}
            {grupo.tiendaTelefono ? (
              <ContactoButtons
                telefono={grupo.tiendaTelefono}
                nombre={grupo.tiendaNombre}
              />
            ) : null}
          </div>
          <ul className="flex flex-col gap-2">
            {grupo.ordenes.map((orden) => (
              <li
                key={orden.id}
                className="rounded-xl bg-muted/40 px-3 py-2 text-sm"
              >
                <p className="font-semibold tabular-nums">
                  Guía {orden.numGuia ?? "—"}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {orden.numRemision}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {orden.producto} · {orden.destinatario}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
