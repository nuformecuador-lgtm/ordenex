// Feature 184 — analitica financiera: export de la serie (T1.1). FIXTURES DEL DTO FINANCIERO.
//
// NO acaba en `.test.ts`: vitest no lo recoge como suite.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con nombre, no solo con numero.
//
// LAS CUATRO FORMAS que la feature necesita, y por que hacen falta las cuatro:
//
//  (a) vista TEMPORAL `bruto_y_neto` de FLUJO      -> el caso normal (R13, R19, R20);
//  (b) vista TEMPORAL `solo_bruto`                 -> la columna de neto NO EXISTE (R13);
//  (c) vista TEMPORAL ACUMULADA                    -> «saldo al corte», no flujo (R16);
//  (d) vista NO TEMPORAL con cubos CON FORMA DE UUID -> el caso de R12/D1.
//
// (d) TRAE UUIDS DE VERDAD A PROPOSITO (§9.1 T-B del design): una fixture con cubos ya inocuos
// —fechas en todos los casos— daria un verde gratuito, porque el archivo saldria limpio aunque
// la exclusion de las vistas no temporales se hubiera roto. Con uuids literales, el mismo uuid
// se puede buscar en el texto del archivo, o comprobarse que NO HAY archivo.
//
// La forma del DTO NO se escribe a mano: se compone con `tests/fixtures/dto-financiero-servido.ts`,
// que la DERIVA de las mismas funciones puras que el servicio usa (`resolverRango`, `trocear`,
// `granularidadDe`, `esMetricaAcumulada`) y que ademas esta ATADO por ejecucion a la salida real
// del servicio en `tests/unit/guards/tablero-doble-vs-servicio.guardia.test.ts`. Declarar aqui un
// DTO libre recrearia exactamente el fallo que aquel modulo existe para cerrar: una fixture que
// describe un mundo que el servicio ya no produce.

import type {
  FilaFinanciera,
  RangoFinanciero,
  ResultadoFinancieroVistas,
} from "@/lib/types/analitica-financiera";
import {
  importeConNeto,
  importeSoloBruto,
} from "@/tests/fixtures/importe-analitico";
import {
  cubosDelRango,
  dtoNoTemporalServido,
  dtoTemporalServido,
  granularidadDelRango,
  RANGO_TABLERO,
} from "@/tests/fixtures/dto-financiero-servido";

/** Moneda de fixture: distinta de la de produccion, para que un codigo escrito a mano falle. */
export const MONEDA_DE_FIXTURE = "MONEDA-DE-FIXTURE";

/**
 * Rango LARGO: por encima de `TOPE_PUNTOS_SERIE`, asi que `granularidadDe` decide `semana`.
 *
 * No se escribe la granularidad: se elige un rango que la PRODUCE, igual que haria el servidor.
 * Asi el caso de R15 compara dos granos que salieron del mismo camino que en produccion.
 */
export const RANGO_LARGO: RangoFinanciero = {
  desdeFecha: "2026-05-01",
  hastaFecha: "2026-08-03",
};

/** El grano que el servidor decide para un rango dado. Se DERIVA, no se escribe. */
export function granoDe(rango: RangoFinanciero = RANGO_TABLERO): string {
  return granularidadDelRango(rango);
}

/** Las claves de cubo de la serie densa de un rango, en su orden. */
export function cubosDe(rango: RangoFinanciero = RANGO_TABLERO): readonly string[] {
  return cubosDelRango(rango);
}

/**
 * (a) Vista TEMPORAL cuyos importes publican los DOS campos, de una metrica de FLUJO.
 *
 * Las cifras llevan CENTINELAS por fila (el indice va dentro del importe) para que una fila
 * duplicada, reordenada o rellenada se vea en el archivo.
 */
export function dtoTemporalConNeto(
  rango: RangoFinanciero = RANGO_TABLERO,
): ResultadoFinancieroVistas {
  return dtoTemporalServido(
    "egresos",
    "Egresos",
    (indice) => importeConNeto(`${1000 + indice}.10`, `${900 + indice}.20`, MONEDA_DE_FIXTURE),
    importeConNeto("99999.10", "88888.20", MONEDA_DE_FIXTURE),
    rango,
  );
}

/** (b) Vista TEMPORAL `solo_bruto`: su importe NO lleva `neto` ni siquiera en `null`. */
export function dtoTemporalSoloBruto(
  rango: RangoFinanciero = RANGO_TABLERO,
): ResultadoFinancieroVistas {
  return dtoTemporalServido(
    "ingreso_flete",
    "Ingreso por flete",
    (indice) => importeSoloBruto(`${2000 + indice}.30`, MONEDA_DE_FIXTURE),
    importeSoloBruto("77777.30", MONEDA_DE_FIXTURE),
    rango,
  );
}

/**
 * (c) Vista TEMPORAL de una metrica ACUMULADA: cada fila es un saldo al corte.
 *
 * `esAcumulado` lo deriva `esMetricaAcumulada` dentro de `dtoTemporalServido`, no un booleano
 * suelto escrito aqui: es el mismo camino del servicio.
 */
export function dtoTemporalAcumulado(
  rango: RangoFinanciero = RANGO_TABLERO,
): ResultadoFinancieroVistas {
  return dtoTemporalServido(
    "cuenta_por_pagar_mensajero",
    "Cuenta por pagar a mensajeros",
    (indice) => importeConNeto(`${3000 + indice}.40`, `${2900 + indice}.50`, MONEDA_DE_FIXTURE),
    importeConNeto("66666.40", "55555.50", MONEDA_DE_FIXTURE),
    rango,
  );
}

/**
 * Los cubos de (d): UUIDS DE VERDAD, buscables literalmente en el texto de un archivo.
 *
 * Es el punto entero de la fixture. Ver §9.1 T-B del design.
 */
export const CUBOS_CON_FORMA_DE_UUID = [
  "3f8c1a2b-4d5e-4f60-9a71-8b2c3d4e5f60",
  "7a1b2c3d-4e5f-4061-8273-9c0d1e2f3a4b",
] as const;

/** (d) Vista NO TEMPORAL cuyos cubos son identificadores crudos con forma de uuid. */
export function dtoNoTemporalConUuids(): ResultadoFinancieroVistas {
  const filas: readonly FilaFinanciera[] = CUBOS_CON_FORMA_DE_UUID.map((cubo, indice) => ({
    cubo,
    importe: importeConNeto(`${4000 + indice}.60`, `${3900 + indice}.70`, MONEDA_DE_FIXTURE),
  }));

  return dtoNoTemporalServido("cuenta_por_pagar_tienda", "Cuenta por pagar a tiendas", [
    { filas, total: importeConNeto("44444.60", "33333.70", MONEDA_DE_FIXTURE) },
  ]);
}

/** El id de la unica vista de un DTO de vistas. Evita escribir el id a mano en cada caso. */
export function idDeLaUnicaVista(datos: ResultadoFinancieroVistas): string {
  const [vista] = datos.vistas;
  if (vista === undefined) throw new Error("la fixture no publica ninguna vista");
  return vista.id;
}
