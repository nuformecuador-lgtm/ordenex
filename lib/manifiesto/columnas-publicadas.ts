import type { XlsxColumn } from "@/lib/utils/xlsx-template";

/**
 * Columnas del manifiesto, en su orden. Las cabeceras son las claves máquina del requisito
 * (`num_guia`, `num_remision`, …), no etiquetas de presentación: el manifiesto es un documento
 * operativo estable, no una vista.
 *
 * REGLA VIGENTE (feature 160/R28, design 160 §6.3 — DEROGA y REEMPLAZA los R2/R11 de la 148,
 * decisión del humano del 2026-07-29): **el manifiesto refleja los datos de la orden**, y este
 * conjunto es ABIERTO — **crece** cuando la orden gana un dato nuevo. Ni este módulo ni sus
 * pruebas pueden afirmar "exactamente N columnas"; las pruebas verifican que ciertas columnas
 * ESTÁN, con su clave y su orden relativo, nunca que no haya otras.
 *
 * Lo que se derogó es el número cerrado, NO el filtro: cualquier campo que no esté en esta
 * lista sigue sin emitirse, y los identificadores internos, las banderas de borrado y los datos
 * que no son de la orden siguen prohibidos.
 *
 * AMPLIACIÓN (feature 194 — columnas elegibles por acción): esta lista sigue siendo la ÚNICA
 * fuente de verdad de qué columnas existen y en qué orden. `buildManifiestoXlsx` admite ahora
 * un SUBCONJUNTO de estas columnas elegido por el usuario, pero el subconjunto se obtiene
 * SIEMPRE filtrando esta lista —nunca reordenando ni ampliando lo que llega de fuera—, así que
 * el orden relativo de arriba es inviolable (194/R8) y una clave desconocida se ignora sola.
 * Elegir un subconjunto NO cierra la lista: la regla 160/R28 sigue rigiendo íntegra y ni este
 * módulo ni sus pruebas pueden afirmar "exactamente N columnas" (194/R23).
 *
 * POR QUÉ VIVE AQUÍ Y NO EN EL GENERADOR (feature 194): el catálogo de columnas publicadas es
 * un DATO, no maquinaria. Lo consumen dos superficies muy distintas: el generador de binarios
 * (`lib/utils/manifiesto-xlsx.ts`, que arrastra `exceljs` por su import dinámico) y la UI del
 * selector de columnas —`hooks/usePreferenciaColumnasManifiesto.ts` y
 * `components/shared/ColumnasManifiestoPopover.tsx`—, que solo necesita saber QUÉ columnas
 * existen y en qué orden, sin generar archivo alguno. Mientras el catálogo vivía dentro del
 * generador, cualquier pantalla que quisiera listar columnas quedaba acoplada al generador
 * entero. Separado, el dato se lee sin pagar la maquinaria. `lib/utils/manifiesto-xlsx.ts`
 * RE-EXPORTA `COLUMNAS_MANIFIESTO` para no romper a ningún consumidor existente: quien ya lo
 * importaba de allí sigue funcionando igual.
 */
export const COLUMNAS_MANIFIESTO: XlsxColumn[] = [
  { key: "numGuia", header: "num_guia" },
  { key: "numRemision", header: "num_remision" },
  { key: "destinatario", header: "destinatario" },
  { key: "telefono", header: "telefono" },
  { key: "direccion", header: "direccion" },
  { key: "zona", header: "zona" },
  { key: "monto", header: "monto" },
  // Feature 160 (R28a): dato propio de la orden -> columna propia del manifiesto. Va tras
  // `monto` y ANTES del bloque de logística del movimiento (origen/destino/responsable/fecha),
  // que describe la OPERACIÓN y no la orden.
  { key: "intentos", header: "intentos" },
  { key: "origen", header: "origen" },
  { key: "destino", header: "destino" },
  { key: "responsable", header: "responsable" },
  { key: "fecha", header: "fecha" },
];
