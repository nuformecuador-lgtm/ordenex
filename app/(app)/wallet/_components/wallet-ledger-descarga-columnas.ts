/**
 * Feature 170 (T C.3, design §3/§7) — columnas de EXPORT del libro de movimientos de la
 * caja principal.
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<WalletMovimientoDTO>` de
 * `WalletLedger`, cuyo `render` devuelve insignias y un botón de reversa (R7).
 *
 * MONEY-SAFE, y es la decisión que manda en este módulo: el monto se emite como el STRING
 * que llega del servidor, TAL CUAL. Nada de `parseFloat`, `Number` ni reformateo: un
 * `Decimal(10,2)` de once dígitos no cabe exacto en un `number` de JavaScript, y un céntimo
 * perdido en una hoja de cálculo de caja es un descuadre que nadie sabrá explicar. Tampoco
 * se antepone el símbolo de colón (`money`): eso es presentación, y convertiría una celda
 * numérica en texto que Excel no puede sumar.
 *
 * Lo que NO sale: `id` y `origenId` (uuid internos, R23) y `registradoPor` (uuid de un
 * usuario, que además la tabla no muestra — R23/R24).
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import { CATEGORIA_LABEL, DUENO_LABEL, ORIGEN_LABEL, TIPO_LABEL } from "./wallet-labels";

/**
 * Columnas emitidas por la descarga del libro de caja, en su orden de pantalla. Son las
 * columnas de DATOS de la tabla; la última de la pantalla ("Acciones") es un botón, no un dato.
 *
 * Feature 231 (T5.3, R34): entra "Dueño", en el mismo sitio que en la tabla —la última de los
 * datos— y con el MISMO texto, porque sale de `DUENO_LABEL`, que es de donde lo saca la celda.
 * Se añade aquí y en `filaDescargaMovimientoCaja` en el mismo commit: los dos casos que comparan
 * `Object.keys(fila)` contra esta lista siguen verdes solos.
 */
export const COLUMNAS_DESCARGA_WALLET_CAJA: DescargaColumna[] = [
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "tipo", encabezado: "Tipo" },
  { clave: "categoria", encabezado: "Categoría" },
  { clave: "monto", encabezado: "Monto" },
  { clave: "origen", encabezado: "Origen" },
  { clave: "dueno", encabezado: "Dueño" },
];

/**
 * Origen legible: la MISMA composición que pinta la tabla (`origenTexto`), etiqueta del
 * origen más la descripción cuando la hay. Sin descripción, solo la etiqueta.
 */
function origen(movimiento: WalletMovimientoDTO): string {
  const base = ORIGEN_LABEL[movimiento.origenTipo] ?? movimiento.origenTipo;
  return movimiento.descripcion ? `${base} · ${movimiento.descripcion}` : base;
}

/**
 * Proyecta un movimiento de caja a una fila de export con valores CRUDOS (R7). Tipo y
 * categoría salen como su ETIQUETA LEGIBLE (R8), la misma que ve el usuario; el `??` cae al
 * valor del enum si éste ganara un valor sin etiqueta, que se lee peor pero nunca miente.
 */
export function filaDescargaMovimientoCaja(movimiento: WalletMovimientoDTO): DescargaFila {
  return {
    fecha: fechaDiaISO(movimiento.fechaMovimiento),
    tipo: TIPO_LABEL[movimiento.tipo] ?? movimiento.tipo,
    categoria: CATEGORIA_LABEL[movimiento.categoria] ?? movimiento.categoria,
    monto: movimiento.monto, // STRING tal cual (money-safe): sin parseo, sin símbolo
    origen: origen(movimiento),
    // Feature 231 (R34): el MISMO texto que muestra la tabla. El dueño lo derivó el servidor;
    // aquí solo se traduce a la palabra que se lee en pantalla.
    dueno: DUENO_LABEL[movimiento.dueno] ?? movimiento.dueno,
  };
}
