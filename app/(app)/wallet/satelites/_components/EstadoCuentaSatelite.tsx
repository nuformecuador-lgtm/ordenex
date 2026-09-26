"use client";

import { EstadoCuenta } from "@/components/shared/estado-cuenta/EstadoCuenta";
import type { RotulosEstadoCuenta } from "@/components/shared/estado-cuenta/estado-cuenta-lineas";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";

import { ConciliacionSatelite } from "./ConciliacionSatelite";
import { ESTADO_CUENTA_BODEGA_PAGINA } from "./satelites-labels";

// FICHA 458-D (T D.4, design §3.2/§5; R17–R24, R31) — el estado de cuenta de UNA bodega satélite: el
// extracto «Declarado / Recibido» con lo que tiene por entregar tras cada movimiento (el corrido lo
// calcula la base, R21) y, debajo, la CONCILIACIÓN de hoy (R31): marcar y desmarcar lo recibido con su
// mismo efecto y sus mismos textos. Tras marcar o desmarcar se relee el estado de cuenta de ESTA bodega
// (R30) y el listado de bodegas. La bodega no tiene filas de libro: no hay «Ver» ni «Anular…».

/** El nombre de cada fila de la bodega, por su chip (que el servidor decide: «declarado» / «recibido»). */
const CONCEPTO_BODEGA: Readonly<Record<string, string>> = {
  declarado: ESTADO_CUENTA_BODEGA_PAGINA.declarado,
  recibido: ESTADO_CUENTA_BODEGA_PAGINA.recibido,
};

export const ROTULOS_BODEGA: RotulosEstadoCuenta = {
  concepto: (f) => CONCEPTO_BODEGA[f.chip] ?? ESTADO_CUENTA_BODEGA_PAGINA.declarado,
  origen: () => null,
};

export interface EstadoCuentaSateliteProps {
  inicial: EstadoCuentaDTO;
  /** R27 de la 431 — lo decide el servidor (`esAccesoTotal`). */
  puedeConciliar: boolean;
}

export function EstadoCuentaSatelite({ inicial, puedeConciliar }: Readonly<EstadoCuentaSateliteProps>) {
  return (
    <EstadoCuenta
      inicial={inicial}
      rotulos={ROTULOS_BODEGA}
      pie={(vigente, refrescar) => (
        <ConciliacionSatelite
          bodega={{ zonaId: vigente.cuenta.id, zonaNombre: vigente.cuenta.nombre }}
          pendiente={vigente.saldoActual}
          puedeConciliar={puedeConciliar}
          onCambio={refrescar}
        />
      )}
    />
  );
}
