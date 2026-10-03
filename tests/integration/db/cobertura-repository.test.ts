import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CoberturaRepository } from "@/lib/repositories/CoberturaRepository";
import type { DistritoCoberturaRow } from "@/lib/interfaces/repositories/ICoberturaRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 465 (T3) — LAS DOS LECTURAS DEL EXCEL DE COBERTURA, CONTRA POSTGRES REAL.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE AQUI Y NO EN `unit`: el filtro de la tarifa general (`tienda_id IS NULL AND zona_id IS
// NOT NULL`) es un `WHERE`, y un test con dobles no ve el SQL —medido cuatro veces en este repo:
// una mutacion del `WHERE` pasa en verde contra dobles—. Aqui se siembran las cuatro formas de
// tarifa y se mira lo que Postgres devuelve de verdad.
//
// SIEMBRA PROPIA Y REVERTIDA: todo vive dentro de `enTransaccionRevertida`, asi que no queda ni
// una fila. Nada de `if (!x) return;`: si falta con que sembrar (una tienda), el test REVIENTA.
//
// MUTACIONES QUE ESTE ARCHIVO MATA (medidas al escribirlo, ver progress/impl_465.md):
//   - quitar `tiendaId: null` del `where` -> la zona Z2 (solo tarifa de tienda) aparece;
//   - quitar `zonaId: { not: null }`      -> aparece un `null` (filas (T,NULL) y (NULL,NULL)).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `cob465-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;

function datosDeTarifa(zonaId: string | null, tiendaId: string | null) {
  return {
    valorFlete: new Prisma.Decimal("1.00"),
    valorFleteDevuelto: new Prisma.Decimal("1.00"),
    valorFleteGam: new Prisma.Decimal("1.00"),
    valorFleteDevueltoGam: new Prisma.Decimal("1.00"),
    comisionCod: new Prisma.Decimal("1.00"),
    ivaFlete: new Prisma.Decimal("1.00"),
    ivaComisionCod: new Prisma.Decimal("1.00"),
    zonaId,
    tiendaId,
  };
}

interface Semilla {
  z1: string; // con tarifa general (NULL, Z1)
  z2: string; // solo tarifa de tienda (T, Z2)
  z3: string; // sin tarifa
  centralId: string;
  centralNombre: string;
}

