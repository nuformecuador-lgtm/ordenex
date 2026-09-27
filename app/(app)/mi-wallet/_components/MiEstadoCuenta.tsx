"use client";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EstadoCuenta, type LectorEstadoCuenta } from "@/components/shared/estado-cuenta/EstadoCuenta";
import type { RotulosEstadoCuenta } from "@/components/shared/estado-cuenta/estado-cuenta-lineas";
import { verMiEstadoCuentaAction, verMiEstadoCuentaCompletoAction } from "@/lib/actions/estado-cuenta";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";

import { DetalleMiMovimientoCierre } from "./DetalleMiMovimientoCierre";
import { ResumenMiWallet } from "./ResumenMiWallet";
import { CATEGORIAS_CON_COMPROBANTE, VerComprobanteMiMovimiento } from "./VerComprobanteMiMovimiento";
import { DETALLE_MI_MOVIMIENTO_NOMBRE } from "./detalle-mi-movimiento-labels";
import { MI_ESTADO_CUENTA_TEXTO, textoAnuladoMiWallet } from "./mi-estado-cuenta-labels";
import { opcionesDeCierre, type CierresDeLaTienda } from "./mi-wallet-cierres";
// Ficha 461 (R44, P4): la tienda lee su libro DESDE LA TIENDA («Ordenex te cobró»), no con el nombre
// desde Ordenex que ve la oficina en `/wallet/tiendas`.
import { CATEGORIA_MI_WALLET_LABEL, ORIGEN_TIENDA_LABEL } from "./mi-wallet-labels";

// FICHA 458-D (T D.5, design §5; R34–R36, R78, R19) — `/mi-wallet` como ESTADO DE CUENTA de la propia
// tienda, en SOLO LECTURA: el MISMO módulo que ve la oficina (tarjetas con la frase del saldo, chips,
// periodo, saldo inicial arriba y saldo corrido de la cuenta entera, anulados tachados con su motivo),
// leído por `verMiEstadoCuentaAction` —la tienda es la de la SESIÓN, resuelta en el servidor: aquí no
// viaja ninguna clave de cuenta (R36)— y dicho desde la tienda (la 461 §7.5 y la 457).
//
// Lo propio de esta superficie:
//  - sin acciones, sin «Ver» con «Anular…» y sin adjuntar (R35): la única acción por fila es ver el
//    comprobante que subió Ordenex (R78), por el destino de SU fila;
//  - sin los nombres de la gente de Ordenex: el servidor no los manda (`registro` vacío, `anulacion.por`
//    nulo) y la pantalla no pinta la línea «Registró» (`vista="tienda"`);
//  - su selector de cierre de siempre (335: día y número de movimientos, sin el mensajero, R10), con
//    las opciones leídas en el servidor;
//  - las filas de cierre despliegan SUS órdenes con el panel de la 344 (`DetalleMiMovimientoCierre`).

/** La lectura de la tienda de la sesión: ningún id de tienda sale del navegador (R36). */
export const LECTOR_MI_TIENDA: LectorEstadoCuenta = {
  leer: (f) => verMiEstadoCuentaAction(f),
  leerCompleto: (f) => verMiEstadoCuentaCompletoAction(f),
};

function categoria(f: FilaEstadoCuentaDTO): WalletTiendaMovimientoCategoria {
  return f.categoria as WalletTiendaMovimientoCategoria;
}

export const ROTULOS_MI_WALLET: RotulosEstadoCuenta = {
  concepto: (f) => CATEGORIA_MI_WALLET_LABEL[categoria(f)] ?? f.categoria,
  origen: (f) => ORIGEN_TIENDA_LABEL[f.origenTipo as WalletOrigenTipo] ?? null,
  // R25 (decisión del leader, revisión m3): «Anulado por Ordenex», día y hora de Costa Rica y motivo.
  anulado: textoAnuladoMiWallet,
};

