import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import type { PrismaClient } from "@prisma/client";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";
import { RankingRepository } from "@/lib/repositories/RankingRepository";
import { ORIGENES_INCIDENTE_ADMIN } from "@/lib/services/IncidenteAdminService";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";

// Feature 158 (T1.30, R38/R56/R63/R64) — AISLAMIENTO del camino del ADMIN.
//
// Este archivo es el corazon de la fase, no un extra. El hallazgo que decidio todo el diseno
// (design §9.7) es que un incidente del admin NO puede ser una fila de `gestion_orden`, porque
// `CorteDiarioRepository.findMensajerosConActividadSinCierre` consulta
// `{ cierreId: null, anuladaAt: null }` con `distinct: ["mensajeroId"]` SIN filtrar rol ni
// resultado: le crearia al ADMIN un `cierre_dia` `vencido` y BLOQUEANTE que no puede resolver,
// porque `CierreDiaService` esta acotado por rol al `mensajero`.
//
// Se verifica en las DOS direcciones: (a) con el diseno elegido el corte NO devuelve al autor, y
// (b) con la alternativa DESCARTADA si lo devolveria — ese control es lo que hace que el caso no
// sea vacuo. Sin el, «no aparece» podria ser cierto por la razon equivocada (por ejemplo, porque
// el doble esta vacio).

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
// Feature 246 (T2.2): el corte recibe el dia que la corrida CIERRA. Aqui es irrelevante —lo que
// se mide es que el autor del incidente no entre por ninguna rama— pero el parametro es
// obligatorio a proposito: olvidar cablearlo rompe el typecheck en vez de dejar el corte mudo.
const DIA_CERRADO = new Date("2026-08-20T00:00:00.000Z");

const AUTOR_ADMIN = "u-admin";
const MENSAJERO = "u-men";
const HOY = new Date("2026-07-30T06:00:00.000Z");
const MANANA = new Date("2026-07-31T06:00:00.000Z");

/** Doble de Prisma que HONRA los `where` que estos dos repos usan. */
function buildPrisma(opts: {
  /** Filas REALES de `gestion_orden` (lo que el camino del admin NO crea). */
  gestiones?: Array<{
    mensajeroId: string;
    cierreId: string | null;
    anuladaAt: Date | null;
    resultado: string;
    createdAt: Date;
    zonaId: string;
  }>;
  /** Ordenes por estado (para la rama `en_reparto` del corte). */
  ordenes?: Array<{ mensajeroAsignadoId: string | null; estatusValue: string; zonaId: string }>;
}) {
  const gestiones = opts.gestiones ?? [];
  const ordenes = opts.ordenes ?? [];
  return {
    gestionOrden: {
      findMany: vi.fn(async (arg: { where: Record<string, unknown> }) => {
        const w = arg.where;
        const filtradas = gestiones.filter(
          (g) =>
            (w.cierreId === undefined || g.cierreId === w.cierreId) &&
            (w.anuladaAt === undefined || g.anuladaAt === w.anuladaAt),
        );
        // `distinct: ["mensajeroId"]`.
        const vistos = new Set<string>();
        return filtradas
          .filter((g) => (vistos.has(g.mensajeroId) ? false : (vistos.add(g.mensajeroId), true)))
          .map((g) => ({ mensajeroId: g.mensajeroId, mensajero: { zonaId: g.zonaId } }));
      }),
      groupBy: vi.fn(async (arg: { where: Record<string, unknown> }) => {
        const w = arg.where as {
          resultado?: string;
          anuladaAt?: Date | null;
          createdAt?: { gte: Date; lt: Date };
        };
        const filtradas = gestiones.filter(
          (g) =>
            (w.resultado === undefined || g.resultado === w.resultado) &&
            (w.anuladaAt === undefined || g.anuladaAt === w.anuladaAt) &&
            (w.createdAt === undefined ||
              (g.createdAt >= w.createdAt.gte && g.createdAt < w.createdAt.lt)),
        );
        const conteo = new Map<string, number>();
        for (const g of filtradas) conteo.set(g.mensajeroId, (conteo.get(g.mensajeroId) ?? 0) + 1);
        return [...conteo.entries()].map(([mensajeroId, n]) => ({
          mensajeroId,
          _count: { _all: n },
        }));
      }),
    },
    orden: {
      findMany: vi.fn(async (arg: { where: { estatus?: { value: string } } }) => {
        const value = arg.where.estatus?.value;
        return ordenes
          .filter((o) => o.estatusValue === value && o.mensajeroAsignadoId !== null)
          .map((o) => ({
            mensajeroAsignadoId: o.mensajeroAsignadoId,
            mensajeroAsignado: { zonaId: o.zonaId },
          }));
      }),
      groupBy: vi.fn(async () => []),
    },
    cierreDia: { findMany: vi.fn(async () => []) },
  };
}

