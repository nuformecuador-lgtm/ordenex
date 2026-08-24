import type {
  ITarifaVigenteRepository,
  TarifaTxClient,
  TarifaVigente,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar, elegirPorCascada, whereCascada } from "@/lib/utils/cascada-tarifa";
import type { ParTarifa } from "@/lib/utils/cascada-tarifa";

// Proyeccion unica de los 7 campos de la formula (la misma en el singular y en el batch).
const TARIFA_SELECT = {
  valorFlete: true,
  valorFleteGam: true,
  valorFleteDevuelto: true,
  valorFleteDevueltoGam: true,
  comisionCod: true,
  ivaFlete: true,
  ivaComisionCod: true,
} as const;

interface TarifaDecimales {
  valorFlete: { toFixed(n: number): string };
  valorFleteGam: { toFixed(n: number): string };
  valorFleteDevuelto: { toFixed(n: number): string };
  valorFleteDevueltoGam: { toFixed(n: number): string };
  comisionCod: { toFixed(n: number): string };
  ivaFlete: { toFixed(n: number): string };
  ivaComisionCod: { toFixed(n: number): string };
}

// Fila tal como sale del `select` de abajo: los 7 decimales + lo que la regla y el snapshot
// necesitan. `tiendaId`/`zonaId` son nullables (feature 273) y por eso la regla los ve.
interface TarifaFila extends TarifaDecimales {
  id: string;
  tiendaId: string | null;
  zonaId: string | null;
  fulfillment: { toFixed(n: number): string };
}

// Money-safe: Decimal -> STRING escala 2 fija (nunca number/parseFloat).
function toTarifaVigente(t: TarifaDecimales): TarifaVigente {
  return {
    valorFlete: t.valorFlete.toFixed(2),
    valorFleteGam: t.valorFleteGam.toFixed(2),
    valorFleteDevuelto: t.valorFleteDevuelto.toFixed(2),
    valorFleteDevueltoGam: t.valorFleteDevueltoGam.toFixed(2),
    comisionCod: t.comisionCod.toFixed(2),
    ivaFlete: t.ivaFlete.toFixed(2),
    ivaComisionCod: t.ivaComisionCod.toFixed(2),
  };
}

// Proyeccion del singular: los 7 campos de la formula, sin `tarifaId` ni `fulfillment` (que
// son del camino del snapshot). Se escribe campo a campo a proposito: si manana `TarifaVigente`
// gana uno, el typecheck lo pide aqui en vez de dejarlo pasar con un spread.
function soloFormula(r: TarifaVigenteResuelta): TarifaVigente {
  return {
    valorFlete: r.valorFlete,
    valorFleteGam: r.valorFleteGam,
    valorFleteDevuelto: r.valorFleteDevuelto,
    valorFleteDevueltoGam: r.valorFleteDevueltoGam,
    comisionCod: r.comisionCod,
    ivaFlete: r.ivaFlete,
    ivaComisionCod: r.ivaComisionCod,
  };
}

function toTarifaVigenteResuelta(f: TarifaFila): TarifaVigenteResuelta {
  return {
    tarifaId: f.id,
    // `fulfillment` viaja SOLO por el camino del snapshot (2026-08-19): `cierre_detail` lo
    // congela para mostrarlo, pero no es una entrada de la formula y por eso no esta en
    // `TARIFA_SELECT` ni en `toTarifaVigente`.
    fulfillment: f.fulfillment.toFixed(2),
    ...toTarifaVigente(f),
  };
}

