import { Prisma } from "@prisma/client";

import type { MovimientoDelPeriodoRow, ParDeChip } from "@/lib/interfaces/repositories/IEstadoCuentaRepository";
import { WALLET_ORIGEN_TIPO_SEED, type WalletOrigenTipo } from "@/lib/types/wallet";
import {
  PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED,
  type PagoMensajeroMovimientoCategoria,
} from "@/lib/types/wallet-mensajero";
import {
  WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED,
  type WalletTiendaMovimientoCategoria,
} from "@/lib/types/wallet-tienda";
import {
  chipDeMensajero,
  chipDeTienda,
  type ChipBodega,
  type ChipMensajero,
  type ChipTienda,
} from "@/lib/utils/estado-cuenta-chips";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §3.2, D3, R20–R25) — lo PURO del estado de cuenta: el filtro del chip, los
// pares anulados y los totales netos del periodo. Sin repositorio ni servicio: se prueba solo.
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * El filtro de un chip como LISTA CERRADA de pares (categoria, origen[, es premio]): se recorren los
 * seeds con el MISMO diccionario total que rotula cada fila (`estado-cuenta-chips.ts`), asi que el
 * filtro y la fila no pueden discrepar.
 */
export function paresDeChipTienda(chip: ChipTienda): ParDeChip[] {
  const pares: ParDeChip[] = [];
  for (const categoria of WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED) {
    for (const origen of WALLET_ORIGEN_TIPO_SEED) {
      if (chipDeTienda(categoria, origen) === chip) pares.push({ categoria, origen });
    }
  }
  return pares;
}

export function paresDeChipMensajero(chip: ChipMensajero): ParDeChip[] {
  const pares: ParDeChip[] = [];
  for (const categoria of PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED) {
    for (const origen of WALLET_ORIGEN_TIPO_SEED) {
      for (const esPremio of [false, true]) {
        if (chipDeMensajero(categoria, origen, esPremio) === chip) pares.push({ categoria, origen, esPremio });
      }
    }
  }
  return pares;
}

export function paresDeChipBodega(chip: ChipBodega): ParDeChip[] {
  return [{ categoria: chip, origen: "cierre_bodega" }];
}

/**
 * D3 — la CLAVE que une una fila original con su contra-asiento en el libro de la TIENDA, y si la fila
 * es el contra-asiento. `null` = la fila no forma pares (lo que produce un cierre, una correccion).
 *
 *   pago a la tienda (172)        pago_tienda ↔ ajuste_credito               (origen pago_tienda, el pago)
 *   cobro de Ordenex (461)        cobro_manual (la fila) ↔ cobro_tienda_anulado (origen cobro_tienda)
 *   pago de un gasto (459)        pago_por_cuenta ↔ pago_por_cuenta_anulado  (el documento)
 *   pago de la tienda (457)       abono_tienda ↔ abono_tienda_anulado        (el documento)
 *   cobro por rechazo (458-B)     flete_devolucion ↔ flete_devolucion_anulado; IVA ↔ IVA (la gestion)
 */
export function claveDeParTienda(m: Pick<MovimientoDelPeriodoRow, "id" | "categoria" | "origenTipo" | "origenId">): {
  clave: string;
  esContra: boolean;
} | null {
  const c = m.categoria as WalletTiendaMovimientoCategoria;
  const o = m.origenTipo;
  if (o === "pago_tienda" && (c === "pago_tienda" || c === "ajuste_credito")) {
    return { clave: `pago:${m.origenId}`, esContra: c === "ajuste_credito" };
  }
  if (c === "cobro_manual") return { clave: `cobro:${m.id}`, esContra: false };
  if (c === "cobro_tienda_anulado") return { clave: `cobro:${m.origenId}`, esContra: true };
  if (c === "pago_por_cuenta" || c === "pago_por_cuenta_anulado") {
    return { clave: `ppc:${m.origenId}`, esContra: c === "pago_por_cuenta_anulado" };
  }
  if (c === "abono_tienda" || c === "abono_tienda_anulado") {
    return { clave: `abono:${m.origenId}`, esContra: c === "abono_tienda_anulado" };
  }
  if (o === "gestion_orden" && (c === "flete_devolucion" || c === "flete_devolucion_anulado")) {
    return { clave: `rf:${m.origenId}`, esContra: c === "flete_devolucion_anulado" };
  }
  if (o === "gestion_orden" && (c === "iva_flete_devolucion" || c === "iva_flete_devolucion_anulado")) {
    return { clave: `ri:${m.origenId}`, esContra: c === "iva_flete_devolucion_anulado" };
  }
  return null;
}

