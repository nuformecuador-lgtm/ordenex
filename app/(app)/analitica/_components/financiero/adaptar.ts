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
import type { VistaFinanciera } from "@/lib/types/analitica-financiera";

/** Los dos campos de todo `ImporteAnalitico`. Viajan siempre LOS DOS (R16). */
export type CampoImporte = "bruto" | "neto";

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
 * Una vista del DTO -> una serie del paquete (R14, R16, R24).
 *
 * El `id` combina el de la vista y el campo porque de una misma vista salen dos
 * series (bruto y neto) y el paquete usa el id como clave.
 *
 * `categoria` es el `cubo` COPIADO LITERALMENTE: no se traduce, no se acorta y
 * no se enriquece con nombres legibles (R24 / Q2 del spec: eso es la ficha 178,
 * y resolverlo aqui meteria acceso a datos en una feature de presentacion).
 */
export function serieDeVista(v: VistaFinanciera, campo: CampoImporte): SerieDato {
  return {
    id: `${v.id}__${campo}`,
    etiqueta: campo,
    puntos: v.filas.map((fila) => ({
      categoria: fila.cubo,
      valor: aNumero(fila.importe[campo]),
    })),
  };
}

/**
 * Las dos columnas de importe de `TablaResumen`, declaradas UNA vez (R16).
 *
 * Se exportan desde aqui para que ningun panel las reescriba: dos tablas con
 * columnas declaradas por separado acaban con etiquetas o unidades distintas
 * para la misma cifra. La `unidad` es la del contrato de la 130, que es quien
 * resuelve el formato; aqui no se escribe ningun simbolo ni codigo de moneda
 * (R25).
 */
export const COLUMNAS_IMPORTE: readonly ColumnaResumen[] = Object.freeze([
  Object.freeze({ id: "bruto", etiqueta: "Bruto", unidad: "moneda" as const }),
  Object.freeze({ id: "neto", etiqueta: "Neto", unidad: "moneda" as const }),
]);

/**
 * Una vista del DTO -> las filas de `TablaResumen` (R14, R16, R24).
 *
 * Una fila por fila del DTO, con el `cubo` crudo como id y como categoria, y las
 * dos cifras del importe en las columnas de `COLUMNAS_IMPORTE`. Ninguna fila se
 * agrega, se ordena ni se filtra: el orden es el que trajo el servicio.
 */
export function filasDeVista(v: VistaFinanciera): readonly FilaResumen[] {
  return v.filas.map((fila) => ({
    id: fila.cubo,
    categoria: fila.cubo,
    valores: {
      bruto: aNumero(fila.importe.bruto),
      neto: aNumero(fila.importe.neto),
    },
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
