// Feature 184 — analitica financiera: export de la serie (T3.1, design §4.1/§4.2).
// EL RECORRIDO: de UNA vista del DTO financiero a las filas del contrato de descarga de la 151.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la **188**. Esta feature se rotula con nombre, no solo con numero.
//
// Modulo PURO: sin React, sin DOM, sin servicio, sin repositorio, sin Prisma y sin dominio de
// servidor. Recorre lo que la Server Action ya devolvio.
//
// LAS COLUMNAS Y LA PROYECCION DE UNA FILA NO VIVEN AQUI, y no es un capricho de reparto: viven
// en `analitica-financiera-descarga-columnas.ts` porque la guardia perenne de la 170 descubre
// las declaraciones de columnas POR CONVENCION DE NOMBRE y prohibe que exista ninguna fuera de
// ella (R26). Aqui queda lo unico que aquel modulo no puede hacer: la SELECCION de la vista y el
// RECORRIDO.
//
// LA SEÑAL DE FORMA NO SE REIMPLEMENTA: `esVistaTemporal` y `esVistaConNeto` se IMPORTAN de
// `../financiero/adaptar`, que es el modulo puro de la region y el unico autorizado a nombrar el
// vocabulario de la granularidad (censo (g) del guardia del tablero). Reescribir aqui cualquiera
// de las dos preguntas crearia un segundo hablante del mismo idioma, que es exactamente como
// «dia» y «semana» acaban siendo el mismo pixel.

import type {
  DescargaColumna,
  DescargaFila,
} from "@/lib/types/descarga";
import type {
  ResultadoFinancieroVistas,
  VistaFinanciera,
} from "@/lib/types/analitica-financiera";

import {
  esVistaConNeto,
  esVistaTemporal,
  type VistaTemporal,
} from "../financiero/adaptar";
import {
  COLUMNAS_DESCARGA_ANALITICA_FINANCIERA,
  COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO,
  filaDescargaAnaliticaFinanciera,
} from "./analitica-financiera-descarga-columnas";

/**
 * La vista pedida dentro del DTO, **solo si es TEMPORAL** (R12 / D1). En cualquier otro caso
 * `null`, y quien llama no produce archivo.
 *
 * POR QUE SOLO LAS TEMPORALES, y es de seguridad y no de alcance: en una vista temporal la clave
 * del cubo es una FECHA POR CONSTRUCCION (R24 de la 180 prohibe ids de persona o de tienda en el
 * DTO del desglose), asi que el archivo no puede llevar un identificador ni por descuido. Los
 * cubos por tienda, en cambio, viajan hoy con el identificador CRUDO — y una pantalla se cierra,
 * pero un archivo se guarda, se reenvia y se abre seis meses despues. La sonda de la guardia de
 * la 170 tampoco lo atraparia: la celda leeria `fila.cubo`, cuyo nombre de campo es inocente.
 *
 * Se selecciona POR ID EXPLICITO y no «la primera temporal» para que el resultado sea
 * determinista aunque una metrica gane vistas.
 */
export function vistaTemporalDelResultado(
  datos: ResultadoFinancieroVistas,
  vistaId: string,
): VistaTemporal | null {
  const vista = datos.vistas.find((candidata) => candidata.id === vistaId);
  if (vista === undefined) return null;
  return esVistaTemporal(vista) ? vista : null;
}

/**
 * El juego de columnas que le toca a ESTE archivo, elegido por la FORMA del importe y nunca por
 * el id de la metrica (R13, R14).
 *
 * Elegir POR ARCHIVO es legitimo porque R18 de la 183 garantiza que una vista no mezcla formas.
 * Es el mismo criterio que `columnasDeVista` del tablero, repetido en vez de reinventado.
 *
 * Se devuelve una COPIA: el consumidor la entrega al generador comun, y compartir la instancia
 * exportada dejaria a un llamador la posibilidad de mutar el contrato de todos los demas.
 */
export function columnasDeVistaFinanciera(vista: VistaFinanciera): DescargaColumna[] {
  return esVistaConNeto(vista)
    ? [...COLUMNAS_DESCARGA_ANALITICA_FINANCIERA]
    : [...COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO];
}

/**
 * Una vista -> sus filas de export: **una fila por fila del DTO, en el orden recibido** (R19).
 *
 * Ni se filtra, ni se rellena, ni se reordena, ni se agrupa la cola en «Otros» (R20). La serie de
 * la 180 es DENSA a proposito: los cubos sin movimiento valen cero y ese cero **es un dato**, no
 * un hueco que limpiar. Y «Otros» no significa nada en un eje de tiempo: se comeria el final de
 * la serie, que es justo lo que se mira.
 */
export function filasDeVistaFinanciera(
  datos: ResultadoFinancieroVistas,
  vista: VistaFinanciera,
): DescargaFila[] {
  const proyectar = filaDescargaAnaliticaFinanciera({
    etiqueta: datos.etiqueta,
    granularidad: vista.granularidad,
    esAcumulado: datos.esAcumulado,
  });
  return vista.filas.map((fila) => proyectar(fila));
}
