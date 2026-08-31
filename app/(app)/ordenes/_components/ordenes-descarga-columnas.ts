/**
 * Feature 151 (design §7, R35) — columnas de EXPORT del listado de órdenes.
 *
 * Módulo PURO: sin React ni DOM. Las columnas del export se declaran APARTE de
 * `ordenesColumns` (`Column<OrdenListItemDTO>`) porque el `render` de aquéllas devuelve
 * `ReactNode` (insignias, `PriceLabel`, iconos) y una hoja de cálculo solo admite valores
 * crudos (D5). Aquí cada celda es `string | number | null` y nada más.
 *
 * Las columnas se enumeran A MANO, igual que `COLUMNAS_MANIFIESTO`: si el DTO del listado
 * crece, el archivo NO publica el campo nuevo en silencio — hay que declararlo aquí. Por la
 * misma regla del manifiesto, NO se exponen identificadores internos (`id`, `tiendaId`,
 * `zonaId`, …), banderas de borrado ni datos ajenos a la orden: las relaciones se proyectan
 * a su NOMBRE legible.
 *
 * FICHA 314 — el catálogo pasa de 15 a 22 columnas y la descarga deja ELEGIR cuáles salen y
 * en qué orden (`components/shared/ColumnasPopover`). Dos consecuencias declaradas:
 *
 *  · Quien nunca abra el selector recibe las 22, no las 15. Es inevitable con una lista de
 *    exclusión —una columna no puede "nacer oculta" sin la allowlist que la 194 descartó por
 *    dejar invisibles para siempre las columnas futuras— y el humano lo ratificó el 2026-08-28.
 *  · `COLUMNAS_DESCARGA_ORDENES` NO cambia de nombre ni de archivo:
 *    `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts` afirma su ruta exacta
 *    como canario de su detector, y moverla pondría roja una guardia por un motivo que no
 *    tiene nada que ver con esta ficha.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { estatusLabel } from "./estatus-label";

/**
 * Identificador del ÁMBITO de preferencia de columnas de esta descarga (314/R1, R10).
 *
 * Es lo único que `OrdenesModule` declara: con él, el control común arma la clave
 * `ordenex:descarga-columnas:ordenes` y aplica la preferencia. Un ámbito es un identificador,
 * no una configuración; encender otra tabla cuesta una línea en su módulo.
 * `tests/unit/descarga/ambito-columnas.guardia.test.ts` vigila que no se repita en dos sitios.
 */
export const AMBITO_DESCARGA_ORDENES = "ordenes";

/**
 * Columnas emitidas por la descarga del listado de órdenes, en su orden. Los encabezados
 * son las etiquetas legibles que ve el usuario en la tabla; las claves indexan la fila que
 * devuelve `filaDescargaOrden`.
 *
 * Deliberadamente NO se exportan las columnas derivadas de la tarifa (fulfillment) ni
 * "Tiempo": son cálculos de presentación, no datos de la orden. "Flete + IVA" y "Comisión +
 * IVA" sí salen, pero NO derivadas: se emiten tal cual las manda el servidor (ver abajo).
 *
 * FICHA 314 — las siete altas van INTERCALADAS por afinidad (decisión del humano del
 * 2026-08-28): el teléfono junto al destinatario, el peso junto al producto, los dos importes
 * junto al monto, las dos fechas junto a la de creación, y las notas al final por ser texto
 * largo. El orden RELATIVO de las quince anteriores no cambia (R17).
 */
export const COLUMNAS_DESCARGA_ORDENES: DescargaColumna[] = [
  { clave: "numGuia", encabezado: "Nº Guía" },
  { clave: "numRemision", encabezado: "Nº Remisión" },
  { clave: "estatus", encabezado: "Estado" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "telefonoDest", encabezado: "Teléfono del destinatario" },
  { clave: "producto", encabezado: "Producto" },
  // La unidad va en el ENCABEZADO para que la celda siga siendo numérica: "1.5 kg" sería
  // texto y la hoja no lo podría sumar ni ordenar.
  { clave: "peso", encabezado: "Peso (kg)" },
  { clave: "direccion", encabezado: "Dirección" },
  { clave: "tienda", encabezado: "Tienda" },
  { clave: "zona", encabezado: "Zona" },
  { clave: "provincia", encabezado: "Provincia" },
  { clave: "canton", encabezado: "Cantón" },
  { clave: "distrito", encabezado: "Distrito" },
  { clave: "montoCobrar", encabezado: "Monto a cobrar" },
  { clave: "fleteConIva", encabezado: "Flete + IVA" },
  { clave: "comisionConIva", encabezado: "Comisión + IVA" },
  { clave: "mensajero", encabezado: "Mensajero" },
  { clave: "intentos", encabezado: "Intentos" },
  { clave: "fechaCreacion", encabezado: "Fecha de creación" },
  { clave: "fechaReparto", encabezado: "Día de reparto" },
  { clave: "fechaReprogramacion", encabezado: "Fecha de reprogramación" },
  { clave: "notas", encabezado: "Notas de la tienda" },
];

