/**
 * Feature 170 (T D.1) — etiqueta legible del SIGNO del saldo de una tienda.
 *
 * PROMOVIDA sin editar ni un texto desde `SaldosTiendasTable.tsx`, donde vivía dentro de
 * `SIGNO_BADGE` (un objeto que además lleva la `variant` del `Badge`). El módulo de export
 * necesita solo la etiqueta y no puede arrastrar React, así que el texto vive aquí y lo
 * leen los dos: la tabla —que le añade su color— y el archivo. Que archivo y pantalla digan
 * lo mismo (R8) es cierto porque leen del MISMO sitio, no porque coincidan hoy.
 *
 * Misma operación que hicieron `usuario-estado-label` y `plantilla-estado-label` en la
 * tanda B.
 */
import type { SaldoTiendaSigno } from "@/lib/types/wallet-tienda";

/** Estado del saldo tal como lo lee el usuario en la columna "Estado". */
export const SALDO_SIGNO_LABEL: Record<SaldoTiendaSigno, string> = {
  positivo: "A favor",
  negativo: "En contra",
  cero: "En cero",
};
