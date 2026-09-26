"use client";

import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { anularAbonoTiendaAction, obtenerComprobanteAbonoAction } from "@/lib/actions/abono-tienda";
import {
  anularAporteCapitalAction,
  obtenerComprobanteAporteCapitalAction,
} from "@/lib/actions/aporte-capital";
import {
  anularPagoPorCuentaTiendaAction,
  obtenerComprobantePagoPorCuentaAction,
} from "@/lib/actions/pago-por-cuenta-tienda";
import { anularAjusteCajaAction } from "@/lib/actions/wallet";
import { anularCobroTiendaAction } from "@/lib/actions/wallet-tienda";
import type { ObtenerComprobanteResult } from "@/lib/types/pago-por-cuenta-tienda";
import type { DocumentoCajaDTO, WalletMovimientoDTO } from "@/lib/types/wallet";
import type { MotivoNoAnulable } from "@/lib/types/wallet-tienda";

import {
  ANULAR_DOCUMENTO_CAJA_RESPUESTA,
  ANULAR_DOCUMENTO_CAJA_TEXTO,
  CATEGORIA_LABEL,
  DOCUMENTO_CAJA_ACCION,
  DOCUMENTO_CAJA_NOMBRE,
  VER_COMPROBANTE_RESPUESTA,
  money,
} from "./wallet-labels";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

// FICHA 459 (T B.16, design §9.4 — R65/R66/R67) — las acciones de una fila ORIGINAL del libro de
// la caja que tiene DOCUMENTO: el pago de un gasto de una tienda, el aporte de dinero a la caja y,
// desde la FICHA 461, la línea de caja de un cobro de Ordenex a una tienda (propia o completada por
// la migración de datos; R20/R37) y la corrección de caja (R71).
//
//  - «Anular…» solo si el documento está VIGENTE (R66); con motivo obligatorio y el diálogo
//    abierto ante cualquier rechazo (molde `AnularPagoDialog` de la 172: `closeOnConfirm={false}`,
//    `confirmVariant="destructive"` y dos barreras para el motivo).
//  - «Anulado» como texto si ya lo está. Deshacer una anulación no existe (R52 / 461-R19).
//  - «Ver comprobante» si lo tiene (R67): pide el enlace temporal al servidor (R57) y lo abre en
//    otra pestaña. El enlace no se guarda ni se pinta. Un cobro nunca lo tiene.
//  - FICHA 461 (R17, design §9): si el servidor responde `no_anulable`, el diálogo se queda abierto y
//    dice POR QUÉ con el motivo que él devolvió (se reclasificó / no tiene su línea en la caja).
//
// La fila solo llega aquí con `documento` no nulo: los contra-asientos y las salidas de los cobros
// reclasificados vienen del servidor con `documento: null` y el libro ni monta este componente.
//
// Vive FUERA de `WalletLedger.tsx` a propósito: el libro es presentación y una guardia comprueba
// que no importa Server Actions (salvo la reversa de la 45). Estas dos son MUTACIONES y la lectura
// de un enlace firmado al pulsar; ninguna es una lectura del listado.
//
// El id del documento es el `origenId` de la fila —salvo en la corrección de caja (461-R71), cuyo
// documento ES la fila y el id es `movimiento.id`—; viaja al servidor y no se pinta (R100).
// Money-safe: el monto solo se PINTA con `money`, y no viaja en la anulación (R37).

type TipoDocumento = DocumentoCajaDTO["tipo"];

/**
 * Lo que las cuatro actions de anulación tienen en común, normalizado: el estado, los errores por
 * campo (`validation_error`) y, en el cobro (461-R17), POR QUÉ no se puede anular (`no_anulable`).
 */
type ResultadoAnulacion = {
  status: string;
  fieldErrors?: Record<string, string[]>;
  motivo?: MotivoNoAnulable;
};

/** Las dos acciones por tipo de documento, con la clave que cada schema `.strict()` espera. */
const ACCIONES: Record<
  TipoDocumento,
  {
    anular: (id: string, motivo: string) => Promise<ResultadoAnulacion>;
    comprobante: (id: string) => Promise<ObtenerComprobanteResult>;
  }
