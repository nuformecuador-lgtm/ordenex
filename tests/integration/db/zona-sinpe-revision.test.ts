import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import {
  HAY_BASE_DE_DATOS,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 — LA MARCA DE REVISION, CONTRA POSTGRES REAL (R5, R12, R25).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// `zona.sinpe_revisado_at` es lo que distingue «la semilla, y nadie la ha mirado» de «alguien la
// miro dentro de la aplicacion». Es la TERCERA capa de D3 y lo unico que impide que ocho bodegas
// se queden con el numero de la central para siempre sin que nada lo diga.
//
// Se mide contra Postgres porque lo que hay que demostrar es que la marca la escribe UN SOLO
// camino: el de escritura. Un doble diria que si a cualquier cosa.
//
// ⚠️ NINGUN SINPE DE AQUI ES REAL.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const NUM = "80000000";
const NOMBRE = "Titular de Prueba";
const unico = () => randomUUID().slice(0, 8);

describeSiHayBase("⭑ 429 — la marca de revision del SINPE (Postgres real)", () => {
  let prisma: PrismaClient;
  let USUARIO: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const usuario = await prisma.usuario.findFirst({ select: { id: true } });
    if (usuario === null) {
      throw new Error("hacen falta usuarios en la base. Corre `pnpm run db:seed:maestro`.");
    }
    USUARIO = usuario.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("⭑ R12 — crear una bodega la deja REVISADA: el SINPE lo acaba de teclear una persona", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new ZonaRepository(clienteConSavepoint(tx));

      const dto = await repo.create(
        {
          nombre: `429 Nueva ${unico()}`,
          cobroVehiculo: false,
          esCentral: false,
          distritoIds: [],
          tarifas: [],
          sinpeNumero: NUM,
          sinpeNombre: NOMBRE,
        },
        USUARIO,
      );

      const fila = await tx.zona.findUniqueOrThrow({
        where: { id: dto.id },
        select: { sinpeNumero: true, sinpeNombre: true, sinpeRevisadoAt: true },
      });
      expect(fila.sinpeNumero).toBe(NUM);
      expect(fila.sinpeNombre).toBe(NOMBRE);
      // R12: con fecha, no vacia. Volver a pedirle que lo confirme al entrar seria ruido.
      expect(fila.sinpeRevisadoAt).not.toBeNull();
    });
  });

  it("⭑ R5 — una bodega SEMBRADA (no creada desde la app) se distingue de una revisada", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      // Asi la deja la siembra: con valores y SIN marca. El `UPDATE` reproduce el `WHERE` del
      // script, que es el unico camino por el que una fila llega a este estado.
      const sembrada = await tx.zona.create({
        data: { nombre: `429 Sembrada ${unico()}`, sinpeNumero: NUM, sinpeNombre: NOMBRE },
        select: { id: true },
      });
      await tx.zona.update({ where: { id: sembrada.id }, data: { sinpeRevisadoAt: null } });

      const revisada = await tx.zona.create({
        data: { nombre: `429 Revisada ${unico()}`, sinpeNumero: NUM, sinpeNombre: NOMBRE },
        select: { id: true },
      });
      await tx.zona.update({ where: { id: revisada.id }, data: { sinpeRevisadoAt: new Date() } });

      const repo = new ZonaRepository(clienteConSavepoint(tx));
      const filas = await repo.listarSinpe();
      const a = filas.find((f) => f.id === sembrada.id);
      const b = filas.find((f) => f.id === revisada.id);
      // La ausencia de revision NO puede confundirse con una revision: son `null` y una fecha.
      expect(a?.sinpeRevisadoAt).toBeNull();
      expect(b?.sinpeRevisadoAt).toBeInstanceOf(Date);
    });
  });

  it("⭑ R25 — `confirmarSinpe` pone la fecha, NO toca los valores y NO deja fila de historial", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await tx.zona.create({
        data: { nombre: `429 Confirma ${unico()}`, sinpeNumero: NUM, sinpeNombre: NOMBRE },
        select: { id: true },
      });
      await tx.zona.update({ where: { id: zona.id }, data: { sinpeRevisadoAt: null } });

      const repo = new ZonaRepository(clienteConSavepoint(tx));
      const r = await repo.confirmarSinpe(zona.id);

      expect(r).not.toBeNull();
      expect(r?.sinpeRevisadoAt).toBeInstanceOf(Date);
      // Los valores intactos: `confirmarSinpe` no acepta valores y no puede escribir ninguno.
      expect(r?.sinpeNumero).toBe(NUM);
      expect(r?.sinpeNombre).toBe(NOMBRE);
      // Y CERO filas: una confirmacion no cambia nada ni mueve dinero (D6).
      expect(await tx.historialAccion.count({ where: { entidadId: zona.id } })).toBe(0);
    });
  });

  it("confirmar una zona que no existe devuelve `null` y no escribe nada", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new ZonaRepository(clienteConSavepoint(tx));
      expect(await repo.confirmarSinpe(`no-existe-${unico()}`)).toBeNull();
    });
  });
});
