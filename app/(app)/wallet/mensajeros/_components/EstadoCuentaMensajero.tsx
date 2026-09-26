"use client";

import { EstadoCuenta, type PanelDeLaSuperficie } from "@/components/shared/estado-cuenta/EstadoCuenta";
import type { RotulosEstadoCuenta } from "@/components/shared/estado-cuenta/estado-cuenta-lineas";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type { PagoMensajeroMovimientoCategoria } from "@/lib/types/wallet-mensajero";

import { PagoMensajeroAcciones } from "./PagoMensajeroAcciones";
import { ESTADO_CUENTA_MENSAJERO_PAGINA } from "./estado-cuenta-mensajero-labels";
import { CATEGORIA_PAGO_LABEL, ORIGEN_PAGO_LABEL } from "./wallet-mensajeros-labels";

// FICHA 458-D (T D.3, design §5; R17–R25, R29, R30, R70) — el estado de cuenta de UN mensajero, visto
// desde Ordenex. Lo propio de la superficie: sus diccionarios y sus acciones.
//
//  - «Ordenex le paga al mensajero» (R29): el reparto de la 205 con su previsualización de hoy, sin
//    cambiar una línea (`PagoMensajeroAcciones`); tras registrar se relee ESTA cuenta (R30).
//  - «Anular…» de un pago (R70, P6): desde el panel «Ver» de su fila. `anularMovimientoAction` enruta el
//    pago (`liquidacion_pago`) a `anularPagoAction`, la MISMA acción de servidor que usa
//    `/cierres-admin` (que no cambia), con el mismo efecto: el pago vuelve a quedar por pagar.

function categoria(f: FilaEstadoCuentaDTO): PagoMensajeroMovimientoCategoria {
  return f.categoria as PagoMensajeroMovimientoCategoria;
}

export const ROTULOS_MENSAJERO: RotulosEstadoCuenta = {
  concepto: (f) => CATEGORIA_PAGO_LABEL[categoria(f)] ?? f.categoria,
  origen: (f) => ORIGEN_PAGO_LABEL[f.origenTipo as WalletOrigenTipo] ?? null,
};

export const PANEL_MENSAJERO: PanelDeLaSuperficie = {
  nombreParaAnular: (f) => `«${ROTULOS_MENSAJERO.concepto(f)}»`,
  // El pago de Ordenex al mensajero lleva su comprobante LATERAL (`liquidacion_pago`, R79).
  admiteAdjuntar: (f) => categoria(f) === "liquidacion",
};

export interface EstadoCuentaMensajeroProps {
  inicial: EstadoCuentaDTO;
  /** R82 — lo decide el servidor (`esAccesoTotal`). */
  puedeRegistrar: boolean;
}

export function EstadoCuentaMensajero({ inicial, puedeRegistrar }: Readonly<EstadoCuentaMensajeroProps>) {
  return (
    <EstadoCuenta
      inicial={inicial}
      rotulos={ROTULOS_MENSAJERO}
      panel={PANEL_MENSAJERO}
      acciones={
        puedeRegistrar
          ? (vigente, refrescar) => (
              <>
                <PagoMensajeroAcciones
                  resumen={{ mensajeroId: vigente.cuenta.id, mensajeroNombre: vigente.cuenta.nombre }}
                  onRegistrado={refrescar}
                />
                <p className="text-sm text-muted-foreground">{ESTADO_CUENTA_MENSAJERO_PAGINA.anularNota}</p>
              </>
            )
          : undefined
      }
    />
  );
}
