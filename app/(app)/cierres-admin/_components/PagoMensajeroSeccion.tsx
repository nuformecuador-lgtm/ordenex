"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { PagosRegistradosTabla } from "@/components/shared/liquidacion/PagosRegistradosTabla";
import { PAGOS_REGISTRADOS_TEXTO } from "@/components/shared/liquidacion/liquidacion-labels";
import type { PagoAnuladoOk } from "@/components/shared/liquidacion/AnularPagoDialog";
import { useToast } from "@/hooks/useToast";
import { anularPagoAction, listarPagosDeCierreAction } from "@/lib/actions/liquidacion";
import type { AnularPagoResult, PagoRegistradoDTO } from "@/lib/types/liquidacion";

import { PAGO_MENSAJERO_TEXTO } from "./pago-mensajero-labels";
import {
  PendienteLiquidarBadge,
  hayPendienteDeLiquidar,
} from "./PendienteLiquidarBadge";
import { RegistrarPagoMensajeroDialog } from "./RegistrarPagoMensajeroDialog";

// Feature 172 (T E.2, design §8/§10.2, R19/R27/R28/R49) — la sección «Pago al mensajero» del
// detalle de un cierre YA APROBADO: cuánto queda pendiente, los comprobantes de lo ya pagado y
// el botón de registrar.
//
// Es el SEGUNDO camino del pago (§8). El primero es la oferta inmediata al aprobar (T E.1);
// este existe porque esa oferta se puede declinar con «Ahora no» —y debe poder declinarse sin
// coste— así que tiene que haber una forma de volver más tarde (R19).
//
// QUIÉN DECIDE QUE ESTA SECCIÓN SE VE: el PADRE, y solo la monta si el cierre está `aprobado`
// y el actor puede pagar ([P3]/R6: un `adminSatelite` aprueba pero no paga, y su detalle no
// muestra esta sección). Aquí no se vuelve a resolver el permiso —no se puede: el rol no
// existe en el cliente— y por eso el componente tampoco pide la lista de comprobantes cuando
// no está montado: en un cierre no aprobado no se consulta nada (R28).
//
// Money-safe (R14): el pendiente llega derivado del servidor y se pinta tal cual. La única
// lectura que se hace de él es «¿queda algo?» (`hayPendienteDeLiquidar`, por TEXTO).

/** Prefijo de la clave SWR de los comprobantes de un cierre. Identifica esta lectura. */
const CLAVE_PAGOS_CIERRE = "liquidacion:pagos-cierre";

/**
 * Clave SWR de los comprobantes de UN cierre. Exportada por el mismo motivo que
 * `clavePagosDeTienda` (T D.3): es lo que permite refrescar esta lista —y solo esta— desde
 * fuera, sin arrastrar el resto de la pantalla (R33).
 */
export function clavePagosDeCierre(cierreId: string): readonly [string, string] {
  return [CLAVE_PAGOS_CIERRE, cierreId] as const;
}

/** Fetcher: pide los comprobantes y traduce un status != ok a un throw (SWR lo marca error). */
async function leerPagos(cierreId: string): Promise<PagoRegistradoDTO[]> {
  const res = await listarPagosDeCierreAction({ cierreId });
  if (res.status !== "ok") throw new Error(res.status);
  return res.pagos;
}

export interface PagoMensajeroSeccionProps {
  cierreId: string;
  /** Nombre del mensajero: nombra el diálogo y la tabla de comprobantes. */
  mensajeroNombre: string;
  /**
   * Lo que queda por liquidar de este cierre, DERIVADO en el servidor (T C.2). `null` no
   * debería llegar aquí —el padre solo monta la sección en cierres aprobados— y si llegara se
   * trata como «nada que ofrecer»: falla cerrado.
   */
  pendiente: string | null;
  /**
   * T F.5 (R4/R81) — `true` solo si el actor puede anular: los mismos roles que pagan. El
   * padre solo monta la sección con permiso, pero la prop viaja igual y con **default
   * `false`**, para que el permiso sea un dato y no una consecuencia del montaje.
   */
  puedeAnular?: boolean;
  /**
   * Se invoca tras registrar o anular, para que el padre vuelva a leer el pendiente DEL
   * SERVIDOR. Las dos operaciones lo mueven, así que las dos tienen que releerlo.
   */
  onRegistrado?: () => void | Promise<void>;
}