/**
 * D3 — lo mismo en el libro del MENSAJERO:
 *   pago (172/205)       liquidacion ↔ ajuste_devengo (origen pago_mensajero, el pago)
 *   premio (293)         premio_ranking ↔ ajuste_pago con el MISMO `premio_dia`
 */
export function claveDeParMensajero(
  m: Pick<MovimientoDelPeriodoRow, "tipo" | "categoria" | "origenTipo" | "origenId" | "premioDia">,
): { clave: string; esContra: boolean } | null {
  const c = m.categoria as PagoMensajeroMovimientoCategoria;
  // `premio_dia` SOLO lo llevan el premio (devengo) y su reverso (pago): ver `db/schema.prisma`.
  if (m.premioDia !== null) {
    return { clave: `premio:${m.premioDia.toISOString()}`, esContra: m.tipo === "pago" };
  }
  if (m.origenTipo === "pago_mensajero" && (c === "liquidacion" || c === "ajuste_devengo")) {
    return { clave: `pago:${m.origenId}`, esContra: c === "ajuste_devengo" };
  }
  return null;
}

/**
 * D3/R22 — abonos y cargos del periodo SIN los pares anulados DENTRO del periodo (original y
 * contra-asiento los dos en el conjunto). Un par a caballo de dos periodos NO se excluye: si se
 * quitara solo una mitad, `saldo inicial + abonos − cargos` dejaria de dar el saldo final.
 *
 * `esAbono` dice, por fila, si mueve el saldo a favor del titular de la cuenta.
 */
export function totalesNetos(
  filas: readonly MovimientoDelPeriodoRow[],
  clave: (m: MovimientoDelPeriodoRow) => { clave: string; esContra: boolean } | null,
  esAbono: (m: MovimientoDelPeriodoRow) => boolean,
): { abonos: string; cargos: string } {
  const lados = new Map<string, { original: boolean; contra: boolean }>();
  for (const m of filas) {
    const k = clave(m);
    if (k === null) continue;
    const lado = lados.get(k.clave) ?? { original: false, contra: false };
    if (k.esContra) lado.contra = true;
    else lado.original = true;
    lados.set(k.clave, lado);
  }
  let abonos = new Prisma.Decimal(0);
  let cargos = new Prisma.Decimal(0);
  for (const m of filas) {
    const k = clave(m);
    const lado = k === null ? undefined : lados.get(k.clave);
    if (lado !== undefined && lado.original && lado.contra) continue; // el par anulado, entero
    if (esAbono(m)) abonos = abonos.add(new Prisma.Decimal(m.monto));
    else cargos = cargos.add(new Prisma.Decimal(m.monto));
  }
  return { abonos: abonos.toFixed(2), cargos: cargos.toFixed(2) };
}

/**
 * R22 — el saldo al terminar el periodo: `inicial + abonos − cargos` (tienda y mensajero, donde el
 * saldo es A FAVOR del titular). En la bodega el «saldo» es lo que TIENE POR ENTREGAR, asi que su
 * abono (lo recibido) lo baja: `inicial + cargos − abonos` — la misma cuenta leida desde la bodega.
 */
export function saldoAlFinal(
  inicial: string,
  abonos: string,
  cargos: string,
  sentido: "a_favor_del_titular" | "por_entregar",
): string {
  const i = new Prisma.Decimal(inicial);
  const a = new Prisma.Decimal(abonos);
  const c = new Prisma.Decimal(cargos);
  return (sentido === "a_favor_del_titular" ? i.add(a).sub(c) : i.add(c).sub(a)).toFixed(2);
}

/** El origen tipado de una fila (la base lo guarda como enum; el DTO lo lleva como texto). */
export function comoOrigen(origen: string): WalletOrigenTipo {
  return origen as WalletOrigenTipo;
}