/**
 * Feature 42 / 69 / 274 — resolver de la TARIFA VIGENTE de un par (tienda, zona). SOLO query
 * Prisma: la REGLA no vive aqui, vive en el modulo puro `lib/utils/cascada-tarifa.ts`
 * (`whereCascada` + `elegirPorCascada`). Este repositorio solo trae las candidatas y proyecta
 * el resultado; por eso el listado y la liquidacion no pueden resolver filas distintas
 * (R8/R21) — no hay dos implementaciones que puedan divergir.
 *
 * `tarifas` borra en FISICO (la migracion tarifa_zona_is_default retiro `deleted_at`): no hay
 * soft-delete que excluir. `null` = ningun nivel de la cascada tiene fila (R2); es un gap de
 * datos que cada superficie trata a su manera y a proposito (R39): el listado muestra "0.00",
 * el cierre congela NULL y se crea igual, y las dos APIs por key devuelven 409.
 *
 * SIN `orderBy` (R5). Antes habia `orderBy: { createdAt: "desc" }` en los tres metodos, para
 * elegir "la mas reciente" entre varias candidatas de la misma tienda. El UNIQUE
 * (zona_id, tienda_id) NULLS NOT DISTINCT de la 273 garantiza como mucho UNA fila por nivel,
 * asi que el desempate por fecha sobra —y era ademas la causa de que una tarifa generica
 * recien creada le ganase a la especifica de la zona—. La resolucion es determinista sea cual
 * sea el orden en que la base devuelva las filas.
 *
 * DEUDA (g) DE LA FEATURE 69: PAGADA por esta feature. Aqui vivia un bloque `TODO:` que
 * declaraba que la columna de estado de `tarifas` existia desde el PR #64 y NO se filtraba en
 * el WHERE, de modo que una tarifa `inactivo` podia resolverse como vigente y liquidar dinero.
 * Lo pendiente era
 * la REGLA DE SELECCION de la fila vigente, no "migrarla a snapshot". La 274 la decide: la
 * migracion `drop_tarifa_status` elimina la columna y su enum, y la seleccion pasa a ser la
 * cascada (tienda, zona) de arriba. Una tarifa que no debe aplicarse se BORRA; ya no existe la
 * fila presente-pero-ignorada que la deuda describia. Con `status` muere tambien
 * `resolveTarifaCotizablePorTienda`, cuyo unico motivo de existir era ese filtro (R37).
 */
export class TarifaVigenteRepository implements ITarifaVigenteRepository {
  constructor(private readonly prisma: TarifaTxClient) {}

  /**
   * Singular: el batch con UN par (design §5, alternativa A descartada). No se hacen tres
   * `findFirst` en cascada porque eso serian hasta 3N viajes en el lote y, sobre todo, dos
   * implementaciones de la misma regla que podrian divergir.
   */
  async resolveTarifa(tiendaId: string, zonaId: string | null): Promise<TarifaVigente | null> {
    const par: ParTarifa = { tiendaId, zonaId };
    const resueltas = await this.resolveTarifas([par]);
    const resuelta = resueltas.get(clavePar(par)) ?? null;
    if (resuelta === null) return null; // sin tarifa (R2)
    // El singular no congela nada: `tarifaId`/`fulfillment` (camino del snapshot) no salen.
    return soloFormula(resuelta);
  }

  async resolveTarifas(
    pares: readonly ParTarifa[],
    tx?: TarifaTxClient,
  ): Promise<Map<string, TarifaVigenteResuelta | null>> {
    // Nadie pidio nada: Map vacio SIN ir a la base (el `where` seria `{ OR: [] }`, que en
    // Prisma no filtra nada y traeria la tabla entera).
    if (pares.length === 0) return new Map<string, TarifaVigenteResuelta | null>();

    // UNA sola query para N pares (R7). `tx` cuando el llamador esta dentro de una
    // `$transaction` (el cierre de dia); si no, el cliente del repo.
    const filas: TarifaFila[] = await (tx ?? this.prisma).tarifa.findMany({
      where: whereCascada(pares),
      // `zonaId` entra en el `select` porque la REGLA lo necesita para clasificar la fila en
      // su nivel; `id` y `fulfillment`, porque el snapshot los congela.
      select: { id: true, tiendaId: true, zonaId: true, fulfillment: true, ...TARIFA_SELECT },
    });

    const ganadoras = elegirPorCascada(filas, pares);

    const out = new Map<string, TarifaVigenteResuelta | null>();
    // Una entrada por CADA par pedido (R7): `elegirPorCascada` ya garantiza esa cobertura.
    for (const [clave, fila] of ganadoras) {
      out.set(clave, fila === null ? null : toTarifaVigenteResuelta(fila));
    }
    return out;
  }
}