export function PagoMensajeroSeccion({
  cierreId,
  mensajeroNombre,
  pendiente,
  puedeAnular = false,
  onRegistrado,
}: Readonly<PagoMensajeroSeccionProps>) {
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);

  const { data, error, isLoading } = useSWR(clavePagosDeCierre(cierreId), () =>
    leerPagos(cierreId),
  );

  // R27: con el cierre liquidado del todo no se ofrece registrar más pagos contra él.
  const hayQuePagar = hayPendienteDeLiquidar(pendiente);

  async function trasRegistrar() {
    // Refresco DIRIGIDO: la lista de ESTE cierre, y nada más (mismo criterio que T D.3/R33).
    await mutate(clavePagosDeCierre(cierreId));
    await onRegistrado?.();
  }

  /** T F.5 — al borde solo van el pago y el motivo: el monto lo lee el servidor (R70). */
  async function anular(
    pago: PagoRegistradoDTO,
    motivo: string,
  ): Promise<AnularPagoResult> {
    return anularPagoAction({ pagoId: pago.id, motivo });
  }

  async function trasAnular(resultado: PagoAnuladoOk) {
    if (resultado.status === "ok") {
      // R71: el pendiente vuelve a lo que era antes del pago. Lo dice el servidor.
      toast.success(PAGO_MENSAJERO_TEXTO.anulado(resultado.restante));
    } else {
      toast.info(PAGO_MENSAJERO_TEXTO.yaAnulado);
    }
    await trasRegistrar();
  }

  return (
    <section
      aria-label={PAGO_MENSAJERO_TEXTO.seccion}
      className="flex flex-col gap-3 border-t pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{PAGO_MENSAJERO_TEXTO.seccion}</h3>
        <p className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{PAGO_MENSAJERO_TEXTO.pendiente}:</span>
          {/* R26: el importe sale del servidor; aquí solo se pinta. */}
          <PendienteLiquidarBadge pendiente={pendiente} />
        </p>
      </div>

      {hayQuePagar ? (
        <div className="flex flex-wrap justify-end">
          <Button type="button" onClick={() => setAbierto(true)}>
            {PAGO_MENSAJERO_TEXTO.registrar}
          </Button>
        </div>
      ) : (
        // El motivo de que no haya botón se dice con TEXTO, no con su ausencia (R27).
        <p className="text-sm text-muted-foreground">{PAGO_MENSAJERO_TEXTO.liquidado}</p>
      )}

      {/* R49 — los comprobantes de este cierre, incluidos los anulados (R74). Se muestran
          también cuando ya no queda pendiente: es justo entonces cuando explican por qué.
          T F.5 — y con el control de anular, que existe precisamente cuando ya se pagó. */}
      <PagosRegistradosTabla
        pagos={data ?? []}
        beneficiario={mensajeroNombre}
        isLoading={isLoading}
        error={error ? PAGOS_REGISTRADOS_TEXTO.error : null}
        puedeAnular={puedeAnular}
        onAnular={anular}
        onAnulado={trasAnular}
      />

      {/* El diálogo solo se monta si hay algo que pagar: sin pendiente no hay nada que abrir. */}
      {hayQuePagar ? (
        <RegistrarPagoMensajeroDialog
          open={abierto}
          onOpenChange={setAbierto}
          cierreId={cierreId}
          mensajeroNombre={mensajeroNombre}
          pendiente={pendiente}
          onRegistrado={trasRegistrar}
        />
      ) : null}
    </section>
  );
}
