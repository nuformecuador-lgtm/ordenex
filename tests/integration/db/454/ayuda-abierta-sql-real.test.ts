import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";

import { conAyudaAbiertaDe, idsConAyudaAbierta } from "@/lib/repositories/ayuda-abierta";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.3, design §4.1; R22, R26) — LA DERIVACION DE «AYUDA ABIERTA», CONTRA POSTGRES.
 *
 * Una fila por cada salida de la tabla de §4.1, sembradas como FIXTURE con instantes EXPLICITOS
 * (la derivacion compara `created_at` estrictamente): la ida, las tres vueltas explicitas, la
 * gestion de la tienda, el corte, un ciclo nuevo en `en_reparto`, el empate de instantes de la
 * migracion M3 y la reapertura por una solicitud nueva. Transaccion que SIEMPRE se revierte.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const T = (min: number) => new Date(Date.UTC(2026, 8, 20, 15, min));

type Paso =
  | { evento: "ayuda_solicitada" | "ayuda_rescatada" | "ayuda_habilitada_api"; en: number }
  | { historial: string; en: number }
  | { gestionPendiente: true; en: number };

type Caso = { nombre: string; estatus: string; pasos: Paso[]; abierta: boolean };

const CASOS: Caso[] = [
  { nombre: "sin eventos de ayuda", estatus: "en_reparto", pasos: [], abierta: false },
  { nombre: "la IDA: solicitada", estatus: "en_reparto", pasos: [{ evento: "ayuda_solicitada", en: 10 }], abierta: true },
  {
    nombre: "historial ANTERIOR a la solicitud no la cierra",
    estatus: "en_reparto",
    pasos: [{ historial: "en_reparto", en: 5 }, { evento: "ayuda_solicitada", en: 10 }],
    abierta: true,
  },
  {
    nombre: "Recuperar / Habilitar (ayuda_rescatada) la cierra",
    estatus: "en_reparto",
    pasos: [{ evento: "ayuda_solicitada", en: 10 }, { evento: "ayuda_rescatada", en: 11 }],
    abierta: false,
  },
  {
    nombre: "la API (ayuda_habilitada_api) la cierra",
    estatus: "en_reparto",
    pasos: [{ evento: "ayuda_solicitada", en: 10 }, { evento: "ayuda_habilitada_api", en: 11 }],
    abierta: false,
  },
  {
    nombre: "una solicitud NUEVA tras un rescate la reabre",
    estatus: "en_reparto",
    pasos: [
      { evento: "ayuda_solicitada", en: 10 },
      { evento: "ayuda_rescatada", en: 11 },
      { evento: "ayuda_solicitada", en: 12 },
    ],
    abierta: true,
  },
  {
    nombre: "la tienda gestiona desde la ayuda (nace una gestion pendiente) la cierra",
    estatus: "en_reparto",
    pasos: [{ evento: "ayuda_solicitada", en: 10 }, { gestionPendiente: true, en: 11 }],
    abierta: false,
  },
  {
    nombre: "el corte (transicion posterior, estado novedad_interna) la cierra",
    estatus: "novedad_interna",
    pasos: [{ evento: "ayuda_solicitada", en: 10 }, { historial: "novedad_interna", en: 11 }],
    abierta: false,
  },
  {
    nombre: "R26: un ciclo NUEVO de vuelta en en_reparto NO la reabre",
    estatus: "en_reparto",
    pasos: [
      { evento: "ayuda_solicitada", en: 10 },
      { historial: "novedad_interna", en: 11 },
      { historial: "en_bodega_central", en: 12 },
      { historial: "en_reparto", en: 13 },
    ],
    abierta: false,
  },
  {
    nombre: "fuera de en_reparto no hay ayuda abierta aunque nada la cerrara",
    estatus: "entregado",
    pasos: [{ evento: "ayuda_solicitada", en: 10 }],
    abierta: false,
  },
  {
    nombre: "M3: rastro de historial en el MISMO instante que la solicitud → ABIERTA (estrictamente posterior)",
    estatus: "en_reparto",
    pasos: [{ historial: "en_reparto", en: 10 }, { evento: "ayuda_solicitada", en: 10 }],
    abierta: true,
  },
];