describe("R38 — un incidente del ADMIN no hace que el corte diario devuelva a su autor", () => {
  it("con el diseno elegido (tabla propia): el autor NO entra en el corte", async () => {
    // El camino del admin NO crea ninguna fila de `gestion_orden` y deja la orden en `incidente`
    // (no en `en_reparto`), asi que ninguna de las DOS ramas del corte lo alcanza.
    const prisma = buildPrisma({
      gestiones: [], // el reporte del admin no produce gestiones
      ordenes: [{ mensajeroAsignadoId: AUTOR_ADMIN, estatusValue: "incidente", zonaId: "z1" }],
    });
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    expect(rows.map((r) => r.mensajeroId)).not.toContain(AUTOR_ADMIN);
    expect(rows).toEqual([]);
  });

  it("CONTROL (§9.7): con la alternativa DESCARTADA el corte SI lo devolveria", async () => {
    // Este caso reproduce el bug que el diseno evita: si el incidente del admin fuera una fila
    // de `gestion_orden` con el admin en `mensajero_id`, el corte lo trataria como «mensajero con
    // actividad del dia sin cerrar» y le crearia un `cierre_dia` VENCIDO y bloqueante que el no
    // puede resolver. Es el control que impide que el caso de arriba pase por la razon
    // equivocada.
    const prisma = buildPrisma({
      gestiones: [
        {
          mensajeroId: AUTOR_ADMIN, // <- la alternativa descartada
          cierreId: null,
          anuladaAt: null,
          resultado: "incidente",
          createdAt: HOY,
          zonaId: "z1",
        },
      ],
    });
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    expect(rows.map((r) => r.mensajeroId)).toContain(AUTOR_ADMIN);
  });

  it("el corte SIGUE devolviendo al MENSAJERO con su gestion `incidente` sin cerrar (R16)", async () => {
    // El aislamiento del camino del admin NO puede llevarse por delante el del mensajero: su
    // gestion `incidente` entra en su cierre como cualquier otra.
    const prisma = buildPrisma({
      gestiones: [
        {
          mensajeroId: MENSAJERO,
          cierreId: null,
          anuladaAt: null,
          resultado: "incidente",
          createdAt: HOY,
          zonaId: "z1",
        },
      ],
    });
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre(DIA_CERRADO);

    expect(rows.map((r) => r.mensajeroId)).toEqual([MENSAJERO]);
  });
});

describe("R38 — el ranking diario no cuenta el incidente del admin", () => {
  it("`contarEntregadasPorMensajero` solo cuenta `entregada`: ni el admin ni su incidente entran", async () => {
    const prisma = buildPrisma({
      gestiones: [
        {
          mensajeroId: MENSAJERO,
          cierreId: null,
          anuladaAt: null,
          resultado: "entregada",
          createdAt: HOY,
          zonaId: "z1",
        },
        {
          mensajeroId: MENSAJERO,
          cierreId: null,
          anuladaAt: null,
          resultado: "incidente",
          createdAt: HOY,
          zonaId: "z1",
        },
      ],
    });
    const repo = new RankingRepository(prisma as unknown as PrismaClient);

    const rows = await repo.contarEntregadasPorMensajero(HOY, MANANA);

    // La gestion `incidente` del MENSAJERO tampoco suma al numerador (solo `entregada`).
    expect(rows).toEqual([{ mensajeroId: MENSAJERO, total: 1 }]);
    expect(rows.map((r) => r.mensajeroId)).not.toContain(AUTOR_ADMIN);
    const where = (prisma.gestionOrden.groupBy.mock.calls[0][0] as { where: { resultado: string } })
      .where;
    expect(where.resultado).toBe("entregada");
  });
});

