import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import {
  CORTE_FUTURO,
  crearOrden,
  crearZona,
  mas,
  repoDeTest,
  sembrarBase475,
  transicion,
} from "./_informe-transito-475";

// Ficha 475 (T2.5) — R11, R12, R13, R14: el instante del hito sale del historial de estados.
// Mata M6 (MAX), M7 (sin filtro de destino), M8 (guia sin la rama de creacion en
// por_recolectar_en_tienda) y M10 (contarSinHito sin filtro de estados).
//
// Correr: `pnpm exec vitest run tests/integration/db/informe-transito-hitos.test.ts` con
// DATABASE_URL (sin base, se SALTA).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const T0 = new Date("2001-05-01T15:00:00.000Z");

describeSiHayBase("475/R11-R14 — hitos", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ R11: entrada a bodega central = la PRIMERA transicion con destino en_bodega_central", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase475(tx);
      const z = await crearZona(tx, base, "central");
      // Reingreso: entra el dia 1, sale el 2, vuelve el 3. El hito es el dia 1.
      const re = await crearOrden(tx, base, { clave: "reingreso", zonaId: z, estado: "en_bodega_central", createdAt: T0 });
      await transicion(tx, base, re.id, { at: T0, origen: null, destino: "en_preparacion" });
      await transicion(tx, base, re.id, { at: mas(T0, 1), origen: "en_preparacion", destino: "en_bodega_central", origenTipo: "generacion_guia" });
      await transicion(tx, base, re.id, { at: mas(T0, 2), origen: "en_bodega_central", destino: "en_reparto", origenTipo: "recoleccion" });
      await transicion(tx, base, re.id, { at: mas(T0, 3), origen: "en_reparto", destino: "en_bodega_central", origenTipo: "liberacion_reprogramada" });
      // Transiciones a OTROS destinos no cuentan: solo la de destino central (dia 4).
      const otra = await crearOrden(tx, base, { clave: "otra", zonaId: z, estado: "en_bodega_central", createdAt: T0 });
      await transicion(tx, base, otra.id, { at: T0, origen: null, destino: "por_recolectar_en_tienda" });
      await transicion(tx, base, otra.id, { at: mas(T0, 2), origen: "por_recolectar_en_tienda", destino: "en_ruta_bodega_central", origenTipo: "recoleccion_tienda" });
      await transicion(tx, base, otra.id, { at: mas(T0, 4), origen: "en_ruta_bodega_central", destino: "en_bodega_central", origenTipo: "recepcion_bodega_central" });
      const filas = await repoDeTest(tx).filasEnAlerta({
        hito: "entrada_bodega_central",
        estados: ["en_bodega_central"],
        cortes: [{ zonaId: z, corte: CORTE_FUTURO }],
      });
      return { hitos: new Map(filas.map((f) => [f.ordenId, f.hitoAt.toISOString()])), re: re.id, otra: otra.id };
    });
    expect(r.hitos.get(r.re)).toBe(mas(T0, 1).toISOString());
    expect(r.hitos.get(r.otra)).toBe(mas(T0, 4).toISOString());
  });

  it("R12: creacion = orden.created_at, sin mirar el historial", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase475(tx);
      const z = await crearZona(tx, base, "creacion");
      const o = await crearOrden(tx, base, { clave: "c", zonaId: z, estado: "en_reparto", createdAt: mas(T0, -7) });
      await transicion(tx, base, o.id, { at: T0, origen: null, destino: "en_preparacion" });
      const filas = await repoDeTest(tx).filasEnAlerta({
        hito: "creacion",
        estados: ["en_reparto"],
        cortes: [{ zonaId: z, corte: CORTE_FUTURO }],
      });
      return filas.map((f) => [f.ordenId === o.id, f.hitoAt.toISOString()]);
    });
    expect(r).toEqual([[true, mas(T0, -7).toISOString()]]);
  });

  it("⭑ R13: generacion de guia = la mas antigua de generacion_guia, creacion en por_recolectar_en_tienda y ruteo_satelite; sin num_guia no hay hito", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase475(tx);
      const z = await crearZona(tx, base, "guia");
      const est = "en_reparto";
      // G1: nace en preparacion (no cuenta) y genera guia el dia 2.
      const g1 = await crearOrden(tx, base, { clave: "g1", zonaId: z, estado: est, createdAt: T0 });
      await transicion(tx, base, g1.id, { at: T0, origen: null, destino: "en_preparacion" });
      await transicion(tx, base, g1.id, { at: mas(T0, 2), origen: "en_preparacion", destino: "en_bodega_central", origenTipo: "generacion_guia" });
      // G2: nace con guia en por_recolectar_en_tienda (dia 0) y se rutea a satelite el dia 5.
      const g2 = await crearOrden(tx, base, { clave: "g2", zonaId: z, estado: est, createdAt: T0 });
      await transicion(tx, base, g2.id, { at: T0, origen: null, destino: "por_recolectar_en_tienda", origenTipo: "carga_api" });
      await transicion(tx, base, g2.id, { at: mas(T0, 5), origen: "en_bodega_central", destino: "en_ruta_bodega_satelite", origenTipo: "ruteo_satelite" });
      // G3: solo ruteo a satelite el dia 3 (la creacion en preparacion no cuenta).
      const g3 = await crearOrden(tx, base, { clave: "g3", zonaId: z, estado: est, createdAt: T0 });
      await transicion(tx, base, g3.id, { at: T0, origen: null, destino: "en_preparacion" });
      await transicion(tx, base, g3.id, { at: mas(T0, 3), origen: "en_bodega_central", destino: "en_ruta_bodega_satelite", origenTipo: "ruteo_satelite" });
      // G4: tiene la transicion pero NO num_guia -> sin hito.
      const g4 = await crearOrden(tx, base, { clave: "g4", zonaId: z, estado: est, createdAt: T0, conGuia: false });
      await transicion(tx, base, g4.id, { at: mas(T0, 1), origen: "en_preparacion", destino: "en_bodega_central", origenTipo: "generacion_guia" });
      const consulta = { hito: "generacion_guia" as const, estados: [est], cortes: [{ zonaId: z, corte: CORTE_FUTURO }] };
      const filas = await repoDeTest(tx).filasEnAlerta(consulta);
      const sinHito = await repoDeTest(tx).contarSinHito(consulta);
      return {
        hitos: Object.fromEntries(
          filas.map((f) => [[g1.id, g2.id, g3.id, g4.id].indexOf(f.ordenId) + 1, f.hitoAt.toISOString()]),
        ),
        sinHito,
      };
    });
    expect(r.hitos).toEqual({
      1: mas(T0, 2).toISOString(),
      2: T0.toISOString(),
      3: mas(T0, 3).toISOString(),
    });
    expect(r.sinHito).toBe(1);
  });

  it("⭑ R14: contarSinHito cuenta solo ordenes vivas en estados INCLUIDOS sin el hito", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase475(tx);
      const z = await crearZona(tx, base, "sinhito");
      // Sin pasar por la central: incluida (en_ruta_bodega_central) -> cuenta.
      const a = await crearOrden(tx, base, { clave: "a", zonaId: z, estado: "en_ruta_bodega_central", createdAt: T0 });
      await transicion(tx, base, a.id, { at: T0, origen: null, destino: "por_recolectar_en_tienda" });
      // Sin historial en absoluto, incluida -> cuenta.
      await crearOrden(tx, base, { clave: "b", zonaId: z, estado: "en_ruta_bodega_central", createdAt: T0 });
      // Estado NO incluido sin hito -> no cuenta.
      await crearOrden(tx, base, { clave: "c", zonaId: z, estado: "en_preparacion", createdAt: T0 });
      // Borrada sin hito -> no cuenta.
      await crearOrden(tx, base, { clave: "d", zonaId: z, estado: "en_ruta_bodega_central", createdAt: T0, deletedAt: T0 });
      // Con hito -> no cuenta (y si vuelve en filas).
      const e = await crearOrden(tx, base, { clave: "e", zonaId: z, estado: "en_ruta_bodega_central", createdAt: T0 });
      await transicion(tx, base, e.id, { at: mas(T0, 1), origen: "en_preparacion", destino: "en_bodega_central", origenTipo: "generacion_guia" });
      const consulta = {
        hito: "entrada_bodega_central" as const,
        estados: ["en_ruta_bodega_central"],
        cortes: [{ zonaId: z, corte: CORTE_FUTURO }],
      };
      const repo = repoDeTest(tx);
      return { sinHito: await repo.contarSinHito(consulta), filas: (await repo.filasEnAlerta(consulta)).map((f) => f.ordenId), e: e.id };
    });
    expect(r.sinHito).toBe(2);
    expect(r.filas).toEqual([r.e]);
  });
});
