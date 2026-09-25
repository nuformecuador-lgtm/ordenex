import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { SaldoSateliteDTO } from "@/lib/types/conciliacion-satelites";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

/**
 * ⭑ FICHA 431 (T23, R29) — columnas de EXPORT de los saldos de bodegas satélite.
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<SaldoSateliteDTO>` de la tabla,
 * cuyo `render` devuelve `<span>` coloreados y `Badge`. Precedente literal: su gemela de tiendas
 * (`saldos-tiendas-descarga-columnas`).
 *
 * MONEY-SAFE: los importes salen como el STRING que devolvió el servidor, TAL CUAL. Sin
 * `parseFloat`/`Number` —un `Decimal(12,2)` no cabe exacto en un `number`— y **sin el símbolo de
 * colón** de `money`, que es presentación y además convertiría la celda en texto que la hoja no
 * puede sumar.
 *
 * ── LO QUE NO SALE, Y POR QUÉ
 *  · `zonaId`: uuid interno (mismo criterio que la 170/R23). El identificador de negocio de la
 *    fila es el NOMBRE de la bodega, que es lo que la tabla enseña.
 *  · La ANTIGÜEDAD en días, no: sale la FECHA de la más antigua. Los días son un derivado del
 *    momento en que se miró la pantalla, y dentro de un archivo que alguien abrirá la semana que
 *    viene «hace 3 días» es sencillamente falso. La fecha no caduca.
 */
export const COLUMNAS_DESCARGA_SALDOS_SATELITES: DescargaColumna[] = [
  { clave: "bodega", encabezado: "Bodega" },
  { clave: "pendiente", encabezado: "Pendiente" },
  { clave: "efectivoConsolidado", encabezado: "Efectivo consolidado" },
  { clave: "totalConsolidado", encabezado: "Total consolidado" },
  { clave: "recibido", encabezado: "Recibido" },
  { clave: "sinConciliar", encabezado: "Consolidaciones sin conciliar" },
  { clave: "masAntigua", encabezado: "Más antigua sin conciliar" },
  { clave: "ultimaRecibidaEl", encabezado: "Última recibida" },
  { clave: "ultimaRecibidaMonto", encabezado: "Monto de la última recibida" },
];

/**
 * Proyecta el saldo de una bodega a una fila de export con valores CRUDOS.
 *
 * `masAntigua` va como la fecha ISO recortada a `YYYY-MM-DD` —no como el instante entero— porque
 * es lo que la columna significa: el día en que se consolidó. `null` sale como cadena VACÍA y
 * jamás como «—»: el guion es un marcador de PANTALLA y dentro del Excel sería un dato inventado
 * (R10 de la 170).
 */
export function filaDescargaSaldoSatelite(saldo: SaldoSateliteDTO): DescargaFila {
  return {
    bodega: saldo.zonaNombre,
    pendiente: saldo.saldoSinConciliar, // STRING tal cual (money-safe)
    efectivoConsolidado: saldo.totalEfectivo,
    totalConsolidado: saldo.totalConsolidado,
    recibido: saldo.totalRecibido,
    sinConciliar: saldo.consolidacionesSinConciliar,
    masAntigua: saldo.fechaDeLaMasAntigua === null ? "" : fechaDiaMovimientoCR(saldo.fechaDeLaMasAntigua),
    // La ÚLTIMA que llegó, en dos columnas: cuándo y cuánto. Son las dos mitades de la celda que
    // la pantalla pinta en una, y van separadas porque una hoja de cálculo ordena por fecha y
    // suma importes — no sabe hacer ninguna de las dos cosas con «16 sep · ₡ 485.000».
    //
    // ⚠️ `ultimaRecibidaMonto` es el de ESA consolidación, no el acumulado: `recibido` (arriba)
    // ya lleva la suma histórica, y tener las dos cifras con el mismo nombre en el mismo archivo
    // es lo que hace que nadie se fíe de ninguna.
    ultimaRecibidaEl: saldo.ultimaRecibida === null ? "" : fechaDiaMovimientoCR(saldo.ultimaRecibida.fecha),
    ultimaRecibidaMonto: saldo.ultimaRecibida === null ? "" : saldo.ultimaRecibida.monto,
  };
}
