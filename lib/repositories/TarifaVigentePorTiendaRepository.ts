import type {
  ITarifaVigentePorTiendaRepository,
  TarifaTxClient,
  TarifaVigente,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";

// Proyeccion unica de los 7 campos de la tarifa (misma en `findFirst` y en el batch).
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

/**
 * Feature 42 / feature 69 (R20/R22) — resolver de la TARIFA VIGENTE por TIENDA
 * (tabla `tarifas`, remodelada a "por tienda" por el PR #64). SOLO query Prisma.
 * `tarifas` borra en FISICO (ya no hay soft-delete que excluir). Si la tienda tiene
 * varias tarifas, se elige la MAS RECIENTE (`orderBy createdAt desc`, first) como resolucion determinista;
 * `null` si la tienda no tiene ninguna (gap R9: conceptos 0.00, no bloquea).
 * Money-safe: montos/porcentajes -> STRING escala 2 (el util los reconvierte a Decimal).
 *
 * TODO: (feature 69, decision (g) — override del humano, 2026-07-15) DEUDA CONOCIDA Y
 * ACEPTADA sobre `tarifas.status`. La columna `status` (activo/inactivo) existe desde el
 * PR #64 y HOY NO SE FILTRA aqui: el unico filtro de vigencia es `deleted_at IS NULL`. En
 * consecuencia, una tarifa `inactivo` no borrada sigue siendo candidata y PUEDE RESOLVERSE
 * COMO VIGENTE Y LIQUIDAR DINERO — incluida la de una tienda que dejo de ser `adminTienda`,
 * que es justo lo que `status` marca (db/schema.prisma:533).
 * LO PENDIENTE ES LA REGLA DE SELECCION DE LA FILA VIGENTE: decidir si `status` entra en el
 * WHERE, y que pasa con las tiendas que se queden sin candidata (=> `null` => gap (c) =>
 * conceptos 0.00). NO es "migrarlo a snapshot": el snapshot de la tarifa ya lo cubre R8 de
 * esta misma feature (`cierre_detail` congela los 7 valores + `tarifa_id` al solicitar).
 * Congelar NO corrige la seleccion: la vuelve permanente.
 * Salida prevista: feature 70 del backlog. Fijado por test (R22/R30): el `where` NO debe
 * mencionar `status` mientras esa decision no pase por una gate.
 */
export class TarifaVigentePorTiendaRepository implements ITarifaVigentePorTiendaRepository {
  constructor(private readonly prisma: TarifaTxClient) {}

  async resolveTarifaPorTienda(tiendaId: string): Promise<TarifaVigente | null> {
    const t = await this.prisma.tarifa.findFirst({
      // R20: por TIENDA (el PR #64 dropeo `tarifas.zona_id`). Ya no hay soft-delete que
      // excluir. Ver el TODO: `status` NO entra aqui (decision (g), feature 69).
      where: { tiendaId },
      orderBy: { createdAt: "desc" }, // R22: la mas reciente = la vigente
      select: TARIFA_SELECT,
    });
    if (t === null) return null; // gap de datos (R9)
    return toTarifaVigente(t);
  }

  /**
   * Feature 255 (design.md §4, decision D6) — TARIFA COTIZABLE de una tienda: en estado
   * `activo`; entre varias candidatas, la MAS RECIENTE
   * (`orderBy createdAt desc`, first). `null` si no hay ninguna.
   *
   * POR QUE ESTE METODO FILTRA `status` Y `resolveTarifaPorTienda` NO. No es una
   * inconsistencia ni un olvido: es la MISMA pregunta con dos respuestas porque el coste de
   * equivocarse es opuesto en cada camino.
   * - En el camino de liquidacion (carga/cierre), `null` NO bloquea: degrada a conceptos
   *   0.00 (gap R9 de la feature 69). Filtrar alli convertiria un cobro equivocado (tarifa
   *   `inactivo`) en un cobro CERO, y callado. Por eso la deuda (g) sigue abierta y su
   *   decision es de la feature 70, no de esta.
   * - En la COTIZACION, `null` no degrada a nada: dispara un `409` explicito (feature 255,
   *   R13) y no se emite ni un importe. Filtrar `status` aqui no puede producir un precio
   *   falso; produce una negativa nombrada. Ese es todo el argumento (R15).
   *
   * SALIDA NOMBRADA de la deuda: cuando la feature 70 cierre y el resolver compartido filtre
   * `status`, este metodo se COLAPSA en `resolveTarifaPorTienda` y se borra. Mientras tanto,
   * el `TODO:` de arriba y los tests que afirman la AUSENCIA de `status` en los dos metodos
   * existentes siguen siendo el contrato de aquel camino: este metodo no los toca.
   *
   * Riesgo declarado (ventana 255 <-> 70): una tarifa `inactivo` cotizara `409` y liquidara
   * contra esa misma tarifa en el cierre. Hoy es teorico — la 70 midio CERO tarifas inactivas
   * en produccion — y queda escrito para saber donde mirar el dia que exista la primera.
   */
  async resolveTarifaCotizablePorTienda(tiendaId: string): Promise<TarifaVigente | null> {
    const t = await this.prisma.tarifa.findFirst({
      // El WHERE de la cotizacion: `status: "activo"`, lo unico que lo separa del otro.
      where: { tiendaId, status: "activo" },
      orderBy: { createdAt: "desc" }, // la mas reciente entre las candidatas
      select: TARIFA_SELECT,
    });
    if (t === null) return null; // -> 409 en el borde de cotizacion (R13), nunca 0.00 (R15)
    return toTarifaVigente(t);
  }

  async resolveTarifasPorTiendas(
    tx: TarifaTxClient,
    tiendaIds: string[],
  ): Promise<Map<string, TarifaVigenteResuelta | null>> {
    const out = new Map<string, TarifaVigenteResuelta | null>();
    const unicas = [...new Set(tiendaIds)];
    for (const id of unicas) out.set(id, null); // gap R9 por defecto
    if (unicas.length === 0) return out;

    // Feature 69/design §3.1: UNA sola query para N tiendas (sin N+1). Misma regla que
    // `resolveTarifaPorTienda` (la mas reciente); `status` NO entra (g).
    const filas = await tx.tarifa.findMany({
      where: { tiendaId: { in: unicas } },
      orderBy: { createdAt: "desc" },
        // `fulfillment` va SOLO en el camino del snapshot (2026-08-19): `cierre_detail` lo
      // congela para mostrarlo, pero no es una entrada de la formula y por eso no esta en
      // `TARIFA_SELECT` ni en `toTarifaVigente`.
      select: { id: true, tiendaId: true, fulfillment: true, ...TARIFA_SELECT },
    });
    // `orderBy createdAt desc` + primera aparicion por tienda = la mas reciente (R22).
    for (const f of filas) {
      // `tiendaId` es nullable desde que existen tarifas no acotadas a una tienda; el
      // `where` de arriba ya las excluye (`in: unicas`), asi que esto no puede darse.
      // Se comprueba igual porque el tipo lo admite y `out` esta indexado por tienda.
      if (f.tiendaId === null) continue;
      if (out.get(f.tiendaId) !== null) continue;
      out.set(f.tiendaId, {
        tarifaId: f.id,
        fulfillment: f.fulfillment.toFixed(2),
        ...toTarifaVigente(f),
      });
    }
    return out;
  }
}