> = {
  pago_por_cuenta_tienda: {
    anular: (pagoId, motivo) => anularPagoPorCuentaTiendaAction({ pagoId, motivo }),
    comprobante: (pagoId) => obtenerComprobantePagoPorCuentaAction({ pagoId }),
  },
  aporte_capital: {
    anular: (aporteId, motivo) => anularAporteCapitalAction({ aporteId, motivo }),
    comprobante: (aporteId) => obtenerComprobanteAporteCapitalAction({ aporteId }),
  },
  // Ficha 461 (design §9, R20): el cobro de Ordenex a una tienda. `anular` llama a la action real con
  // el id del DÉBITO de la tienda (el `origenId` de la línea de caja); `comprobante` nunca se ofrece
  // (`tieneComprobante` es siempre `false` en un cobro), así que responde «sin comprobante» sin
  // viajar al servidor.
  cobro_tienda: {
    anular: (cobroId, motivo) => anularCobroTiendaAction({ cobroId, motivo }),
    comprobante: async () => ({ status: "sin_comprobante" as const }),
  },
  // Ficha 461 (R71, auditoría D3): la corrección de caja original; el id del «documento» es el de la
  // PROPIA fila (`movimiento.id`, no `origenId`, que aquí es `null`): `anularAjusteCajaSchema` pide
  // `movimientoId` y `AjusteCajaService.anular` la busca con `obtenerPorId`.
  ajuste_caja: {
    anular: (movimientoId, motivo) => anularAjusteCajaAction({ movimientoId, motivo }),
    comprobante: async () => ({ status: "sin_comprobante" as const }),
  },
  // Ficha 457 (design §8.5, R41): el pago de una tienda a Ordenex. `anular` llama a la action real con
  // el id del DOCUMENTO (el `origenId` de la entrada) y SIN monto (R34); `comprobante` pide el enlace
  // temporal (el pago SÍ puede llevarlo, R42).
  abono_tienda: {
    anular: (abonoId, motivo) => anularAbonoTiendaAction({ abonoId, motivo }),
    comprobante: (abonoId) => obtenerComprobanteAbonoAction({ abonoId }),
  },
};

/** El aviso de cada respuesta de la anulación que NO la deja hecha. */
function avisoDeAnulacion(resultado: ResultadoAnulacion): string {
  switch (resultado.status) {
    // Ficha 461 (R17): el cobro reclasificado o sin línea de caja no se anula desde aquí, y se dice
    // por qué con el motivo que devolvió el servidor. Sin motivo (no debería pasar) cae al fallo genérico.
    case "no_anulable":
      return resultado.motivo === undefined
        ? ANULAR_DOCUMENTO_CAJA_RESPUESTA.fallo
        : ANULAR_DOCUMENTO_CAJA_RESPUESTA.noAnulable(resultado.motivo);
    case "no_encontrado":
      return ANULAR_DOCUMENTO_CAJA_RESPUESTA.noEncontrado;
    case "forbidden":
      return ANULAR_DOCUMENTO_CAJA_RESPUESTA.forbidden;
    case "unauthenticated":
      return ANULAR_DOCUMENTO_CAJA_RESPUESTA.unauthenticated;
    case "validation_error":
      return ANULAR_DOCUMENTO_CAJA_RESPUESTA.validacion;
    default:
      return ANULAR_DOCUMENTO_CAJA_RESPUESTA.fallo;
  }
}

export interface DocumentoCajaAccionesProps {
  /** La fila ORIGINAL; `documento` no nulo y `origenId` con el id del documento (la corrección de caja, con el suyo). */
  movimiento: WalletMovimientoDTO & { documento: DocumentoCajaDTO };
  /** Tras anular (o si ya lo estaba): el módulo relee libro, tarjeta y composición (R65). */
  onAnulado?: () => void;
}