describe("R38/R63 — el camino del ADMIN no toca ninguna tabla del mensajero (estructural)", () => {
  const leer = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
  /**
   * Quita comentarios de bloque y de linea para no afirmar sobre prosa.
   *
   * Feature 209 — quitador COMPARTIDO. La copia local solo borraba la linea de comentario
   * COMPLETA, asi que un `prisma.gestionOrden` citado al final de una linea de codigo
   * sobrevivia y esta guardia de AISLAMIENTO lo leia como un acceso real. Medido sobre los
   * 12 modulos que censa: ninguno de los 7 patrones cambia de veredicto.
   */
  const sinComentarios = quitarComentarios;

  const MODULOS_DEL_ADMIN = [
    "lib/repositories/IncidenteAdminRepository.ts",
    "lib/services/IncidenteAdminService.ts",
    "lib/services/WalletIndemnizacionIncidenteFeedService.ts",
    "lib/actions/incidentes.ts",
  ];

  it.each(MODULOS_DEL_ADMIN)("%s NO escribe ni lee `gestion_orden`", (modulo) => {
    // Es la afirmacion que sostiene R38 entera: sin fila de gestion, el corte diario, el cierre
    // del dia y el ranking no pueden verlo. Si alguien "unificara" los dos caminos, rompe aqui.
    const src = sinComentarios(leer(modulo));
    expect(src, `${modulo} toca gestionOrden`).not.toMatch(/\bgestionOrden\b/);
    expect(src, `${modulo} toca gestion_orden`).not.toMatch(/gestion_orden/);
  });

  it.each(MODULOS_DEL_ADMIN)("%s NO toca `cierre_dia` ni el libro del pago al mensajero", (modulo) => {
    const src = sinComentarios(leer(modulo));
    expect(src).not.toMatch(/\bcierreDia\b/);
    expect(src).not.toMatch(/\bpagoMensajeroMovimiento\b/);
    // R63: tampoco el ledger POR TIENDA (Q-E dejo ese credito fuera de alcance, con follow-up).
    expect(src).not.toMatch(/\bwalletTiendaMovimiento\b/);
  });

  it.each([
    "lib/repositories/CorteDiarioRepository.ts",
    "lib/repositories/RankingRepository.ts",
    "lib/repositories/CierreDiaRepository.ts",
    "lib/repositories/CierresAdminRepository.ts",
    "lib/services/CierreDiaService.ts",
    "lib/services/CierresAdminService.ts",
    "lib/services/WalletTiendaFeedService.ts",
    "lib/services/WalletMensajeroFeedService.ts",
  ])("%s NO conoce `orden_incidente` (la direccion contraria del aislamiento)", (modulo) => {
    const src = sinComentarios(leer(modulo));
    expect(src, `${modulo} lee ordenIncidente`).not.toMatch(/\bordenIncidente\b/);
    expect(src).not.toMatch(/orden_incidente/);
  });

  it("el stripper de comentarios DISCRIMINA (de el depende todo lo anterior)", () => {
    expect(sinComentarios("// gestionOrden en un comentario")).not.toMatch(/gestionOrden/);
    expect(sinComentarios("/* bloque con gestionOrden */")).not.toMatch(/gestionOrden/);
    expect(sinComentarios("await tx.gestionOrden.create()")).toMatch(/gestionOrden/);
  });
});

describe("R56 — una orden NO puede acumular DOS egresos de indemnizacion pagados", () => {
  it("los dos caminos son mutuamente EXCLUYENTES por el grafo: sus origenes son disjuntos", () => {
    // El reporte del mensajero exige `en_reparto` (arista #44); el del admin, uno de los CINCO.
    // Una orden esta en UN estado, asi que en un instante dado solo uno de los dos es posible.
    expect([...ORIGENES_INCIDENTE_ADMIN]).not.toContain("en_reparto");
    const entradasDelMensajero = Object.entries(TRANSICIONES)
      .filter(([, ds]) =>
        ds.some((d) => d.to === "incidente" && (d.via as string) === "gestion"),
      )
      .map(([o]) => o);
    // Tras Q-G la #44 lleva familia `incidente`, asi que NO hay ninguna entrada con familia
    // `gestion`: el reporte del mensajero se identifica por su ORIGEN, `en_reparto`.
    expect(entradasDelMensajero).toEqual([]);
    expect(TRANSICIONES.en_reparto.some((d) => d.to === "incidente")).toBe(true);
  });

  it("desde `incidente` NO se vuelve a `en_reparto` por el camino del ADMIN", () => {
    // Si la reversion del admin pudiera dejar la orden en `en_reparto`, un admin podria mandarla
    // al camino del mensajero y cobrarla dos veces. La unica arista hacia `en_reparto` es #53,
    // que exige una GESTION del propio mensajero (y anularla la deja sin pagar).
    const haciaEnReparto = TRANSICIONES.incidente.filter((d) => d.to === "en_reparto");
    expect(haciaEnReparto).toHaveLength(1);
    expect(haciaEnReparto[0].via).toBe("deshacer_gestion");
    // Y ninguna de las reversiones del ADMIN (familia `incidente`) apunta a `en_reparto`.
    const reversionesAdmin = TRANSICIONES.incidente.filter((d) => d.via === "incidente");
    expect(reversionesAdmin.map((d) => d.to)).not.toContain("en_reparto");
    expect(reversionesAdmin.map((d) => d.to).sort()).toEqual([...ORIGENES_INCIDENTE_ADMIN].sort());
  });

  it("los cinco origenes del admin NO son alcanzables DESDE `en_reparto` sin pasar por otro flujo", () => {
    // `en_reparto` no vuelve a bodega ni a `por_recoger` por si solo: sus salidas son los cinco
    // desenlaces de gestion + el corte. Asi que una orden gestionada como `incidente` por el
    // mensajero no puede caer despues en un origen del admin sin deshacer antes esa gestion.
    const salidasDeEnReparto = TRANSICIONES.en_reparto.map((d) => d.to as string);
    for (const origen of ORIGENES_INCIDENTE_ADMIN) {
      expect(salidasDeEnReparto, `en_reparto -> ${origen} no deberia existir`).not.toContain(
        origen,
      );
    }
  });
});
