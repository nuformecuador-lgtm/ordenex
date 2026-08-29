// Ficha 334 — la VENTANA de fechas que admite el registro MANUAL de dinero en la caja
// principal. Sobreescribible por variable de entorno para no hardcodear una cota de negocio
// (docs/architecture.md: «Sin hardcode de contexto»), molde de `lib/config/gasto-fijo.ts`.
//
// POR QUE EXISTE ESTE ARCHIVO. El humano fijo el tope de ARRIBA el 2026-08-29 («la fecha no
// puede ser posterior a hoy») y no dijo nada del de abajo. Tal como quedo escrito, R22 admite
// fechar un movimiento en 2019: el rollup diario y los cubos de la analitica financiera leen
// `fecha_movimiento` (design §3.4), asi que eso REESCRIBE en silencio una cifra de un mes ya
// reportado. Es la pregunta abierta 1 del spec, resuelta por el leader: se acota a 30 dias
// calendario de Costa Rica hacia atras.
//
// Es una VENTANA, no una fecha: se cuenta contra el dia calendario CR en curso, de modo que
// «hace 30 dias» significa lo mismo hoy que dentro de un ano.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface WalletMovimientoConfig {
  /**
   * Cuantos dias calendario de Costa Rica hacia ATRAS admite la fecha de un movimiento manual,
   * contados desde el dia en curso: con 30, el dia mas antiguo admisible es `hoy - 30`, y ese
   * dia SI entra. Fuera de la ventana el borde responde `validation_error` (R21).
   */
  DIAS_HACIA_ATRAS: number;
}

export function loadWalletMovimientoConfig(): WalletMovimientoConfig {
  return {
    DIAS_HACIA_ATRAS: readPositiveInt("WALLET_MOVIMIENTO_DIAS_HACIA_ATRAS", 30),
  };
}

export const walletMovimientoConfig: WalletMovimientoConfig = loadWalletMovimientoConfig();
