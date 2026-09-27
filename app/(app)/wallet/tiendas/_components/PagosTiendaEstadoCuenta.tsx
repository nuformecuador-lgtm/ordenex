"use client";

import useSWR, { useSWRConfig } from "swr";

import type { PagoAnuladoOk } from "@/components/shared/liquidacion/AnularPagoDialog";
import { PAGOS_REGISTRADOS_TEXTO } from "@/components/shared/liquidacion/liquidacion-labels";
import { PagosRegistradosTabla } from "@/components/shared/liquidacion/PagosRegistradosTabla";
import { useToast } from "@/hooks/useToast";
import { anularPagoAction, listarPagosDeTiendaAction } from "@/lib/actions/liquidacion";
import type { AnularPagoResult, PagoRegistradoDTO } from "@/lib/types/liquidacion";

import { PAGOS_TIENDA_TEXTO } from "./estado-cuenta-tienda-labels";

// FICHA 458-D (T D.2/T D.8; 172 R50, R70-R76; 458 R30) — los PAGOS DE ORDENEX A LA TIENDA, con su
// comprobante, su método y su referencia, dentro del ESTADO DE CUENTA de esa tienda.
//
// Vivían en el desglose desplegable (`PagoTiendaAcciones`, retirado con él). Se conservan aquí porque
// dicen lo que el extracto todavía no dice de un pago —el método y la referencia (la fila del estado de
// cuenta no los trae: pendiente de servidor)— y porque su anulación es la de la 172 (`anularPagoAction`,
// la misma de `/cierres-admin`), con su motivo y sin monto.
//
// REFRESCO DIRIGIDO (R30): tras anular se relee la lista de ESTA tienda y su estado de cuenta
// (`onCambio`), nada de otras tiendas.

const CLAVE_PAGOS_TIENDA = "liquidacion:pagos-tienda";

/** Clave SWR de los pagos de UNA tienda. */
export function clavePagosDeTienda(tiendaId: string): readonly [string, string] {
  return [CLAVE_PAGOS_TIENDA, tiendaId] as const;
}

async function leerPagos(tiendaId: string): Promise<PagoRegistradoDTO[]> {
  const res = await listarPagosDeTiendaAction({ tiendaId });
  if (res.status !== "ok") throw new Error(res.status);
  return res.pagos;
}

export interface PagosTiendaEstadoCuentaProps {
  tiendaId: string;
  tiendaNombre: string;
  /** R82 — lo decide el servidor (`esAccesoTotal`). Default `false`: falla cerrado. */
  puedeAnular?: boolean;
  /** R30 — relee el estado de cuenta de ESTA tienda. */
  onCambio?: () => Promise<void>;
}

export function PagosTiendaEstadoCuenta({
  tiendaId,
  tiendaNombre,
  puedeAnular = false,
  onCambio,
}: Readonly<PagosTiendaEstadoCuentaProps>) {
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const { data, error, isLoading } = useSWR(clavePagosDeTienda(tiendaId), () => leerPagos(tiendaId));

  async function anular(pago: PagoRegistradoDTO, motivo: string): Promise<AnularPagoResult> {
    return anularPagoAction({ pagoId: pago.id, motivo });
  }

  async function trasAnular(resultado: PagoAnuladoOk) {
    if (resultado.status === "ok") {
      toast.success(PAGOS_TIENDA_TEXTO.anulado(resultado.restante));
    } else {
      toast.info(PAGOS_TIENDA_TEXTO.yaAnulado);
    }
    await Promise.all([mutate(clavePagosDeTienda(tiendaId)), onCambio?.()]);
  }

  return (
    <section aria-label={PAGOS_TIENDA_TEXTO.seccion(tiendaNombre)} className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{PAGOS_TIENDA_TEXTO.titulo}</h2>
      <PagosRegistradosTabla
        pagos={data ?? []}
        beneficiario={tiendaNombre}
        isLoading={isLoading}
        error={error ? PAGOS_REGISTRADOS_TEXTO.error : null}
        puedeAnular={puedeAnular}
        onAnular={anular}
        onAnulado={trasAnular}
      />
    </section>
  );
}
