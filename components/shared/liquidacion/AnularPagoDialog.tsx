"use client";

import { useId, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import type { AnularPagoResult, PagoRegistradoDTO } from "@/lib/types/liquidacion";

import {
  ANULAR_PAGO_ERROR,
  ANULAR_PAGO_RESPUESTA,
  ANULAR_PAGO_TEXTO,
  METODO_LIQUIDACION_LABEL,
  money,
} from "./liquidacion-labels";

// Feature 172 (T F.5, design §6/§10.1) — DIÁLOGO de anulación de un pago. Compartido: lo monta
// `PagosRegistradosTabla`, que es la única lista de comprobantes de la app y vive en las dos
// pantallas (`/wallet/tiendas` y `/cierres-admin`).
//
// MOLDE: el sub-modal de RECHAZO de cierre (feature 38/R11, `CierresAdminModule.tsx`), que es
// el otro sitio del repo donde una decisión irreversible exige un motivo escrito. De ahí salen
// el `Modal` con `closeOnConfirm={false}`, el `confirmVariant="destructive"` y el motivo con su
// error asociado por `aria-describedby`.
//
// LAS DOS BARRERAS DEL MOTIVO (R72). El botón de confirmar está deshabilitado mientras el
// motivo esté en blanco **y** `confirmar()` vuelve a comprobarlo antes de llamar a nadie. No es
// redundancia decorativa: son las dos direcciones del mismo requisito, y la segunda es la que
// sigue en pie si alguien quita la primera. El servidor lo revalida por tercera vez.
//
// LO QUE ESTE DIÁLOGO NO HACE:
//  - **no manda ningún monto** (R70/R76): la anulación es entera y el importe lo lee el
//    servidor del pago. Aquí el monto solo se PINTA, para que quien confirma vea qué anula;
//  - **no decide el permiso** (R81): lo decide el servidor, y quien monta la tabla decide si
//    llega a ofrecer el control. Un `forbidden` se traduce y se muestra, no se esconde;
//  - **no anula una anulación** (R82): la tabla no ofrece el control en un pago ya anulado, y
//    aquí no hay más camino que el de anular.
//
// Money-safe (R14): CERO `Number(` y CERO `parseFloat`. El monto entra como STRING y se pinta
// tal cual; el `restante` que devuelve el servidor lo pinta quien recibe `onAnulado` —puede ser
// NEGATIVO cuando la tienda tenía saldo en contra, y esa cifra es correcta: no se recorta.

/**
 * Las dos respuestas que dejan el pago ANULADO: la anulación de ahora y la que ya existía
 * (R75). Las dos traen el comprobante; solo la primera trae el `restante`.
 */
export type PagoAnuladoOk = Extract<
  AnularPagoResult,
  { status: "ok" } | { status: "ya_anulado" }
>;

export interface AnularPagoDialogProps {
  /** Visibilidad controlada por el padre (mismo contrato que `Modal`). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** El comprobante que se va a anular. Se pinta entero; de él solo viaja su `id`. */
  pago: PagoRegistradoDTO;
  /** Nombre visible del beneficiario: da nombre accesible al diálogo. */
  beneficiario: string;
  /** Ejecuta la anulación. La aporta quien monta, que es quien conoce la Server Action. */
  onAnular: (motivo: string) => Promise<AnularPagoResult>;
  /** Se invoca cuando el pago quedó anulado (también si ya lo estaba, R75). */
  onAnulado?: (resultado: PagoAnuladoOk) => void | Promise<void>;
}

/**
 * Traduce la respuesta del servidor a un aviso. Fuera del componente para que el `switch` sea
 * exhaustivo sobre `AnularPagoResult`: un estado nuevo del contrato rompe el build.
 */
function avisoDe(resultado: AnularPagoResult): string {
  switch (resultado.status) {
    case "ok":
      return ANULAR_PAGO_RESPUESTA.ok;
    case "ya_anulado":
      return ANULAR_PAGO_RESPUESTA.yaAnulado;
    case "no_encontrado":
      return ANULAR_PAGO_RESPUESTA.noEncontrado;
    case "forbidden":
      return ANULAR_PAGO_RESPUESTA.forbidden;
    case "unauthenticated":
      return ANULAR_PAGO_RESPUESTA.unauthenticated;
    case "validation_error":
      return ANULAR_PAGO_RESPUESTA.validacion;
  }
}

export function AnularPagoDialog({
  open,
  onOpenChange,
  pago,
  beneficiario,
  onAnular,
  onAnulado,
}: Readonly<AnularPagoDialogProps>) {
  const idBase = useId();
  const motivoId = `${idBase}-motivo`;

  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);

  const motivoLimpio = motivo.trim();
  // R72: un motivo de solo espacios NO es un motivo.
  const motivoOk = motivoLimpio.length > 0;

  async function confirmar() {
    if (!motivoOk) {
      // Segunda barrera: aunque el botón estuviera habilitado, aquí no sale nada.
      setError(ANULAR_PAGO_ERROR.motivo);
      return;
    }

    setError(undefined);
    setAviso(null);

    let resultado: AnularPagoResult;
    try {
      resultado = await onAnular(motivoLimpio);
    } catch {
      // Fallo de red o del servidor. Reintentar es seguro: la restricción de la base solo
      // deja anular una vez, así que un segundo intento devolvería `ya_anulado` (R75).
      setAviso(ANULAR_PAGO_RESPUESTA.fallo);
      return;
    }

    if (resultado.status === "ok" || resultado.status === "ya_anulado") {
      // El pago está anulado, que es el estado que se pedía. Se cierra y quien monta refresca
      // lo suyo (y pinta el `restante`, que solo trae el `ok`).
      await onAnulado?.(resultado);
      onOpenChange(false);
      return;
    }

    if (resultado.status === "validation_error") {
      const delCampo = resultado.fieldErrors.motivo?.[0];
      setError(delCampo ?? undefined);
      setAviso(delCampo ? null : ANULAR_PAGO_RESPUESTA.validacion);
      return;
    }

    setAviso(avisoDe(resultado));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={ANULAR_PAGO_TEXTO.titulo(beneficiario)}
      description={ANULAR_PAGO_TEXTO.descripcion}
      confirmLabel={ANULAR_PAGO_TEXTO.confirmar}
      cancelLabel={ANULAR_PAGO_TEXTO.cancelar}
      confirmVariant="destructive"
      confirmDisabled={!motivoOk}
      onConfirm={confirmar}
      /* Un rechazo del servidor deja el diálogo abierto con lo que se escribió. */
      closeOnConfirm={false}
      size="md"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {ANULAR_PAGO_TEXTO.resumen(
            money(pago.monto),
            pago.fechaPago,
            METODO_LIQUIDACION_LABEL[pago.metodo] ?? pago.metodo,
          )}
        </p>

        {aviso ? (
          <p role="alert" className="text-sm text-destructive">
            {aviso}
          </p>
        ) : null}

        <FormField
          id={motivoId}
          label={ANULAR_PAGO_TEXTO.motivo}
          hint={ANULAR_PAGO_TEXTO.motivoAyuda}
          required
          error={error}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={4}
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
  );
}
