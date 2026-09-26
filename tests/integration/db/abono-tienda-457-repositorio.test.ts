import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import type { CrearAbonoTiendaInput } from "@/lib/interfaces/repositories/IAbonoTiendaRepository";
import { AbonoTiendaRepository } from "@/lib/repositories/AbonoTiendaRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { sembrarPersonas461 } from "./_fixtures/personas-461";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 457 / T3.1 — `AbonoTiendaRepository` contra Postgres (R25, R36, R41, R61–R63).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// «Probar el WHERE donde vive»: los tests del servicio usan dobles y no ven el SQL. Aqui hay DOS
// documentos de DOS tiendas en la misma base, asi que un `WHERE` de `obtenerPorId`/`obtenerPorClave`
// que no filtre por su clave devuelve el documento EQUIVOCADO (o uno donde deberia haber `null`).
// Todo corre en una transaccion que SIEMPRE se revierte; el repositorio se construye sobre esa `tx`.
// Los P2002 (clave repetida, anulacion repetida) se aislan con SAVEPOINT: en Postgres un error aborta
// la transaccion entera.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("457/T3.1 — AbonoTiendaRepository (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("obtenerPorId / obtenerPorClave devuelven SU documento (y null a lo que no existe); P2002 -> clave_repetida / ya_anulado; estadoDeDocumentos; historial sin texto libre", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const repo = new AbonoTiendaRepository(tx as unknown as PrismaClient);
      const base = (over: Partial<CrearAbonoTiendaInput>): CrearAbonoTiendaInput => ({
        id: randomUUID(),
        claveIdempotencia: randomUUID(),
        tiendaId: p.tiendaId,
        monto: "1234.50",
        metodo: "SINPE",
        referencia: "REF-1",
        motivo: "Motivo libre de A",
        fechaPago: new Date("2026-09-20T00:00:00.000Z"),
        comprobantePath: null,
        comprobanteContentType: null,
        registradoPor: p.maestro.usuarioId,
        ...over,
      });
      const inA = base({ comprobantePath: "abonos-tienda/x.pdf", comprobanteContentType: "application/pdf" });
      const inB = base({ tiendaId: p.otraTiendaId, monto: "99.99", metodo: "efectivo", referencia: null, motivo: "Motivo de B" });
      const a = await repo.crear(tx, inA);
      const b = await repo.crear(tx, inB);

      await tx.$executeRawUnsafe("SAVEPOINT sp_clave");
      const repetida = await repo.crear(tx, base({ claveIdempotencia: inA.claveIdempotencia }));
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_clave");

      const porIdA = await repo.obtenerPorId(inA.id);
      const porIdB = await repo.obtenerPorId(inB.id);
      const porIdNada = await repo.obtenerPorId(randomUUID());
      const porClaveA = await repo.obtenerPorClave(inA.claveIdempotencia);
      const porClaveB = await repo.obtenerPorClave(inB.claveIdempotencia);
      const porClaveNada = await repo.obtenerPorClave(randomUUID());

      const anulada = await repo.anular(tx, { abonoId: inA.id, motivo: "Motivo de la anulacion", anuladoPor: p.admin.usuarioId });
      await tx.$executeRawUnsafe("SAVEPOINT sp_anular");
      const otraVez = await repo.anular(tx, { abonoId: inA.id, motivo: "otra", anuladoPor: p.maestro.usuarioId });
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_anular");

      const estado = await repo.estadoDeDocumentos([inA.id, inB.id, randomUUID()]);
      const vacio = await repo.estadoDeDocumentos([]);
      const trasAnularA = await repo.obtenerPorId(inA.id);
      const historial = await tx.historialAccion.findMany({
        where: { entidadId: { in: [inA.id, inB.id] } },
        orderBy: [{ createdAt: "asc" }, { accion: "asc" }],
      });
      return { p, inA, inB, a, b, repetida, porIdA, porIdB, porIdNada, porClaveA, porClaveB, porClaveNada, anulada, otraVez, estado, vacio, trasAnularA, historial };
    });

    // crear: el documento con nombres, no ids (salvo el de la tienda, que el SERVIDOR necesita).
    expect(m.a.status).toBe("creado");
    expect(m.b.status).toBe("creado");
    expect(m.repetida).toEqual({ status: "clave_repetida" });

    // El WHERE: cada lectura trae SU documento; lo que no existe es null.
    expect(m.porIdA).toMatchObject({
      id: m.inA.id,
      tiendaId: m.p.tiendaId,
      monto: "1234.50",
      metodo: "SINPE",
      referencia: "REF-1",
      motivo: "Motivo libre de A",
      fechaPago: "2026-09-20",
      comprobantePath: "abonos-tienda/x.pdf",
      comprobanteContentType: "application/pdf",
      anulado: false,
    });
    expect(m.porIdA?.tiendaNombre).toContain("Tienda 461");
    expect(m.porIdB).toMatchObject({ id: m.inB.id, tiendaId: m.p.otraTiendaId, monto: "99.99", referencia: null, comprobantePath: null });
    expect(m.porIdNada).toBeNull();
    expect(m.porClaveA?.id).toBe(m.inA.id);
    expect(m.porClaveB?.id).toBe(m.inB.id);
    expect(m.porClaveNada).toBeNull();

    // anular: una constancia; la segunda es `ya_anulado`.
    expect(m.anulada).toEqual({ status: "anulado" });
    expect(m.otraVez).toEqual({ status: "ya_anulado" });
    expect(m.trasAnularA?.anulado).toBe(true);

    // estadoDeDocumentos: solo los que existen, con su estado.
    expect([...m.estado].sort((x, y) => (x.id === m.inA.id ? -1 : y.id === m.inA.id ? 1 : 0))).toEqual([
      { id: m.inA.id, anulado: true, tieneComprobante: true },
      { id: m.inB.id, anulado: false, tieneComprobante: false },
    ]);
    expect(m.vacio).toEqual([]);

    // R61–R63: una fila por escritura, de tipo propio, con el importe y el nombre de la tienda; sin texto libre.
    expect(m.historial.map((h) => [h.entidadId, h.accion, h.entidadTipo, h.monto?.toFixed(2)]).sort()).toEqual(
      [
        [m.inA.id, "abono_tienda_registrado", "abono_tienda", "1234.50"],
        [m.inB.id, "abono_tienda_registrado", "abono_tienda", "99.99"],
        [m.inA.id, "abono_tienda_anulado", "abono_tienda", "1234.50"],
      ].sort(),
    );
    const volcado = JSON.stringify(m.historial);
    for (const libre of ["Motivo libre de A", "Motivo de B", "Motivo de la anulacion", "REF-1", "abonos-tienda/"]) {
      expect(volcado).not.toContain(libre);
    }
    for (const h of m.historial) expect(h.entidadEtiqueta).toMatch(/Tienda(Otra)? 461/);
  }, 60_000);
});
