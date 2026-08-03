// Feature 127 (T A.4, ⟨D5⟩ / R40) — LA UNICA cifra configurable de la analitica financiera.
//
// ⚠️ PROVISIONAL Y NO MEDIDA. Nadie ha medido todavia el descuadre tipico entre los `total_*`
// snapshot de los cierres aprobados y lo que los ledgers registraron con origen en esos
// mismos cierres: el volumen de produccion es de decenas de movimientos (medido y anotado en
// `progress/current.md`) y no hay serie historica de la que sacar un umbral con procedencia.
// La cifra de abajo es un AVISO, no un limite: nada se rechaza, nada se trunca y nada se
// vacia por superarla. Solo decide a partir de que diferencia el descuadre deja rastro en el
// `ErrorLogger` ademas de viajar en el DTO ⟨D5⟩. Cuando exista medicion real, se sustituye
// aqui y en ningun otro sitio.
//
// R40, segunda mitad: esta constante vive SOLO en este archivo. Escribir el numero dentro de
// un servicio o de un repositorio pone rojo el censo de literales de umbral, y con razon:
// ajustarlo dejaria de ser un one-liner con su test para volverse una caceria de numeros
// sueltos por el arbol.
//
// STRING y no `number` (S1 / R27): el umbral se compara contra una diferencia de dinero, y
// esa comparacion se hace con `Prisma.Decimal`. Un `number` aqui obligaria a convertir en el
// punto exacto donde la conversion no se debe hacer.

/**
 * Diferencia absoluta, en la moneda configurada (`lib/config/moneda.ts`), a partir de la cual
 * un descuadre de conciliacion se emite ademas por el `ErrorLogger`.
 *
 * `"0.01"` = un centimo: hoy CUALQUIER descuadre se reporta, porque con el volumen actual un
 * descuadre real es una anomalia que interesa ver entera. El dia que haya ruido de fondo
 * medido, este es el numero que sube — y su justificacion se escribe aqui al lado.
 */
export const UMBRAL_AVISO_DESCUADRE_CONCILIACION = "0.01";
