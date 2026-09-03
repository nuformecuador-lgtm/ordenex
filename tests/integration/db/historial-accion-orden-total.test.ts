import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { HistorialAccionRepository } from "@/lib/repositories/HistorialAccionRepository";
import type {
  FiltroHistorialAccionResuelto,
  OrdenHistorialAccion,
} from "@/lib/interfaces/repositories/IHistorialAccionRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 362 / T4.1 (R22-R25, R30) — EL ORDEN TIENE QUE SER TOTAL, Y AQUI EL EMPATE ES LA NORMA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ LAS CIFRAS DEL CORPUS, Y POR QUE SON ESTAS. El corpus tiene **UN LOTE DE 130 FILAS QUE
// COMPARTEN `created_at` AL MILISEGUNDO** (nacen del mismo `CURRENT_TIMESTAMP` de una sola
// transaccion, que es exactamente como nacen en produccion), mas 20 filas de otros dos instantes.
// Se pagina de 25 en 25, asi que el grupo empatado cruza **CINCO** cortes de pagina.
//
// **CON UN CORPUS PEQUEÑO ESTA SUITE NO VALDRIA NADA.** Es el hallazgo nº 1 de
// `progress/impl_352.md`, medido en este mismo repo: con pocas filas Postgres ordena el conjunto
// entero y devuelve el mismo orden en las dos consultas, asi que **la mutacion «quitar el
// desempate» SOBREVIVE EN VERDE**. Lo que la caza es que el planificador tenga margen para
// resolver el empate de forma distinta entre un `OFFSET 0` y un `OFFSET 25`.
//
// La 352 lo midio con 440 de 909 ordenes compartiendo instante: 200 filas distintas de 241 al
// recorrer 10 paginas. Aqui el empate no es un accidente de la carga masiva, es LA NORMA: un
// borrado de 79 ordenes produce 79 filas del mismo instante.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Marca del corpus de esta corrida: aisla las filas de las que ya haya en la base. */
const MARCA = `362-orden-${Date.now().toString(36)}`;

/** ⭑ EL LOTE EMPATADO. 130 > 5 paginas de 25: el grupo cruza cinco cortes. */
const FILAS_DEL_LOTE = 130;
const PAGINA = 25;
/** Dos instantes mas, para que el orden por fecha tenga algo que ordenar ademas del empate. */
const FILAS_ANTES = 10;
const FILAS_DESPUES = 10;
const TOTAL = FILAS_ANTES + FILAS_DEL_LOTE + FILAS_DESPUES;

/** El filtro que acota el corpus a ESTA corrida. */
const FILTRO: FiltroHistorialAccionResuelto = {
  q: MARCA,
  actorId: null,
  accion: null,
  entidadTipo: null,
  desde: null,
  hasta: null,
};

const DESC: OrdenHistorialAccion = { sortBy: "created_at", sortDir: "desc" };
const ASC: OrdenHistorialAccion = { sortBy: "created_at", sortDir: "asc" };

