"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import {
  marcarConsolidacionRecibidaAction,
  revertirConciliacionAction,
} from "@/lib/actions/conciliacion-satelites";
import type { MarcaConciliacionActionResult } from "@/lib/actions/conciliacion-satelites";
import { money } from "@/lib/config/moneda";
import {
  estadoConciliacionDe,
  type EstadoConciliacion,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";

import {
  CONCILIACION_ACCION,
  CONCILIACION_RESPUESTA,
  DESMARCAR_NO_MUEVE_DINERO_NOTA,
  DESMARCAR_NO_MUEVE_DINERO_TITULO,
} from "./conciliacion-labels";
import { MarcarRecibidoDialog, type MarcarRecibidoCampos } from "./MarcarRecibidoDialog";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 (R25) — LAS DOS ACCIONES DE UNA CONSOLIDACIÓN: marcar recibido y deshacer la marca.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// COMPARTIDO por las dos pantallas que concilian: el desglose de `/wallet/satelites` (donde la
// central persigue el efectivo bodega por bodega) y la cola de `/cierres-admin` (donde el mismo
// botón sustituye al «Aprobar» que esta ficha retira). Mismo componente y no dos: son la misma
// acción sobre la misma fila, y dos copias acabarían diciendo cosas distintas sobre si el dinero
// llegó — que es exactamente el defecto que esta ficha vino a cerrar.
//
// ── UN BOTÓN, Y SÓLO EL QUE APLICA
//   sin conciliar        → «Marcar recibido» (primario: es lo que hay que hacer)
//   recibido incompleto  → «Corregir»        (no se re-marca: se cambia el monto que se dijo)
//   recibido             → «Desmarcar»       (discreto: es una corrección, no una operación)
//
// Los tres estados salen de `estadoConciliacionDe`, la MISMA función que pinta el badge, así que
// el rótulo del botón y el del estado no pueden contradecirse.
//
// ── POR QUÉ «DESMARCAR» PIDE CONFIRMACIÓN Y «MARCAR» NO
// No por peligro —ninguna de las dos mueve un colón (R14)— sino por ASIMETRÍA DE INFORMACIÓN:
// marcar abre un diálogo donde se ve el declarado y se teclea el monto, así que ya hay un paso
// donde mirar. Desmarcar es un clic que, sin nada delante, borra el rastro de quién dijo que el
// dinero llegó y de cuánto. La confirmación lleva escrito el importe que se va a borrar y la nota
// de que la marca es informativa: las dos mitades de lo que hay que saber antes de pulsar.
//
// ── QUIÉN DECIDE EL PERMISO: EL SERVIDOR
// `puedeConciliar` baja por props desde un Server Component que lo resolvió con `esAccesoTotal`,
// el MISMO predicado con el que `ConciliacionSatelitesService` responde `forbidden` (R27). Son
// las dos mitades del control: ocultar el botón no es una de ellas por sí solo. **Default
// `false`: falla cerrado** — quien monte esto sin decidir el permiso no ofrece conciliar nada.

export interface ConciliacionAccionesProps {
  cierreBodegaId: string;
  /** Nombre de la bodega, para el diálogo y para los nombres accesibles. */
  bodega: string;
  /** Día de la consolidación YA formateado por quien lo monta. */
  fecha: string;
  /** `total_efectivo`, STRING del servidor: lo que la bodega declaró que iba en el bulto. */
  declarado: string;
  /** La marca de hoy, tal como llega del servidor. Aquí no se deriva nada de dinero. */
  marca: { conciliado: boolean; faltaPorRecibir: string; montoRecibido: string | null };
  /** Nota ya guardada, si la hay: el diálogo de corregir parte de ella. */
  nota?: string | null;
  /** Ver la cabecera. Default `false`: falla cerrado. */
  puedeConciliar?: boolean;
  /**
   * Refresco DIRIGIDO tras marcar o desmarcar. Lo aporta quien monta porque es quien sabe qué
   * claves de SWR describen SU pantalla: la de saldos invalida su tabla y su desglose; la cola de
   * `/cierres-admin` invalida sus dos listados. Un `mutate()` sin argumentos refrescaría también
   * los desgloses de las demás bodegas abiertas, que es una consulta por fila sin motivo.
   */
  onCambio?: () => void | Promise<void>;
}

/** El tamaño de los botones de una fila de tabla: `sm`, como el resto de acciones de fila. */
const TAMANO = "sm" as const;

export function ConciliacionAcciones({
  cierreBodegaId,
  bodega,
  fecha,
  declarado,
  marca,
  nota = null,
  puedeConciliar = false,
  onCambio,
}: Readonly<ConciliacionAccionesProps>) {
  const toast = useToast();
  const [marcando, setMarcando] = useState(false);
  const [desmarcando, setDesmarcando] = useState(false);

  if (!puedeConciliar) return null;

  const estado: EstadoConciliacion = estadoConciliacionDe(marca);

  async function marcar(campos: MarcarRecibidoCampos): Promise<MarcaConciliacionActionResult> {
    return marcarConsolidacionRecibidaAction({ ...campos, cierreBodegaId });
  }

  async function trasMarcar(montoRecibido: string) {
    toast.success(CONCILIACION_RESPUESTA.marcada(montoRecibido));
    await onCambio?.();
  }

  /** R12 — deshacer. No lleva monto: el que había se BORRA (y sobrevive en el historial). */
  async function confirmarDesmarcar() {
    let resultado: MarcaConciliacionActionResult;
    try {
      resultado = await revertirConciliacionAction({ cierreBodegaId });
    } catch {
      toast.error(CONCILIACION_RESPUESTA.fallo);
      return;
    }
    if (resultado.status === "ok") {
      toast.success(CONCILIACION_RESPUESTA.revertida);
    } else if (resultado.status === "conflict") {
      toast.error(CONCILIACION_RESPUESTA.conflicto);
    } else if (resultado.status === "no_encontrada") {
      toast.error(CONCILIACION_RESPUESTA.noEncontrada);
    } else if (resultado.status === "forbidden") {
      toast.error(CONCILIACION_RESPUESTA.forbidden);
    } else if (resultado.status === "unauthenticated") {
      toast.error(CONCILIACION_RESPUESTA.unauthenticated);
    } else {
      toast.error(CONCILIACION_RESPUESTA.fallo);
    }
    setDesmarcando(false);
    await onCambio?.();
  }

  // El nombre accesible lleva SIEMPRE la bodega y el día: una pantalla puede tener veinte filas
  // abiertas, y veinte botones llamados «Marcar recibido» no identifican ninguna para quien
  // navega con lector de pantalla.
  const sufijo = `de ${bodega} del ${fecha}`;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {estado === "pendiente" ? (
        <Button
          type="button"
          size={TAMANO}
          aria-label={`${CONCILIACION_ACCION.marcar} la consolidación ${sufijo}`}
          onClick={() => setMarcando(true)}
        >
          {CONCILIACION_ACCION.marcar}
        </Button>
      ) : null}

      {estado === "incompleto" ? (
        <Button
          type="button"
          size={TAMANO}
          variant="outline"
          aria-label={`${CONCILIACION_ACCION.corregir} el monto recibido ${sufijo}`}
          onClick={() => setMarcando(true)}
        >
          {CONCILIACION_ACCION.corregir}
        </Button>
      ) : null}

      {estado !== "pendiente" ? (
        <Button
          type="button"
          size={TAMANO}
          variant="ghost"
          aria-label={`${CONCILIACION_ACCION.desmarcar} la consolidación ${sufijo}`}
          onClick={() => setDesmarcando(true)}
        >
          {CONCILIACION_ACCION.desmarcar}
        </Button>
      ) : null}

      <MarcarRecibidoDialog
        open={marcando}
        onOpenChange={setMarcando}
        bodega={bodega}
        fecha={fecha}
        declarado={declarado}
        montoActual={estado === "pendiente" ? null : marca.montoRecibido}
        notaActual={nota}
        onMarcar={marcar}
        onMarcado={trasMarcar}
      />

      <Modal
        open={desmarcando}
        onOpenChange={setDesmarcando}
        title={CONCILIACION_ACCION.desmarcar}
        description={`Consolidación de ${bodega} del ${fecha}.`}
        confirmLabel={CONCILIACION_ACCION.desmarcar}
        cancelLabel={CONCILIACION_ACCION.cancelar}
        onConfirm={confirmarDesmarcar}
        closeOnConfirm={false}
        size="md"
      >
        <div className="flex flex-col gap-3 text-sm">
          {/* El importe que se va a borrar, dicho antes de borrarlo. Es el dato que falta para
              decidir, y tras la reversión sólo sobrevive en el registro de acciones. */}
          {marca.montoRecibido === null ? null : (
            <p className="text-muted-foreground">
              Ahora mismo consta recibida por{" "}
              <strong className="font-semibold tabular-nums text-foreground">
                {money(marca.montoRecibido)}
              </strong>
              .
            </p>
          )}
          <p className="text-muted-foreground">
            <strong className="font-semibold text-foreground">
              {DESMARCAR_NO_MUEVE_DINERO_TITULO}
            </strong>{" "}
            {DESMARCAR_NO_MUEVE_DINERO_NOTA}
          </p>
        </div>
      </Modal>
    </div>
  );
}