/**
 * Fecha de creación como `YYYY-MM-DD` en el calendario de Costa Rica. El DTO tipa
 * `createdAt: Date`, pero según el borde de serialización puede llegar como string ISO
 * (misma coacción defensiva que `ordenes-columns`). Fecha inválida → celda vacía.
 *
 * NO se usa `toISOString().slice(0, 10)`: emitiría el día siguiente después de las 18:00
 * de CR (off-by-one documentado en `lib/utils/fecha-cr`).
 */
function fechaCreacion(value: Date | string): string | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : fechaCalendarioCR(d);
}

/** Etiqueta legible del estado; sin estatus resuelto → celda vacía (R6). */
function estado(orden: OrdenListItemDTO): string | null {
  const value = orden.relaciones?.estatus?.value ?? orden.estatusValue;
  return value ? estatusLabel(value) : null;
}

/**
 * Proyecta una orden del listado a una fila de export con valores CRUDOS (R35): texto,
 * número o `null` (celda vacía). Los ids se resuelven a nombre legible vía `relaciones` y,
 * cuando la relación opcional no resolvió, se cae a los escalares `tiendaNombre`/
 * `zonaNombre` y luego a `null` — nunca al placeholder "—", que es presentación.
 *
 * `intentosEntrega` usa `?? 0`: el 0 es un valor CONOCIDO, no un dato ausente (160/R14).
 *
 * FICHA 314 — reglas de las siete altas, y ninguna es opinable:
 *
 *  · LOS DOS IMPORTES PASAN TAL CUAL (R12). Llegan del servidor como STRING de escala 2
 *    (feature 204) y aquí solo se copian: ni Number(, ni parseFloat(, ni .toFixed(, ni
 *    multiplicar. Ese camino ya costó 14 de 66 órdenes desviadas un céntimo del cierre.
 *    Consecuencia aceptada por el humano el 2026-08-28: la celda es TEXTO y Excel no la
 *    autosuma, igual que en el resto de descargas de dinero de la app.
 *  · LAS DOS FECHAS PASAN TAL CUAL (R13). El repositorio ya las serializa como `YYYY-MM-DD`;
 *    construir aquí una fecha nueva con un `@db.Date` devolvería el día ANTERIOR en media
 *    América. `fechaCreacion` sigue con su `fechaCalendarioCR`, que es otra cosa.
 *  · Dato ausente ⇒ `null`, celda vacía (R14).
 */
export function filaDescargaOrden(orden: OrdenListItemDTO): DescargaFila {
  return {
    numGuia: orden.numGuia,
    numRemision: orden.numRemision,
    estatus: estado(orden),
    destinatario: orden.destinatario,
    telefonoDest: orden.telefonoDest ?? null,
    producto: orden.producto,
    peso: orden.peso ?? null,
    direccion: orden.direccion ?? null,
    tienda: orden.relaciones?.tienda?.nombre ?? orden.tiendaNombre ?? null,
    zona: orden.relaciones?.zona?.nombre ?? orden.zonaNombre ?? null,
    provincia: orden.relaciones?.provincia?.nombre ?? null,
    canton: orden.relaciones?.canton?.nombre ?? null,
    distrito: orden.relaciones?.distrito?.nombre ?? null,
    montoCobrar: orden.montoCobrar ?? null,
    fleteConIva: orden.fleteConIva ?? null,
    comisionConIva: orden.comisionConIva ?? null,
    mensajero: orden.relaciones?.mensajeroAsignado?.nombre ?? null,
    intentos: orden.intentosEntrega ?? 0,
    fechaCreacion: fechaCreacion(orden.createdAt),
    fechaReparto: orden.fechaRepartoISO ?? null,
    fechaReprogramacion: orden.fechaReprogramacion ?? null,
    notas: orden.notas ?? null,
  };
}