describeSiHayBase("362/T4.1 — el orden del listado es TOTAL (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Siembra el corpus. Las 130 filas del lote se insertan con UN SOLO `createMany`, asi que toman
   * el MISMO `CURRENT_TIMESTAMP` — no se les fija la fecha a mano: se reproduce el mecanismo real.
   */
  async function sembrar(tx: TxDeTest): Promise<void> {
    const base = (n: number, etiqueta: string, createdAt?: Date) => ({
      id: randomUUID(),
      accion: "orden_eliminada" as const,
      entidadTipo: "orden" as const,
      entidadId: randomUUID(),
      entidadEtiqueta: `${MARCA} ${etiqueta} ${String(n).padStart(3, "0")}`,
      actorUsuarioId: null,
      actorNombre: null,
      actorRol: null,
      monto: null,
      valorAnterior: null,
      valorNuevo: null,
      loteId: randomUUID(),
      ...(createdAt !== undefined ? { createdAt } : {}),
    });

    await tx.historialAccion.createMany({
      data: Array.from({ length: FILAS_ANTES }, (_, i) =>
        base(i, "antes", new Date("2026-09-01T10:00:00.000Z")),
      ),
    });
    // ⭑ EL LOTE: sin `createdAt` explicito -> lo pone el DEFAULT de la columna, que es el
    // `CURRENT_TIMESTAMP` de ESTA transaccion. Las 130 filas empatan al milisegundo.
    const loteComun = randomUUID();
    await tx.historialAccion.createMany({
      data: Array.from({ length: FILAS_DEL_LOTE }, (_, i) => ({
        ...base(i, "lote"),
        loteId: loteComun,
      })),
    });
    await tx.historialAccion.createMany({
      data: Array.from({ length: FILAS_DESPUES }, (_, i) =>
        base(i, "despues", new Date("2026-09-03T10:00:00.000Z")),
      ),
    });
  }

  /** Recorre TODAS las paginas y devuelve los ids en el orden en que salieron. */
  async function recorrer(
    repo: HistorialAccionRepository,
    orden: OrdenHistorialAccion,
  ): Promise<string[]> {
    const ids: string[] = [];
    const paginas = Math.ceil(TOTAL / PAGINA);
    for (let p = 1; p <= paginas; p++) {
      const pagina = await repo.list({ filtro: FILTRO, orden, page: p, pageSize: PAGINA });
      ids.push(...pagina.items.map((f) => f.id));
    }
    return ids;
  }

  it("ANTI-VACUIDAD: el corpus tiene 130 filas del MISMO instante, y cruza 5 cortes de pagina", async () => {
    // Sin este caso, todo lo de abajo podria estar verde sobre un corpus de tres filas — que es
    // exactamente donde la mutacion del desempate SOBREVIVE.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await sembrar(tx);
      const filas = await tx.historialAccion.findMany({
        where: { entidadEtiqueta: { contains: MARCA } },
        select: { createdAt: true },
      });
      const porInstante = new Map<number, number>();
      for (const f of filas) {
        const k = f.createdAt.getTime();
        porInstante.set(k, (porInstante.get(k) ?? 0) + 1);
      }
      return { total: filas.length, mayorGrupo: Math.max(...porInstante.values()) };
    });

    expect(r.total).toBe(TOTAL);
    expect(r.mayorGrupo, "el lote no quedo empatado: este archivo no mediria nada").toBe(
      FILAS_DEL_LOTE,
    );
    expect(Math.floor(r.mayorGrupo / PAGINA)).toBeGreaterThanOrEqual(5);
  });

  it("⭑ R24: recorrer todas las paginas en `desc` no repite NI PIERDE ninguna fila", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await sembrar(tx);
      const repo = new HistorialAccionRepository(tx as unknown as PrismaClient);
      return recorrer(repo, DESC);
    });

    expect(r).toHaveLength(TOTAL);
    // ⭑ LA ASERCION QUE MATA LA MUTACION: sin el desempate, el `Set` sale mas pequeño que el
    // array —una fila salio dos veces y otra no salio nunca—. Es el defecto medido de la 352:
    // 200 filas distintas de 241.
    expect(
      new Set(r).size,
      "una fila salio dos veces y otra no salio en ninguna pagina: falta el desempate",
    ).toBe(TOTAL);
  });

  it("⭑ R24: lo mismo en `asc` — invertir el orden no puede reintroducir el agujero", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await sembrar(tx);
      const repo = new HistorialAccionRepository(tx as unknown as PrismaClient);
      return recorrer(repo, ASC);
    });

    expect(r).toHaveLength(TOTAL);
    expect(new Set(r).size).toBe(TOTAL);
  });

  it("⭑ R25: pedir DOS VECES la misma pagina devuelve exactamente lo mismo, en el mismo orden", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await sembrar(tx);
      const repo = new HistorialAccionRepository(tx as unknown as PrismaClient);
      // La pagina 3 cae DENTRO del grupo empatado (filas 51-75 del conjunto): es donde el orden
      // indefinido se manifiesta.
      const args = { filtro: FILTRO, orden: DESC, page: 3, pageSize: PAGINA };
      const una = await repo.list(args);
      const otra = await repo.list(args);
      return { una: una.items.map((f) => f.id), otra: otra.items.map((f) => f.id) };
    });

    expect(r.una).toHaveLength(PAGINA);
    expect(r.otra).toEqual(r.una);
  });

  it("R23: dentro del grupo empatado, el orden relativo es el del `id` ASC en las dos direcciones", async () => {
    // La propiedad concreta del desempate: `id` es la PK, unica y NOT NULL, y su orden es FIJO
    // `asc` — no acompaña a `sortDir`, porque lo que la paginacion necesita no es que signifique
    // algo, sino que sea EL MISMO en las dos consultas.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await sembrar(tx);
      const repo = new HistorialAccionRepository(tx as unknown as PrismaClient);
      const desc = await recorrer(repo, DESC);
      const filas = await tx.historialAccion.findMany({
        where: { id: { in: desc } },
        select: { id: true, createdAt: true },
      });
      const instantePorId = new Map(filas.map((f) => [f.id, f.createdAt.getTime()]));
      // El instante del grupo grande: el que mas se repite.
      const cuenta = new Map<number, number>();
      for (const t of instantePorId.values()) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
      const instanteDelLote = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return desc.filter((id) => instantePorId.get(id) === instanteDelLote);
    });

    expect(r).toHaveLength(FILAS_DEL_LOTE);
    expect(r, "el desempate por `id` no se aplico dentro del grupo empatado").toEqual(
      [...r].sort(),
    );
  });

  it("R22: la pagina trae `pageSize` filas y el `total` es el del CONJUNTO ENTERO", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await sembrar(tx);
      const repo = new HistorialAccionRepository(tx as unknown as PrismaClient);
      return repo.list({ filtro: FILTRO, orden: DESC, page: 1, pageSize: PAGINA });
    });

    expect(r.items).toHaveLength(PAGINA);
    expect(r.total, "el `total` es un `count` del conjunto, no de la pagina").toBe(TOTAL);
    expect(r.total).toBeGreaterThan(r.items.length);
  });

  it("⭑ R30: la DESCARGA sale en el MISMO orden que la pantalla, fila a fila", async () => {
    // Si divergieran, la fila 26 del archivo dejaria de ser la primera de la pagina 2 y ninguna
    // pantalla lo diria.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await sembrar(tx);
      const repo = new HistorialAccionRepository(tx as unknown as PrismaClient);
      const pantalla = await recorrer(repo, DESC);
      const descarga = await repo.listAll({ filtro: FILTRO, orden: DESC, limite: TOTAL + 1 });
      return { pantalla, descarga: descarga.map((f) => f.id) };
    });

    expect(r.descarga).toHaveLength(TOTAL);
    expect(r.descarga).toEqual(r.pantalla);
  });

  it("R26: el defecto (`desc`) pone lo MAS RECIENTE primero, y `asc` lo invierte", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await sembrar(tx);
      const repo = new HistorialAccionRepository(tx as unknown as PrismaClient);
      const desc = await repo.list({ filtro: FILTRO, orden: DESC, page: 1, pageSize: 3 });
      const asc = await repo.list({ filtro: FILTRO, orden: ASC, page: 1, pageSize: 3 });
      return {
        desc: desc.items.map((f) => f.entidadEtiqueta),
        asc: asc.items.map((f) => f.entidadEtiqueta),
      };
    });

    // Las 10 «despues» son del 3 de septiembre; las 10 «antes», del 1.
    for (const etiqueta of r.desc) expect(etiqueta).toContain("despues");
    for (const etiqueta of r.asc) expect(etiqueta).toContain("antes");
  });
});