export function DocumentoCajaAcciones({ movimiento, onAnulado }: DocumentoCajaAccionesProps) {
  const toast = useToast();
  const idBase = useId();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);

  const { documento } = movimiento;
  // Ficha 461 (R71; recorrido F1): la corrección de caja ES su propio documento —`origenId` viene
  // `null` a propósito— y `anularAjusteCajaSchema` espera el id de la fila (`movimientoId`).
  const documentoId = documento.tipo === "ajuste_caja" ? movimiento.id : movimiento.origenId;
  const concepto = CATEGORIA_LABEL[movimiento.categoria];
  const fecha = fechaDiaMovimientoCR(movimiento.fechaMovimiento);
  const montoPintado = money(movimiento.monto);
  const motivoLimpio = motivo.trim();

  if (documentoId === null) return null; // la red: una fila original siempre trae su origen

  function abrir() {
    setMotivo("");
    setError(undefined);
    setAviso(null);
    setAbierto(true);
  }

  async function confirmarAnulacion() {
    if (motivoLimpio.length === 0) {
      // Segunda barrera: aunque el botón estuviera habilitado, aquí no sale nada (R49).
      setError(ANULAR_DOCUMENTO_CAJA_TEXTO.motivoVacio);
      return;
    }
    setError(undefined);
    setAviso(null);

    let resultado: ResultadoAnulacion;
    try {
      resultado = await ACCIONES[documento.tipo].anular(documentoId as string, motivoLimpio);
    } catch {
      // Reintentar es seguro: la anulación es única en la base (R50).
      setAviso(ANULAR_DOCUMENTO_CAJA_RESPUESTA.fallo);
      return;
    }

    if (resultado.status === "ok" || resultado.status === "ya_anulado") {
      toast.success(
        resultado.status === "ok"
          ? ANULAR_DOCUMENTO_CAJA_RESPUESTA.ok
          : ANULAR_DOCUMENTO_CAJA_RESPUESTA.yaAnulado,
      );
      setAbierto(false);
      onAnulado?.();
      return;
    }
    if (resultado.status === "validation_error") {
      const delCampo = resultado.fieldErrors?.motivo?.[0];
      setError(delCampo);
      setAviso(delCampo ? null : ANULAR_DOCUMENTO_CAJA_RESPUESTA.validacion);
      return;
    }
    setAviso(avisoDeAnulacion(resultado));
  }

  async function verComprobante() {
    // Se abre la pestaña ANTES de esperar al servidor: un `window.open` después de un `await`
    // lo bloquean los navegadores como ventana emergente. Si el enlace no llega, se cierra.
    const pestana = window.open("", "_blank");
    let resultado: ObtenerComprobanteResult;
    try {
      resultado = await ACCIONES[documento.tipo].comprobante(documentoId as string);
    } catch {
      pestana?.close();
      toast.error(VER_COMPROBANTE_RESPUESTA.fallo);
      return;
    }
    if (resultado.status === "ok") {
      if (pestana) {
        pestana.opener = null;
        pestana.location.href = resultado.url;
      } else {
        window.open(resultado.url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    pestana?.close();
    const mensaje: Record<Exclude<ObtenerComprobanteResult["status"], "ok">, string> = {
      sin_comprobante: VER_COMPROBANTE_RESPUESTA.sinComprobante,
      no_encontrado: VER_COMPROBANTE_RESPUESTA.noEncontrado,
      forbidden: VER_COMPROBANTE_RESPUESTA.forbidden,
      unauthenticated: VER_COMPROBANTE_RESPUESTA.unauthenticated,
      validation_error: VER_COMPROBANTE_RESPUESTA.fallo,
    };
    toast.error(mensaje[resultado.status]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1" data-documento={documento.tipo}>
      {documento.anulado ? (
        <Badge variant="secondary">{DOCUMENTO_CAJA_ACCION.anulado}</Badge>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={DOCUMENTO_CAJA_ACCION.anularNombre(concepto, fecha, montoPintado)}
          onClick={abrir}
        >
          {DOCUMENTO_CAJA_ACCION.anular}
        </Button>
      )}
      {documento.tieneComprobante ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={DOCUMENTO_CAJA_ACCION.verComprobanteNombre(concepto, fecha)}
          onClick={() => void verComprobante()}
        >
          {DOCUMENTO_CAJA_ACCION.verComprobante}
        </Button>
      ) : null}

      <Modal
        open={abierto}
        onOpenChange={(next) => {
          if (!next) setAbierto(false);
        }}
        title={ANULAR_DOCUMENTO_CAJA_TEXTO.titulo(DOCUMENTO_CAJA_NOMBRE[documento.tipo])}
        description={ANULAR_DOCUMENTO_CAJA_TEXTO.descripcion(montoPintado)}
        confirmLabel={ANULAR_DOCUMENTO_CAJA_TEXTO.confirmar}
        cancelLabel={ANULAR_DOCUMENTO_CAJA_TEXTO.cancelar}
        confirmVariant="destructive"
        // Primera barrera del motivo (R49); `confirmarAnulacion` es la segunda.
        confirmDisabled={motivoLimpio.length === 0}
        onConfirm={confirmarAnulacion}
        closeOnConfirm={false}
        size="md"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{`${concepto} · ${fecha} · ${montoPintado}`}</p>
          {aviso ? (
            <p role="alert" className="text-sm text-destructive">
              {aviso}
            </p>
          ) : null}
          <FormField
            id={`${idBase}-motivo`}
            label={ANULAR_DOCUMENTO_CAJA_TEXTO.motivo}
            hint={ANULAR_DOCUMENTO_CAJA_TEXTO.motivoAyuda}
            required
            error={error}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                value={motivo}
                onChange={(e) => {
                  setMotivo(e.target.value);
                  setError(undefined);
                }}
              />
            )}
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
