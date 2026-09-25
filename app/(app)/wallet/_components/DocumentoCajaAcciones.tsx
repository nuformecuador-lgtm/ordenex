"use client";

import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import {
  anularAporteCapitalAction,
  obtenerComprobanteAporteCapitalAction,
} from "@/lib/actions/aporte-capital";
import {
  anularPagoPorCuentaTiendaAction,
  obtenerComprobantePagoPorCuentaAction,
} from "@/lib/actions/pago-por-cuenta-tienda";
import type { ObtenerComprobanteResult } from "@/lib/types/pago-por-cuenta-tienda";
import type { DocumentoCajaDTO, WalletMovimientoDTO } from "@/lib/types/wallet";

import {
  ANULAR_DOCUMENTO_CAJA_RESPUESTA,
  ANULAR_DOCUMENTO_CAJA_TEXTO,
  CATEGORIA_LABEL,
  DOCUMENTO_CAJA_ACCION,
  DOCUMENTO_CAJA_NOMBRE,
  VER_COMPROBANTE_RESPUESTA,
  money,
} from "./wallet-labels";

// FICHA 459 (T B.16, design §9.4 — R65/R66/R67) — las acciones de una fila ORIGINAL del libro de
// la caja que tiene DOCUMENTO: un pago por cuenta de una tienda o un saldo inicial o aporte.
//
//  - «Anular…» solo si el documento está VIGENTE (R66); con motivo obligatorio y el diálogo
//    abierto ante cualquier rechazo (molde `AnularPagoDialog` de la 172: `closeOnConfirm={false}`,
//    `confirmVariant="destructive"` y dos barreras para el motivo).
//  - «Anulado» como texto si ya lo está. Deshacer una anulación no existe (R52).
//  - «Ver comprobante» si lo tiene (R67): pide el enlace temporal al servidor (R57) y lo abre en
//    otra pestaña. El enlace no se guarda ni se pinta.
//
// La fila solo llega aquí con `documento` no nulo: los contra-asientos y las salidas de los cobros
// reclasificados vienen del servidor con `documento: null` y el libro ni monta este componente.
//
// Vive FUERA de `WalletLedger.tsx` a propósito: el libro es presentación y una guardia comprueba
// que no importa Server Actions (salvo la reversa de la 45). Estas dos son MUTACIONES y la lectura
// de un enlace firmado al pulsar; ninguna es una lectura del listado.
//
// El id del documento es el `origenId` de la fila; viaja al servidor y no se pinta (R100).
// Money-safe: el monto solo se PINTA con `money`, y no viaja en la anulación (R37).

type TipoDocumento = DocumentoCajaDTO["tipo"];

/** Las dos acciones por tipo de documento, con la clave que cada schema `.strict()` espera. */
const ACCIONES: Record<
  TipoDocumento,
  {
    anular: (id: string, motivo: string) => Promise<{ status: string; fieldErrors?: Record<string, string[]> }>;
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
};

/** El aviso de cada respuesta de la anulación que NO la deja hecha. */
function avisoDeAnulacion(status: string): string {
  switch (status) {
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
  /** La fila ORIGINAL; `documento` no nulo y `origenId` con el id del documento. */
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
  const documentoId = movimiento.origenId;
  const concepto = CATEGORIA_LABEL[movimiento.categoria];
  const fecha = movimiento.fechaMovimiento.slice(0, 10);
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

    let resultado: { status: string; fieldErrors?: Record<string, string[]> };
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
    setAviso(avisoDeAnulacion(resultado.status));
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
