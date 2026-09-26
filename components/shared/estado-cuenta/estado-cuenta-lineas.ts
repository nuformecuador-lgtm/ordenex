import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";

import { PANEL_TEXTO, textoRegistro } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import { METODO_LABEL } from "@/lib/constants/metodo-pago-label";

import type { LineaEstadoCuenta } from "./estado-cuenta-descarga-columnas";
import { ESTADO_CUENTA_TEXTO, textoAnulado } from "./estado-cuenta-labels";

// FICHA 458-D (T D.1/T D.6, design §3.2; R19–R25, R32) — de la fila del SERVIDOR a la línea que se VE
// (y se descarga). Módulo PURO: no convierte montos (llegan STRING y salen STRING) y no decide ningún
// estado: «anulado», el saldo corrido y el chip los decidió el servidor (R21, R71).

/**
 * Los rótulos de UNA superficie: el diccionario de conceptos y de orígenes de su libro (desde Ordenex
 * en la oficina). Los pone la página —`lib/` no importa textos de `app/`—, así que este módulo sirve a
 * los tres libros sin conocer ninguno.
 */
export interface RotulosEstadoCuenta {
  /** El nombre del concepto de la fila (desde Ordenex). */
  concepto: (fila: FilaEstadoCuentaDTO) => string;
  /** El origen legible de la fila, o `null` si no aplica. Nunca un identificador. */
  origen: (fila: FilaEstadoCuentaDTO) => string | null;
}

/**
 * FICHA 458-D (R6–R8) — el origen de la fila con su ENTIDAD, tal como lo compuso el servidor
 * (`fila.origen.texto`: «Cierre del día · 2026-09-12 · Juan Pérez»); sin él (una fila de bodega, un
 * doble de test), el rótulo del diccionario de la superficie. Nunca un identificador.
 */
export function origenDeFila(fila: FilaEstadoCuentaDTO, rotulos: RotulosEstadoCuenta): string | null {
  return fila.origen?.texto ?? rotulos.origen(fila);
}

/** FICHA 458-D — el método y la referencia del pago de la fila, en palabras; `null` si no es un pago. */
export function pagoDeFila(fila: FilaEstadoCuentaDTO): string | null {
  if (fila.pago === null) return null;
  return PANEL_TEXTO.comoTexto(METODO_LABEL[fila.pago.metodo], fila.pago.referencia);
}

/** R25 — la leyenda del estado de UNA fila: anulada (con quién, cuándo y por qué), anulación, o nada. */
export function estadoDeFila(fila: FilaEstadoCuentaDTO): string | null {
  if (fila.anulacion !== null) return textoAnulado(fila.anulacion);
  if (fila.esContraAsiento) return ESTADO_CUENTA_TEXTO.anulacion;
  return null;
}

/** R20 — la línea del saldo inicial, arriba del extracto. */
export function lineaSaldoInicial(estado: EstadoCuentaDTO, desde: string): LineaEstadoCuenta {
  return {
    fecha: desde,
    movimiento: desde === "" ? ESTADO_CUENTA_TEXTO.saldoInicialSinPeriodo : ESTADO_CUENTA_TEXTO.saldoInicial,
    motivo: null,
    origen: null,
    pago: null,
    registro: null,
    cargo: null,
    abono: null,
    saldo: estado.saldoInicial,
    estado: null,
  };
}

/** R19 — la línea de UN movimiento. */
export function lineaDeFila(fila: FilaEstadoCuentaDTO, rotulos: RotulosEstadoCuenta): LineaEstadoCuenta {
  return {
    fecha: fila.fecha,
    movimiento: rotulos.concepto(fila),
    motivo: fila.descripcion,
    origen: origenDeFila(fila, rotulos),
    pago: pagoDeFila(fila),
    registro: textoRegistro(fila.registro),
    cargo: fila.cargo,
    abono: fila.abono,
    saldo: fila.saldoCorrido,
    estado: estadoDeFila(fila),
  };
}
