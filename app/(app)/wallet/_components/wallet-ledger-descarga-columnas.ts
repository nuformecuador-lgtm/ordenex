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
 *
 * FICHA 458-E (T E.1, design §5.2; R3, R55–R57) — en paralelo con las columnas nuevas de la tabla:
 * Fecha · Movimiento · Motivo y origen · A quién · Entra o sale · Monto · Dueño · Registró. La
 * tabla junta concepto y motivo en una celda y dirección y dueño dentro del monto; en la hoja van
 * SEPARADOS porque una hoja de cálculo se filtra y se suma por columna, y el monto tiene que seguir
 * siendo una celda numérica. «A quién» y «Registró» salen de la MISMA autoría que pinta la tabla
 * (`autoriaDelLibroCajaAction`, pedida por el módulo) y con los MISMOS textos: nombres, nunca ids
 * (R3; el id de la cuenta de «A quién» solo sirve al enlace de la pantalla y aquí no sale).
 */
import { textoRegistro } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import { textoDeOrigen } from "@/components/shared/wallet/origen-movimiento";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { AutoriaDeFilaDTO } from "@/lib/types/libro-caja-autoria";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

import { AUTORIA_CELDA, LIBRO_CAJA_COLUMNA, textoAQuien } from "./libro-caja-labels";
import { CATEGORIA_LABEL, DUENO_LABEL, ORIGEN_LABEL, TIPO_LABEL } from "./wallet-labels";

/**
 * Columnas emitidas por la descarga del libro de caja. Las claves de antes (`fecha`, `tipo`,
 * `categoria`, `monto`, `origen`, `dueno`) se CONSERVAN —con la palabra nueva de su encabezado— y
 * entran `aQuien` y `registro`. Ninguna es un identificador.
 */
export const COLUMNAS_DESCARGA_WALLET_CAJA: DescargaColumna[] = [
  { clave: "fecha", encabezado: LIBRO_CAJA_COLUMNA.fecha },
  { clave: "categoria", encabezado: "Movimiento" },
  { clave: "origen", encabezado: "Motivo y origen" },
  { clave: "aQuien", encabezado: LIBRO_CAJA_COLUMNA.aQuien },
  { clave: "tipo", encabezado: "Entra o sale" },
  { clave: "monto", encabezado: LIBRO_CAJA_COLUMNA.monto },
  { clave: "dueno", encabezado: "Dueño" },
  { clave: "registro", encabezado: LIBRO_CAJA_COLUMNA.registro },
];

/**
 * Origen legible: la MISMA composición que pinta la tabla (`OrigenMovimiento`), el origen con su
 * entidad más la descripción cuando la hay. Sin descripción, solo el origen.
 */
function origen(movimiento: WalletMovimientoDTO): string {
  // 458-A (R5/R6, R3): el origen con su entidad que adjunta el servidor, el MISMO texto de la celda.
  return textoDeOrigen(movimiento, ORIGEN_LABEL);
}

/**
 * Proyecta un movimiento de caja a una fila de export con valores CRUDOS (R7). Dirección y concepto
 * salen como su ETIQUETA LEGIBLE (R8), la misma que ve el usuario; el `??` cae al valor del enum si
 * éste ganara un valor sin etiqueta, que se lee peor pero nunca miente.
 *
 * FICHA 458-E: `autoria` es la de ESA fila, leída por el módulo en lote. Ausente ⇒ «—» en «A quién»
 * y «Registró» (la fila no tiene autoría resuelta; nunca un id en su lugar).
 */
export function filaDescargaMovimientoCaja(
  movimiento: WalletMovimientoDTO,
  autoria?: AutoriaDeFilaDTO,
): DescargaFila {
  return {
    fecha: fechaDiaMovimientoCR(movimiento.fechaMovimiento),
    categoria: CATEGORIA_LABEL[movimiento.categoria] ?? movimiento.categoria,
    origen: origen(movimiento),
    aQuien: autoria === undefined ? AUTORIA_CELDA.sinDato : textoAQuien(autoria.aQuien),
    tipo: TIPO_LABEL[movimiento.tipo] ?? movimiento.tipo,
    monto: movimiento.monto, // STRING tal cual (money-safe): sin parseo, sin símbolo
    // Feature 231 (R34): el MISMO texto que muestra la tabla. El dueño lo derivó el servidor;
    // aquí solo se traduce a la palabra que se lee en pantalla.
    dueno: DUENO_LABEL[movimiento.dueno] ?? movimiento.dueno,
    registro: autoria === undefined ? AUTORIA_CELDA.sinDato : textoRegistro(autoria.registro),
  };
}
