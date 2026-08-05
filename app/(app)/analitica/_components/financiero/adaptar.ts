// Feature 132 (T2.1, T2.2, T2.3) — adaptadores PUROS del tablero financiero:
// traducen el DTO de la 127 (importes `string` escala 2) a las props del paquete
// de graficas de la 130 (`number | null`).
//
// Modulo PURO: sin React, sin JSX, sin I/O, sin `next/headers`, sin Server
// Actions, sin Prisma. Solo `import type` de los dos contratos. Todo lo que de
// verdad puede equivocarse en esta feature —la frontera string->number y el
// techo de categorias— vive aqui para poder probarse sin renderizar nada.
//
// Lo que este modulo NO hace, y no es un olvido: NO suma, resta, promedia ni
// deriva importes (R14). La aritmetica del dinero ya esta hecha aguas arriba en
// `Prisma.Decimal` y repetirla aqui, en coma flotante, seria producir una
// segunda cifra que discrepa de la primera. La unica excepcion es la suma de la
// cola de `agruparCola`, que R20/R21 exigen explicitamente y que se hace sobre
// numeros de PRESENTACION ya convertidos.
//
// Feature 183 ⟨D12⟩ (humano, 2026-08-04, `progress/decision_183.md`): `ImporteAnalitico`
// es una UNION DISCRIMINADA por `forma`, asi que este modulo tampoco decide por id de
// metrica cuando ramifica (R22): pregunta por la forma del DTO. Y no rellena la ausencia
// del `neto` con nada —ni `null`, ni `0`, ni el bruto— porque el ausente de la 132
// significa «no se sabe» (R15) y aqui la verdad es «no aplica» (R19, R23).
//
// Por que `agruparCola` vive aqui y no en el paquete de la 130: lo dice el
// propio paquete en `components/private/analytics/topes.ts:16-17` («no agrupa la
// cola en "otros" ni re-muestrea: los dos calculos son del tablero»), y ademas
// su guardia pondria rojo cualquier etiqueta de agrupacion escrita dentro del
// paquete (`tests/unit/components/analytics-paquete-guard.test.ts:205-212`). Por
// eso la etiqueta llega por parametro: este modulo tampoco la escribe.

import type {
  ColumnaResumen,
  FilaResumen,
  PuntoDato,
  SerieDato,
} from "@/components/private/analytics/tipos";
import type {
  FilaFinanciera,
  ImporteAnalitico,
  ImporteConNeto,
  VistaFinanciera,
} from "@/lib/types/analitica-financiera";

/**
 * Los dos campos que un importe PUEDE publicar.
 *
 * Ya no viajan siempre los dos: desde ⟨D12⟩ (humano, 2026-08-04,
 * `progress/decision_183.md`, feature 183) `ImporteAnalitico` es una union discriminada
 * por `forma`, y un `ImporteSoloBruto` no lleva `neto` ni siquiera en `null`. R16 de la
 * 132 queda REINTERPRETADO, no derogado: cada panel muestra TODOS los importes que su
 * DTO trae, y donde trae los dos siguen los dos y distinguibles (R20 de la 183).
 */
export type CampoImporte = "bruto" | "neto";

/** Una fila cuyo importe publica los dos campos. */
type FilaConNeto = Omit<FilaFinanciera, "importe"> & { readonly importe: ImporteConNeto };

/**
 * Una vista cuyos importes —el `total` y TODAS sus filas— publican los dos campos.
 *
 * Existe para que pedir el `neto` de una vista que no lo tiene NO COMPILE, que es el
 * punto entero de la union (R2 de la 183). Se obtiene con `esVistaConNeto`, que
 * pregunta por la FORMA del DTO y nunca por el id de la metrica (R22): el tablero no
 * sabe —ni tiene por que saber— cuales son las tres que retiraron el neto.
 */
export type VistaConNeto = Omit<VistaFinanciera, "filas" | "total"> & {
  readonly filas: readonly FilaConNeto[];
  readonly total: ImporteConNeto;
};

/**
 * ¿Publica esta vista el `neto` en todos sus importes?
 *
 * Se comprueban el total Y las filas aunque R18 de la 183 garantice que una vista no
 * mezcla formas: comprobar solo el total dejaria que una vista mal formada colara una
 * fila sin neto en una serie que lo pide, y ahi el fallo aparece como cifra, no como
 * error.
 */
export function esVistaConNeto(vista: VistaFinanciera): vista is VistaConNeto {
  return (
    vista.total.forma === "bruto_y_neto" &&
    vista.filas.every((fila) => fila.importe.forma === "bruto_y_neto")
  );
}

/**
 * Se pidio el `neto` de un importe que NO lo publica ⟨D12⟩.
 *
 * NO se devuelve el dato ausente, ni un cero, ni el bruto A PROPOSITO (R23): en la 132
 * el ausente significa «no se sabe» (R15) y aqui la verdad es «no aplica». Las
 * sobrecargas de `serieDeVista` impiden esta llamada en compilacion; esta clase es el
 * cinturon para un `as` de test o para un DTO que llegue sin pasar por el tipo.
 */