describeSiHayBase("465 — CoberturaRepository contra Postgres real", () => {
  let prisma: PrismaClient;
  let tiendaId: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const tienda = await prisma.usuario.findFirst({
      where: { rol: { value: "adminTienda" } },
      select: { id: true },
    });
    // SIN `if (!tienda) return;`: sin tienda no hay tarifa (T, ·) que sembrar y el test no probaria
    // el filtro de tienda. Mejor rojo que verde vacio.
    if (tienda === null) {
      throw new Error("no hay ningun usuario adminTienda en esta base: corre `pnpm run db:seed`");
    }
    tiendaId = tienda.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function sembrar(tx: TxDeTest): Promise<Semilla> {
    await serializarEscriturasReales(tx);

    const zona = async (marca: string) =>
      (
        await tx.zona.create({
          data: { nombre: `${SUFIJO}-${marca}`, sinpeNumero: "80000000", sinpeNombre: "Titular de Prueba" },
          select: { id: true },
        })
      ).id;
    const z1 = await zona("Z1");
    const z2 = await zona("Z2");
    const z3 = await zona("Z3");

    // A lo sumo UNA zona central (indice unico parcial): se usa la que haya o se crea.
    let central = await tx.zona.findFirst({ where: { esCentral: true }, select: { id: true, nombre: true } });
    if (central === null) {
      central = await tx.zona.create({
        data: { nombre: `${SUFIJO}-central`, esCentral: true, sinpeNumero: "80000000", sinpeNombre: "Titular de Prueba" },
        select: { id: true, nombre: true },
      });
    }

    // Las cuatro formas de tarifa. (T, NULL) y (NULL, NULL) caen bajo el UNIQUE NULLS NOT
    // DISTINCT: si la base ya trae una, se reutiliza (lo que se mide es que EXISTA).
    await tx.tarifa.create({ data: datosDeTarifa(z1, null) });
    await tx.tarifa.create({ data: datosDeTarifa(z2, tiendaId) });
    if ((await tx.tarifa.count({ where: { zonaId: null, tiendaId } })) === 0) {
      await tx.tarifa.create({ data: datosDeTarifa(null, tiendaId) });
    }
    if ((await tx.tarifa.count({ where: { zonaId: null, tiendaId: null } })) === 0) {
      await tx.tarifa.create({ data: datosDeTarifa(null, null) });
    }

    // Catalogo: provincia activa con un canton activo y otro retirado.
    const provincia = await tx.provincia.create({ data: { nombre: `${SUFIJO}-Provincia` }, select: { id: true } });
    const cantonVivo = await tx.canton.create({
      data: { nombre: "Cantón Vivo", provinciaId: provincia.id },
      select: { id: true },
    });
    const cantonRetirado = await tx.canton.create({
      data: { nombre: "Cantón Retirado", provinciaId: provincia.id, activo: false },
      select: { id: true },
    });
    const distrito = async (nombre: string, cantonId: string, extra: Partial<{ activo: boolean; zonaEspecial: boolean | null }> = {}) =>
      (await tx.distrito.create({ data: { nombre, cantonId, ...extra }, select: { id: true } })).id;

    const dCero = await distrito("Cero Zonas", cantonVivo.id, { zonaEspecial: null });
    const dUna = await distrito("Una Zona", cantonVivo.id, { zonaEspecial: true });
    const dDos = await distrito("Dos Zonas", cantonVivo.id);
    const dCentral = await distrito("En La Central", cantonVivo.id);
    const dRetirado = await distrito("Retirado Propio", cantonVivo.id, { activo: false });
    const dBajoCanton = await distrito("Bajo Cantón Retirado", cantonRetirado.id);

    await tx.zonaDistrito.createMany({
      data: [
        { zonaId: z1, distritoId: dUna },
        { zonaId: z1, distritoId: dDos },
        { zonaId: z2, distritoId: dDos },
        { zonaId: central.id, distritoId: dCentral },
        { zonaId: z3, distritoId: dRetirado },
        { zonaId: z1, distritoId: dBajoCanton },
      ],
    });
    void dCero;

    return { z1, z2, z3, centralId: central.id, centralNombre: central.nombre };
  }

  it("listZonaIdsConTarifaGeneral: solo la zona con tarifa (NULL, Z); sin tiendas y sin null (R14)", async () => {
    const { semilla, ids } = await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      const repo = new CoberturaRepository(tx as unknown as PrismaClient);
      return { semilla, ids: await repo.listZonaIdsConTarifaGeneral() };
    });

    expect(ids).toContain(semilla.z1);
    expect(ids).not.toContain(semilla.z2); // (T, Z2): tarifa de TIENDA, no general
    expect(ids).not.toContain(semilla.z3); // sin tarifa
    expect(ids).not.toContain(null); // (T, NULL) y (NULL, NULL) sembradas: ninguna cuenta
    expect(new Set(ids).size).toBe(ids.length); // DISTINCT
  });

  it("listDistritos: activos e inactivos, zonas SIN colapsar y disponibilidad por cadena (R4, R7)", async () => {
    const { semilla, rows } = await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      const repo = new CoberturaRepository(tx as unknown as PrismaClient);
      return { semilla, rows: await repo.listDistritos() };
    });

    const mias = new Map<string, DistritoCoberturaRow>(
      rows.filter((r) => r.provincia.nombre === `${SUFIJO}-Provincia`).map((r) => [r.distrito.nombre, r]),
    );
    // Anti-vacuidad: los SEIS distritos sembrados, incluidos los dos no disponibles.
    expect([...mias.keys()].sort()).toEqual(
      ["Bajo Cantón Retirado", "Cero Zonas", "Dos Zonas", "En La Central", "Retirado Propio", "Una Zona"].sort(),
    );

    const nombresZona = (r: DistritoCoberturaRow | undefined) => (r?.zonas ?? []).map((z) => z.id).sort();

    expect(mias.get("Cero Zonas")).toMatchObject({ disponible: true, zonas: [] });
    expect(mias.get("Cero Zonas")!.distrito.zonaEspecial).toBeNull();

    expect(mias.get("Una Zona")).toMatchObject({
      disponible: true,
      distrito: { activo: true, zonaEspecial: true },
      zonas: [{ id: semilla.z1, nombre: `${SUFIJO}-Z1`, esCentral: false }],
    });

    // Dos zonas: llegan LAS DOS (no colapsadas a null como en `listArbol`).
    expect(nombresZona(mias.get("Dos Zonas"))).toEqual([semilla.z1, semilla.z2].sort());

    expect(mias.get("En La Central")!.zonas).toEqual([
      { id: semilla.centralId, nombre: semilla.centralNombre, esCentral: true },
    ]);

    expect(mias.get("Retirado Propio")).toMatchObject({ disponible: false, distrito: { activo: false } });

    // Distrito ACTIVO bajo canton retirado: el flag propio es true, la disponibilidad es false.
    expect(mias.get("Bajo Cantón Retirado")).toMatchObject({
      disponible: false,
      distrito: { activo: true },
      canton: { nombre: "Cantón Retirado", activo: false },
      provincia: { activo: true },
    });
  });
});
