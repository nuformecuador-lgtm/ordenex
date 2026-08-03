"use client";

import { RegistrarPagoDialog } from "@/components/shared/liquidacion/RegistrarPagoDialog";
import type { RegistrarPagoCampos } from "@/components/shared/liquidacion/RegistrarPagoDialog";
import { useToast } from "@/hooks/useToast";
import { registrarPagoMensajeroAction } from "@/lib/actions/liquidacion";
import type { PagoRegistradoDTO, RegistrarPagoResult } from "@/lib/types/liquidacion";

import { PAGO_MENSAJERO_TEXTO } from "./pago-mensajero-labels";

// Feature 172 (T E.1/T E.2, design §8) — el CABLEADO del pago a un mensajero: le pone el
// `cierreId` al formulario compartido de la Tanda D y traduce la respuesta.
//
// Vive en su propio archivo porque tiene DOS montajes que no comparten padre:
//   1. justo después de aprobar un cierre, con el detalle ya cerrado (T E.1), y
//   2. dentro de la sección «Pago al mensajero» del detalle de un cierre aprobado (T E.2).
// Duplicar el cableado habría duplicado la traducción de errores, que es justo la parte que
// R17 mide.
//
// **APROBAR Y PAGAR SON DOS PASOS** (§8, R17/R18). Este componente NO aprueba nada: cuando se
// monta, el cierre ya está aprobado y el mensajero ya está libre (feature 111). Por eso:
//   - la etiqueta del botón de salida es «Ahora no» cuando venimos de aprobar, y
//   - cuando el pago NO queda registrado —falle la red o lo rechace el dominio—, el aviso
//     empieza diciendo que el cierre sigue aprobado.
//
// El error se avisa y se RELANZA: el diálogo compartido lo captura, deja el formulario abierto
// y CONSERVA la clave de idempotencia, que es lo que impide cobrar dos veces si la petición
// llegó a escribirse aunque la respuesta se perdiera (R43/R47).
//
// Money-safe (R14): el pendiente entra como STRING y sale como STRING. Aquí no se resta nada;
// lo que se puede pagar lo decide el servidor bajo candado.

export interface RegistrarPagoMensajeroDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** El cierre APROBADO contra el que se registra el pago (R21). */
  cierreId: string;
  /** Nombre visible del mensajero: da nombre accesible al diálogo. */
  mensajeroNombre: string;
  /** Lo que queda por pagar de ese cierre, STRING del servidor. Prefija el monto (R23). */
  pendiente: string;
  /**
   * `true` si el diálogo se abrió como oferta INMEDIATA tras aprobar (§8). Cambia dos textos
   * —el botón de salida y el aviso de fallo— porque en ese momento el usuario acaba de
   * aprobar y necesita saber que eso ya está hecho y no depende de esto (R17).
   */
  trasAprobar?: boolean;
  /** Se invoca tras un registro efectivo, para que el padre refresque lo que muestra. */
  onRegistrado?: (pago: PagoRegistradoDTO) => void | Promise<void>;
}

export function RegistrarPagoMensajeroDialog({
  open,
  onOpenChange,
  cierreId,
  mensajeroNombre,
  pendiente,
  trasAprobar = false,
  onRegistrado,
}: Readonly<RegistrarPagoMensajeroDialogProps>) {
  const toast = useToast();

  /** R17 — el pago no quedó registrado. Lo primero que se dice es qué SÍ quedó hecho. */
  function avisarNoRegistrado() {
    toast.error(
      trasAprobar
        ? PAGO_MENSAJERO_TEXTO.cierreSigueAprobado
        : PAGO_MENSAJERO_TEXTO.pagoNoRegistrado,
    );
  }

  async function registrar(campos: RegistrarPagoCampos): Promise<RegistrarPagoResult> {
    let resultado: RegistrarPagoResult;
    try {
      resultado = await registrarPagoMensajeroAction({ ...campos, cierreId });
    } catch (error) {
      avisarNoRegistrado();
      // Se RELANZA: el diálogo conserva la clave de idempotencia para el reintento (R43).
      throw error;
    }
    if (resultado.status !== "ok" && resultado.status !== "ya_registrado") {
      avisarNoRegistrado();
    }
    return resultado;
  }

  async function trasRegistrar(pago: PagoRegistradoDTO) {
    toast.success(PAGO_MENSAJERO_TEXTO.registrado(pago.monto));
    await onRegistrado?.(pago);
  }

  return (
    <RegistrarPagoDialog
      open={open}
      onOpenChange={onOpenChange}
      beneficiario={mensajeroNombre}
      disponible={pendiente}
      cancelLabel={trasAprobar ? PAGO_MENSAJERO_TEXTO.ahoraNo : undefined}
      onRegistrar={registrar}
      onRegistrado={trasRegistrar}
    />
  );
}