export class ImporteSinNetoError extends Error {
  readonly cubo: string;

  constructor(cubo: string) {
    super(`El importe de "${cubo}" no publica neto: su forma es solo_bruto`);
    this.name = "ImporteSinNetoError";
    this.cubo = cubo;
  }
}

/**
 * `string` escala 2 -> `number` de PRESENTACION (R15).
 *
 * Es la UNICA frontera string->number de la feature y existe solo para pintar:
 * nunca al reves, y nunca para calcular.
 *
 * Devuelve `null` —dato ausente— si el resultado no es un numero finito. NUNCA
 * `0`: un cero seria indistinguible de «no hubo movimiento», que es justamente
 * la afirmacion que la 127 se nego a hacer
 * (`IAnaliticaFinancieraService.ts:30-33`), y el paquete de la 130 ya sabe
 * pintar el ausente con su propio marcador.
 *
 * La conversion es ESTRICTA: se recorta el texto y se rechaza el vacio antes de
 * convertir, porque `Number("")` y `Number(" ")` valen `0` y colarian
 * exactamente el cero inventado que este contrato prohibe.
 *
 * Limite conocido y aceptado (design.md §6.3): `Number` deja de ser exacto por
 * encima de 2^53. El volumen medido del repo lo hace inalcanzable y, si se
 * alcanzara, la funcion no miente: el formateo sale del mismo numero pintado.
 */
