"use client";

import { EstadoCuenta, type PanelDeLaSuperficie } from "@/components/shared/estado-cuenta/EstadoCuenta";
import { SelectorCierreDeCuenta } from "@/components/shared/estado-cuenta/SelectorCierreDeCuenta";
import type { RotulosEstadoCuenta } from "@/components/shared/estado-cuenta/estado-cuenta-lineas";
import { AMBITO_DESCARGA_ESTADO_CUENTA_MENSAJERO } from "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type { PagoMensajeroMovimientoCategoria } from "@/lib/types/wallet-mensajero";

import { DetalleMovimientoCierre } from "../../_components/DetalleMovimientoCierre";
import { DETALLE_MOVIMIENTO_NOMBRE } from "../../_components/detalle-movimiento-labels";
import { fuenteOrdenesDeFila } from "../../_components/ordenes-de-fila-cuenta";

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
  const mensajeroId = inicial.cuenta.id;
  return (
    <EstadoCuenta
      inicial={inicial}
      rotulos={ROTULOS_MENSAJERO}
      panel={PANEL_MENSAJERO}
      // FICHA 464 (R1/R2/R7) — solo el selector de columnas: el pago al mensajero es un total del cierre,
      // sin reparto por orden, así que aquí no hay hoja de detalle.
      descargaDeLaSuperficie={{ ambitoColumnas: AMBITO_DESCARGA_ESTADO_CUENTA_MENSAJERO }}
      // R10–R12 — el filtro por cierre de ESTE mensajero (la 458-A); el cierre viaja, no se pinta.
      selectorCierre={(valor, onCambiar) => (
        <SelectorCierreDeCuenta cuenta={{ cuenta: "mensajero", mensajeroId }} valor={valor} onCambiar={onCambiar} />
      )}
      // R19 — su fila de cierre se abre igual: el pago del mensajero es un total que el cierre dejó
      // anotado (`sin_reparto: snapshot_del_cierre`), y el panel lo dice en palabras; el enlace a SU
      // cierre es el del origen de la fila.
      detalleDeFila={{
        nombre: ({ concepto, fecha }) => DETALLE_MOVIMIENTO_NOMBRE.abrir(concepto, fecha),
        render: (f, { concepto, fecha }) =>
          f.ref !== null && "movimientoId" in f.ref ? (
            <DetalleMovimientoCierre
              movimientoId={f.ref.movimientoId}
              concepto={concepto}
              fecha={fecha}
              fuente={fuenteOrdenesDeFila({ tipo: "mensajero", id: mensajeroId })}
            />
          ) : null,
      }}
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
