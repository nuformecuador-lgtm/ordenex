"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { PagosRegistradosTabla } from "@/components/shared/liquidacion/PagosRegistradosTabla";
import { RegistrarPagoDialog } from "@/components/shared/liquidacion/RegistrarPagoDialog";
import {
  PAGOS_REGISTRADOS_TEXTO,
  REGISTRAR_PAGO_TEXTO,
} from "@/components/shared/liquidacion/liquidacion-labels";
import type { RegistrarPagoCampos } from "@/components/shared/liquidacion/RegistrarPagoDialog";
import { useToast } from "@/hooks/useToast";
import { listarPagosDeTiendaAction, registrarPagoTiendaAction } from "@/lib/actions/liquidacion";
import type { PagoRegistradoDTO } from "@/lib/types/liquidacion";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";

import { claveDesgloseTienda } from "./DesgloseMovimientosTienda";

// Feature 172 (T D.3, design §10.1) — el CABLEADO del pago a una tienda. Se monta en el hueco
// `acciones` que la 171 dejó preparado en la cabecera del desglose (R45 de aquella), así que
// esta feature NO toca una línea de `DesgloseMovimientosTienda`: R34 pide conservar la tabla
// de saldos y el desglose exactamente como están, y la forma más barata de garantizarlo es no
// editarlos.
//
// Aquí viven las dos mitades que la pantalla añade: el botón que abre el diálogo compartido y
// la LISTA DE COMPROBANTES de esta tienda (R50), con su propia clave de SWR.
//
// REFRESCO DIRIGIDO (R33): tras registrar se invalidan EXACTAMENTE dos claves, las dos de
// ESTA tienda — la del desglose (`claveDesgloseTienda`, que la 171 exportó para esto) y la de
// su lista de comprobantes. Un `mutate()` sin argumentos refrescaría también los desgloses de
// las demás tiendas abiertas, que es lo que R33 prohíbe: cada fila abierta cuesta una
// consulta, y pagar a una tienda no es motivo para volver a leer las otras.
//
// El `mutate` sale de `useSWRConfig()` y no del export global del módulo `swr`: aquel está
// atado a la caché por defecto, y esta pantalla puede vivir bajo un `SWRConfig` con caché
// propia. Con el del contexto, el refresco alcanza siempre a la caché en la que de verdad
// están los datos.

/** Prefijo de la clave SWR de la lista de comprobantes. Identifica esta lectura entre todas. */
const CLAVE_PAGOS_TIENDA = "liquidacion:pagos-tienda";

/**
 * Clave SWR de los comprobantes de UNA tienda. Exportada por el mismo motivo que
 * `claveDesgloseTienda`: es lo que permite refrescar esta lista —y solo esta— desde fuera.
 */
export function clavePagosDeTienda(tiendaId: string): readonly [string, string] {
  return [CLAVE_PAGOS_TIENDA, tiendaId] as const;
}

const PAGO_TIENDA_TEXTO = {
  /** R32: sin saldo a favor no hay nada que pagar, y la pantalla lo dice en vez de callar. */
  sinSaldo: "Esta tienda no tiene saldo a favor: no hay nada que pagar.",
  registrado: (monto: string) => `Pago de ₡${monto} registrado.`,
} as const;

/** Fetcher: pide los comprobantes y traduce un status != ok a un throw (SWR lo marca error). */
async function leerPagos(tiendaId: string): Promise<PagoRegistradoDTO[]> {
  const res = await listarPagosDeTiendaAction({ tiendaId });
  if (res.status !== "ok") throw new Error(res.status);
  return res.pagos;
}

export interface PagoTiendaAccionesProps {
  /**
   * La fila de la tabla de saldos: `tiendaId`, `tiendaNombre` y su saldo agregado. El saldo
   * es el STRING que devolvió el servidor y es lo que prefija el monto del diálogo (R30);
   * aquí no se opera con él, solo se pasa.
   */
  resumen: SaldoTiendaResumenDTO;
}

export function PagoTiendaAcciones({ resumen }: PagoTiendaAccionesProps) {
  const { tiendaId, tiendaNombre, saldo, signo } = resumen;
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);

  const { data, error, isLoading } = useSWR(clavePagosDeTienda(tiendaId), () =>
    leerPagos(tiendaId),
  );

  const hayQuePagar = signo === "positivo";

  async function registrar(campos: RegistrarPagoCampos) {
    return registrarPagoTiendaAction({ ...campos, tiendaId });
  }

  async function trasRegistrar(pago: PagoRegistradoDTO) {
    toast.success(PAGO_TIENDA_TEXTO.registrado(pago.monto));
    // R33 — las dos claves de ESTA tienda, ninguna más.
    await Promise.all([
      mutate(claveDesgloseTienda(tiendaId)),
      mutate(clavePagosDeTienda(tiendaId)),
    ]);
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setAbierto(true)} disabled={!hayQuePagar}>
          {REGISTRAR_PAGO_TEXTO.abrir}
        </Button>
        {hayQuePagar ? null : (
          <span className="text-sm text-muted-foreground">
            {PAGO_TIENDA_TEXTO.sinSaldo}
          </span>
        )}
      </div>

      {/* R50 — los comprobantes de esta tienda, dentro de su propio desglose. */}
      <PagosRegistradosTabla
        pagos={data ?? []}
        beneficiario={tiendaNombre}
        isLoading={isLoading}
        error={error ? PAGOS_REGISTRADOS_TEXTO.error : null}
      />

      {/* El diálogo solo se monta si alguien puede pagar: sin saldo no hay nada que abrir. */}
      {hayQuePagar ? (
        <RegistrarPagoDialog
          open={abierto}
          onOpenChange={setAbierto}
          beneficiario={tiendaNombre}
          disponible={saldo}
          onRegistrar={registrar}
          onRegistrado={trasRegistrar}
        />
      ) : null}
    </div>
  );
}