describeSiHayBase("454/T1.3 — ayuda abierta (Postgres real)", () => {
  let mundo: Mundo;
  let r: { porCaso: Map<string, boolean>; ids: Map<string, string>; filtrada: string[]; deLista: string[] };

  async function sembrar(e: Escenario, c: Caso): Promise<string> {
    const o = await e.sembrarOrden({ estatus: c.estatus as "en_reparto" });
    for (const p of c.pasos) {
      if ("evento" in p) {
        await e.tx.ordenEvento.create({
          data: {
            ordenId: o.ordenId,
            tipo: p.evento,
            mensajeroId: e.mensajeroId,
            actorUsuarioId: e.mensajeroId,
            actorRol: "mensajero",
            createdAt: T(p.en),
          },
        });
      } else if ("historial" in p) {
        await e.tx.ordenHistorialEstado.create({
          data: { ordenId: o.ordenId, estatusDestinoId: e.id(p.historial), origenTipo: "ajuste_estado", createdAt: T(p.en) },
        });
      } else {
        const g = await e.tx.gestionOrden.create({
          data: { ordenId: o.ordenId, mensajeroId: e.mensajeroId, resultado: "devolucion_a_origen_por_rechazo", createdAt: T(p.en) },
          select: { id: true },
        });
        await e.tx.ordenEvento.create({
          data: {
            ordenId: o.ordenId,
            tipo: "gestion_registrada",
            gestionOrdenId: g.id,
            familiaAplicacion: "gestion_tienda_ayuda",
            resultado: "devolucion_a_origen_por_rechazo",
            mensajeroId: e.mensajeroId,
            actorUsuarioId: e.tiendaId,
            actorRol: "adminTienda",
            createdAt: T(p.en),
          },
        });
      }
    }
    return o.ordenId;
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await conEscenario(mundo, async (e) => {
      const ids = new Map<string, string>();
      for (const c of CASOS) ids.set(c.nombre, await sembrar(e, c));
      const todos = [...ids.values()];
      const abiertas = await conAyudaAbiertaDe(e.tx, todos);
      const porCaso = new Map(CASOS.map((c) => [c.nombre, abiertas.has(ids.get(c.nombre) as string)]));
      // La forma con FILTRO: acotada a las ordenes de este mensajero (todas lo son).
      const filtrada = await idsConAyudaAbierta(
        e.tx,
        Prisma.sql`"o"."mensajero_asignado_id" = ${e.mensajeroId}`,
      );
      return { porCaso, ids, filtrada, deLista: [...abiertas] };
    });
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("precondicion: todos los casos sembrados y medidos", () => {
    expect(r.porCaso.size).toBe(CASOS.length);
  });

  for (const c of CASOS) {
    it(`${c.nombre} → abierta = ${c.abierta}`, () => {
      expect(r.porCaso.get(c.nombre)).toBe(c.abierta);
    });
  }

  it("la forma con filtro SQL da el mismo conjunto que la forma por lista", () => {
    const esperadas = CASOS.filter((c) => c.abierta).map((c) => r.ids.get(c.nombre)).sort();
    expect(esperadas.length).toBeGreaterThan(0);
    expect([...r.filtrada].sort()).toEqual(esperadas);
    expect([...r.deLista].sort()).toEqual(esperadas);
  });

  it("lista vacia → conjunto vacio sin consultar", async () => {
    const vacio = await conAyudaAbiertaDe(
      { $queryRaw: () => { throw new Error("no deberia consultar"); } } as never,
      [],
    );
    expect(vacio.size).toBe(0);
  });
});