/** R10 (335) — el selector de cierre de la tienda, con las opciones que ya leyó el servidor. */
function SelectorMiCierre({
  cierres,
  valor,
  onCambiar,
}: {
  cierres: CierresDeLaTienda;
  valor: string | null;
  onCambiar: (cierreId: string | null) => void;
}) {
  const sinCierres = cierres.opciones.length === 0;
  // Sin cierres que ofrecer, el control no se esconde: se deshabilita y el texto de debajo dice por qué.
  const aviso = !cierres.disponible
    ? MI_ESTADO_CUENTA_TEXTO.cierresNoDisponibles
    : sinCierres
      ? MI_ESTADO_CUENTA_TEXTO.sinCierres
      : cierres.hayMas
        ? MI_ESTADO_CUENTA_TEXTO.cierresRecientes
        : null;
  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto">
      <Label htmlFor="mi-wallet-filtro-cierre">{MI_ESTADO_CUENTA_TEXTO.cierre}</Label>
      <Select
        id="mi-wallet-filtro-cierre"
        aria-label={MI_ESTADO_CUENTA_TEXTO.filtrarPorCierre}
        value={valor ?? ""}
        onValueChange={(v) => onCambiar(v === "" ? null : v)}
        options={opcionesDeCierre(cierres.opciones)}
        placeholder={MI_ESTADO_CUENTA_TEXTO.todosLosCierres}
        disabled={sinCierres}
        className="h-9 w-full sm:w-72"
      />
      {aviso ? <span className="text-xs text-muted-foreground">{aviso}</span> : null}
    </div>
  );
}

export interface MiEstadoCuentaProps {
  /** La primera página, leída en el servidor con la tienda de la sesión. */
  inicial: EstadoCuentaDTO;
  /**
   * Ficha 335 — el catálogo de cierres del selector, YA leído en el servidor. Requerido y sin
   * default: que la inyección la garantice el compilador.
   */
  cierres: CierresDeLaTienda;
}

export function MiEstadoCuenta({ inicial, cierres }: Readonly<MiEstadoCuentaProps>) {
  return (
    // 172 R55 (cierre de la 458-D) — el resumen de tres cifras ENCIMA de las tarjetas, hermano de ellas
    // (nunca dentro). Es de la cuenta ENTERA, pero se pinta con la lectura VIGENTE (revisión m1): cada
    // lectura de la tienda lo trae, así que si el saldo cambió entre dos lecturas (un cierre aprobado con
    // la pantalla abierta) el resumen y la tarjeta «Saldo actual» cambian juntos. Sin resumen (no debería
    // pasar en la vista de la tienda), el estado de cuenta sigue en pie.
    <div className="flex flex-col gap-6">
      <EstadoCuenta
        encabezado={(vigente) => (vigente.resumen === null ? null : <ResumenMiWallet resumen={vigente.resumen} />)}
        inicial={inicial}
        rotulos={ROTULOS_MI_WALLET}
        lector={LECTOR_MI_TIENDA}
        vista="tienda"
        selectorCierre={(valor, onCambiar) => <SelectorMiCierre cierres={cierres} valor={valor} onCambiar={onCambiar} />}
        detalleDeFila={{
          nombre: ({ concepto, fecha }) => DETALLE_MI_MOVIMIENTO_NOMBRE.abrir(concepto, fecha),
          render: (f, { concepto, fecha }) =>
            f.ref !== null && "movimientoId" in f.ref ? (
              <DetalleMiMovimientoCierre movimientoId={f.ref.movimientoId} concepto={concepto} fecha={fecha} />
            ) : null,
        }}
        accionDeFila={{
          titulo: MI_ESTADO_CUENTA_TEXTO.comprobante,
          render: (f) =>
            CATEGORIAS_CON_COMPROBANTE.has(categoria(f)) && f.ref !== null && "movimientoId" in f.ref ? (
              <VerComprobanteMiMovimiento
                movimientoId={f.ref.movimientoId}
                concepto={ROTULOS_MI_WALLET.concepto(f)}
                fecha={f.fecha}
              />
            ) : null,
        }}
      />
    </div>
  );
}
