"use client";

import { EstadoCuenta, type PanelDeLaSuperficie } from "@/components/shared/estado-cuenta/EstadoCuenta";
import { SelectorCierreDeCuenta } from "@/components/shared/estado-cuenta/SelectorCierreDeCuenta";
import type { RotulosEstadoCuenta } from "@/components/shared/estado-cuenta/estado-cuenta-lineas";
import { AMBITO_DESCARGA_ESTADO_CUENTA_TIENDA } from "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas";
import { COBRO_RECHAZO_TEXTO } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";

import { DetalleMovimientoCierre } from "../../_components/DetalleMovimientoCierre";
import { DETALLE_MOVIMIENTO_NOMBRE } from "../../_components/detalle-movimiento-labels";
import { fuenteOrdenesDeFila } from "../../_components/ordenes-de-fila-cuenta";

import { EstadoCuentaAcciones } from "./EstadoCuentaAcciones";
import { PagosTiendaEstadoCuenta } from "./PagosTiendaEstadoCuenta";
import { CATEGORIA_TIENDA_LABEL, ORIGEN_TIENDA_LABEL } from "./desglose-tienda-labels";
import { DETALLE_DESCARGA_WALLET_TIENDA } from "./estado-cuenta-tienda-descarga-columnas";

// FICHA 458-D (T D.2, design §5; R17–R28, R30) — el estado de cuenta de UNA tienda, visto DESDE ORDENEX.
// Aquí vive lo propio de la superficie: los diccionarios de la 461 (concepto desde Ordenex y origen) y
// las acciones de la cuenta. El resto —tarjetas, chips, periodo, extracto, «Ver», descarga— es el
// módulo compartido (`components/shared/estado-cuenta/`).

function categoria(f: FilaEstadoCuentaDTO): WalletTiendaMovimientoCategoria {
  return f.categoria as WalletTiendaMovimientoCategoria;
}

/** Las dos líneas del cobro por rechazo (origen `gestion_orden`): un CARGO, dicho en palabras (R100). */
function esCobroPorRechazo(f: FilaEstadoCuentaDTO): boolean {
  const c = categoria(f);
  return (c === "flete_devolucion" || c === "iva_flete_devolucion") && f.origenTipo === "gestion_orden";
}

/** Las filas cuyo comprobante es LATERAL y se puede adjuntar después (R79): el cobro y el pago 172. */
const ADMITE_ADJUNTAR: ReadonlySet<WalletTiendaMovimientoCategoria> = new Set(["cobro_manual", "pago_tienda"]);

export const ROTULOS_TIENDA: RotulosEstadoCuenta = {
  concepto: (f) => CATEGORIA_TIENDA_LABEL[categoria(f)] ?? f.categoria,
  origen: (f) => ORIGEN_TIENDA_LABEL[f.origenTipo as WalletOrigenTipo] ?? null,
};

export const PANEL_TIENDA: PanelDeLaSuperficie = {
  nombreParaAnular: (f) => `«${ROTULOS_TIENDA.concepto(f)}»`,
  admiteAdjuntar: (f) => ADMITE_ADJUNTAR.has(categoria(f)),
  nota: (f) =>
    esCobroPorRechazo(f) ? (f.anulacion !== null ? COBRO_RECHAZO_TEXTO.anulado : COBRO_RECHAZO_TEXTO.vigente) : null,
};

export interface EstadoCuentaTiendaProps {
  inicial: EstadoCuentaDTO;
  /** R82 — lo decide el servidor (`esAccesoTotal`); sin permiso no se ofrece ninguna acción. */
  puedeRegistrar: boolean;
}

export function EstadoCuentaTienda({ inicial, puedeRegistrar }: Readonly<EstadoCuentaTiendaProps>) {
  const tiendaId = inicial.cuenta.id;
  return (
    <EstadoCuenta
      inicial={inicial}
      rotulos={ROTULOS_TIENDA}
      panel={PANEL_TIENDA}
      // FICHA 464 (R1/R2/R6) — su selector de columnas y la hoja «Detalle por orden» de esta tienda.
      descargaDeLaSuperficie={{
        ambitoColumnas: AMBITO_DESCARGA_ESTADO_CUENTA_TIENDA,
        detalle: DETALLE_DESCARGA_WALLET_TIENDA,
      }}
      // R10–R12 — el filtro por cierre de ESTA tienda (la 458-A); el cierre viaja, no se pinta.
      selectorCierre={(valor, onCambiar) => (
        <SelectorCierreDeCuenta cuenta={{ cuenta: "tienda", tiendaId }} valor={valor} onCambiar={onCambiar} />
      )}
      // R19 (344/345) — las órdenes de ESTA tienda que componen el importe de una fila de cierre.
      detalleDeFila={{
        nombre: ({ concepto, fecha }) => DETALLE_MOVIMIENTO_NOMBRE.abrir(concepto, fecha),
        // FICHA 469 (R25–R28): `resaltar` solo llega con la lectura pintada en modo guía.
        render: (f, { concepto, fecha, resaltar }) =>
          f.ref !== null && "movimientoId" in f.ref ? (
            <DetalleMovimientoCierre
              movimientoId={f.ref.movimientoId}
              concepto={concepto}
              fecha={fecha}
              fuente={fuenteOrdenesDeFila({ tipo: "tienda", id: tiendaId })}
              resaltar={resaltar}
            />
          ) : null,
      }}
      acciones={
        puedeRegistrar ? (vigente, refrescar) => <EstadoCuentaAcciones estado={vigente} onCambio={refrescar} /> : undefined
      }
      pie={(vigente, refrescar) => (
        <PagosTiendaEstadoCuenta
          tiendaId={vigente.cuenta.id}
          tiendaNombre={vigente.cuenta.nombre}
          puedeAnular={puedeRegistrar}
          onCambio={refrescar}
        />
      )}
    />
  );
}