export function aNumero(importe: string): number | null {
  const recortado = typeof importe === "string" ? importe.trim() : "";
  if (recortado === "") return null;
  const valor = Number(recortado);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * La cifra de un campo, leida del PROPIO importe y de ningun otro sitio.
 *
 * No hay rama de rescate: ni `?? bruto` (seria derivar), ni `?? "0"` (seria inventar),
 * ni `?? ""` (que `aNumero` convertiria en el ausente). Las tres estan prohibidas por
 * R23. Pedir el `neto` de un importe que no lo publica no es un dato que falte: es una
 * llamada que no debio escribirse, y por eso falla con nombre.
 */
function cifraDeImporte(importe: ImporteAnalitico, campo: CampoImporte, cubo: string): string {
  if (campo === "bruto") return importe.bruto;
  if (importe.forma === "bruto_y_neto") return importe.neto;
  throw new ImporteSinNetoError(cubo);
}

/**
 * Una vista del DTO -> una serie del paquete (R14, R24; R21 de la 183).
 *
 * El `id` combina el de la vista y el campo porque de una misma vista pueden salir dos
 * series (bruto y neto) y el paquete usa el id como clave.
 *
 * **Las sobrecargas son el contrato, no adorno:** de una vista cualquiera solo se puede
 * pedir el `"bruto"`; el `"neto"` exige una `VistaConNeto`, o sea haber pasado por
 * `esVistaConNeto`. Asi una vista sin neto no puede emitir dos series (R21) y el techo
 * `MAX_SERIES` no se consume al doble por una serie que seria copia de la otra.
 *
 * `categoria` es el `cubo` COPIADO LITERALMENTE: no se traduce, no se acorta y
 * no se enriquece con nombres legibles (R24 / Q2 del spec: eso es la ficha 178,
 * y resolverlo aqui meteria acceso a datos en una feature de presentacion).
 */
export function serieDeVista(v: VistaConNeto, campo: CampoImporte): SerieDato;
export function serieDeVista(v: VistaFinanciera, campo: "bruto"): SerieDato;
export function serieDeVista(v: VistaFinanciera, campo: CampoImporte): SerieDato {
  return {
    id: `${v.id}__${campo}`,
    etiqueta: campo,
    puntos: v.filas.map((fila) => ({
      categoria: fila.cubo,
      valor: aNumero(cifraDeImporte(fila.importe, campo, fila.cubo)),
    })),
  };
}

/**
 * Cada columna de importe de `TablaResumen`, declarada UNA sola vez.
 *
 * Se declaran sueltas y luego se componen: los dos juegos de columnas comparten el
 * MISMO objeto de bruto, asi que no pueden divergir en etiqueta ni en unidad. La
 * `unidad` es la del contrato de la 130, que es quien resuelve el formato; aqui no se
 * escribe ningun simbolo ni codigo de moneda (R25).
 */
const COLUMNA_BRUTO = Object.freeze({
  id: "bruto",
  etiqueta: "Bruto",
  unidad: "moneda",
} as const satisfies ColumnaResumen);

const COLUMNA_NETO = Object.freeze({
  id: "neto",
  etiqueta: "Neto",
  unidad: "moneda",
} as const satisfies ColumnaResumen);

/** Las columnas de una vista cuyos importes publican los dos campos (R20). */
export const COLUMNAS_IMPORTE: readonly ColumnaResumen[] = Object.freeze([
  COLUMNA_BRUTO,
  COLUMNA_NETO,
]);

/**
 * Las columnas de una vista `solo_bruto` (R19).
 *
 * La columna del neto NO existe, en vez de existir vacia: `TablaResumen` pinta el
 * marcador de dato ausente en toda celda cuya clave no encuentra
 * (`TablaResumen.tsx:73`), y ese marcador significa «no se sabe» (R15 de la 132).
 * Aqui la verdad es «no aplica», que es otra cosa.
 */
export const COLUMNAS_IMPORTE_SOLO_BRUTO: readonly ColumnaResumen[] = Object.freeze([
  COLUMNA_BRUTO,
]);

/**
 * Las columnas que le tocan a una vista, elegidas por la FORMA de su DTO (R19, R22).
 *
 * Sigue habiendo UNA declaracion de columnas para todo el tablero: lo que elige esta
 * funcion es cual de los dos juegos, no como se llama cada columna.
 */
export function columnasDeVista(v: VistaFinanciera): readonly ColumnaResumen[] {
  return esVistaConNeto(v) ? COLUMNAS_IMPORTE : COLUMNAS_IMPORTE_SOLO_BRUTO;
}

/**
 * Los valores de una fila de tabla: el `bruto` siempre; el `neto` SOLO si el importe lo
 * publica (R19, R23).
 *
 * La clave ausente NO se escribe: ni en `null`, ni en `0`, ni en cadena vacia, ni
 * derivada del bruto. Las claves son los ids de las columnas de arriba, leidos de
 * ellas, para que fila y columna no puedan desincronizarse.
 */
function valoresDeImporte(importe: ImporteAnalitico): Readonly<Record<string, number | null>> {
  if (importe.forma === "solo_bruto") {
    return { [COLUMNA_BRUTO.id]: aNumero(importe.bruto) };
  }
  return {
    [COLUMNA_BRUTO.id]: aNumero(importe.bruto),
    [COLUMNA_NETO.id]: aNumero(importe.neto),
  };
}

/**
 * Una vista del DTO -> las filas de `TablaResumen` (R14, R24; R19/R23 de la 183).
 *
 * Una fila por fila del DTO, con el `cubo` crudo como id y como categoria, y las cifras
 * que ESE importe publica en las columnas que `columnasDeVista` eligio. Ninguna fila se
 * agrega, se ordena ni se filtra: el orden es el que trajo el servicio.
 */
export function filasDeVista(v: VistaFinanciera): readonly FilaResumen[] {
  return v.filas.map((fila) => ({
    id: fila.cubo,
    categoria: fila.cubo,
    valores: valoresDeImporte(fila.importe),
  }));
}

/**
 * Suma de presentes ignorando ausentes; si TODOS faltan, el total tambien falta.
 *
 * Es el mismo criterio (y a proposito la misma forma) que `totalizar` en
 * `components/private/analytics/formato.ts`: tratar el ausente como `0` haria
 * que una cola entera sin dato apareciera como una categoria "otros" que vale
 * cero, es decir, un dato inventado.
 */
function sumarPresentes(valores: readonly (number | null)[]): number | null {
  const presentes = valores.filter(
    (valor): valor is number => valor !== null && Number.isFinite(valor),
  );
  if (presentes.length === 0) return null;
  return presentes.reduce((acumulado, actual) => acumulado + actual, 0);
}

/**
 * Mantiene los puntos por debajo de un techo agrupando la cola (R20, R21).
 *
 * Sin esto, un maestro con seis tiendas activas haria que el paquete LANCE
 * `SeriesExcedidasError` fuera de produccion (`topes.ts:82`) y recorte en
 * silencio en produccion, mostrando cinco tiendas como si fueran todas mientras
 * el total las desmiente.
 *
 * - Si no se supera el techo, la entrada se devuelve intacta.
 * - Si se supera, se conservan los `tope - 1` PRIMEROS en el orden recibido y el
 *   resto se funde en una unica categoria con la etiqueta que da el llamador.
 * - EL TOTAL SE CONSERVA (R21): la suma de los valores del resultado es igual a
 *   la de la entrada. Esa es la propiedad que hace honesto el grafico.
 *
 * No ordena la entrada: quien llama decide que es "la cabeza" y que es "la
 * cola". Ordenar aqui haria que el mismo cubo cambiara de sitio segun el panel.
 */
export function agruparCola(
  puntos: readonly PuntoDato[],
  tope: number,
  etiquetaOtros: string,
): readonly PuntoDato[] {
  // Un techo menor que 1 no describe ninguna grafica dibujable; se devuelve la
  // entrada tal cual en vez de inventar un recorte con `slice(0, -1)`.
  if (tope < 1) return puntos;
  if (puntos.length <= tope) return puntos;

  const cabeza = puntos.slice(0, tope - 1);
  const cola = puntos.slice(tope - 1);
  return [
    ...cabeza,
    { categoria: etiquetaOtros, valor: sumarPresentes(cola.map((p) => p.valor)) },
  ];
}
