import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { SinpeBodegaService } from "@/lib/services/SinpeBodegaService";
import {
  HAY_BASE_DE_DATOS,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 — R2 y R20 CONTRA POSTGRES REAL: el par es de la BODEGA, y la zona del actor sale
// de la BASE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE AQUI Y NO EN EL TEST DEL SERVICIO. El del servicio usa dobles: con `zonaIdDeUsuario`
// mockeado, «la zona sale de la base» es una afirmacion sobre el fixture, no sobre el sistema —la
// «asercion contra su propia fuente» que este repo ya ha pagado—. Aqui la zona del `adminSatelite`
// la pone de verdad `usuario.zona_id`, y lo que se mide es que el servicio la lee de ahi.
//
// R2 se mide igual: dos usuarios distintos de la MISMA bodega leen el mismo par, y el guardado de
// uno lo ve el otro. Eso solo se puede afirmar con dos lecturas reales sobre la misma fila.
//
// ⚠️ NINGUN SINPE DE AQUI ES REAL.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const NUM_A = "80000000";
const NUM_B = "70000001";
const NOMBRE = "Titular de Prueba";
const unico = () => randomUUID().slice(0, 8);

describeSiHayBase("⭑ 429 — R2/R20: el SINPE es de la bodega y la zona del actor sale de la base", () => {
  let prisma: PrismaClient;
  let ROL_ADMIN_SATELITE: string;
  let TIPO_IDENT: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const rol = await prisma.rol.findFirst({ where: { value: "adminSatelite" }, select: { id: true } });
    const tipo = await prisma.tipoIdentificacion.findFirst({ select: { id: true } });
    if (rol === null || tipo === null) {
      throw new Error(
        "faltan catalogos (`rol`/`tipo_identificacion`) en la base. Corre `pnpm run db:seed`.",
      );
    }
    ROL_ADMIN_SATELITE = rol.id;
    TIPO_IDENT = tipo.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("⭑ R2/R20 — dos `adminSatelite` de la MISMA bodega ven el mismo par, y el cambio de uno lo ve el otro", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const marca = unico();
      const bodega = await tx.zona.create({
        data: { nombre: `429 Bodega ${marca}`, sinpeNumero: NUM_A, sinpeNombre: NOMBRE },
        select: { id: true },
      });
      const ajena = await tx.zona.create({
        data: { nombre: `429 Ajena ${marca}`, sinpeNumero: NUM_A, sinpeNombre: NOMBRE },
        select: { id: true },
      });

      const crearAdmin = async (sufijo: string) =>
        tx.usuario.create({
          data: {
            nombre: `Admin ${sufijo}`,
            email: `admin-${sufijo}-${marca}@ejemplo.test`,
            passwordHash: "x",
            telefono: "80000000",
            cedula: `429-${sufijo}-${marca}`,
            rolId: ROL_ADMIN_SATELITE,
            tipoIdentificacionId: TIPO_IDENT,
            zonaId: bodega.id,
          },
          select: { id: true },
        });
      const uno = await crearAdmin("uno");
      const otro = await crearAdmin("otro");

      const service = new SinpeBodegaService(new ZonaRepository(clienteConSavepoint(tx)));
      const actorUno = { usuarioId: uno.id, rol: "adminSatelite" as const };
      const actorOtro = { usuarioId: otro.id, rol: "adminSatelite" as const };

      // Los dos ven UNA sola bodega —la suya— y el MISMO par.
      const listaUno = await service.listar(actorUno);
      const listaOtro = await service.listar(actorOtro);
      expect(listaUno.status).toBe("ok");
      expect(listaOtro.status).toBe("ok");
      if (listaUno.status !== "ok" || listaOtro.status !== "ok") return;
      expect(listaUno.items).toHaveLength(1);
      expect(listaOtro.items).toHaveLength(1);
      expect(listaUno.items[0].zonaId).toBe(bodega.id);
      expect(listaOtro.items[0]).toEqual(listaUno.items[0]);
      // Y NO ven la ajena. Anti-vacuidad: la ajena existe en la misma transaccion.
      expect(listaUno.items.map((i) => i.zonaId)).not.toContain(ajena.id);

      // R2: el guardado de uno lo ve el otro, porque el dato cuelga de la BODEGA (D2).
      const guardado = await service.guardar(
        bodega.id,
        { numero: NUM_B, nombre: NOMBRE },
        actorUno,
      );
      expect(guardado.status).toBe("ok");
      const trasGuardar = await service.listar(actorOtro);
      expect(trasGuardar.status === "ok" && trasGuardar.items[0].numero).toBe(NUM_B);
    });
  });

  it("⭑ R20 — un `adminSatelite` que pide OTRA bodega recibe `forbidden` y esa bodega no cambia", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const marca = unico();
      const suya = await tx.zona.create({
        data: { nombre: `429 Suya ${marca}`, sinpeNumero: NUM_A, sinpeNombre: NOMBRE },
        select: { id: true },
      });
      const ajena = await tx.zona.create({
        data: { nombre: `429 Ajena ${marca}`, sinpeNumero: NUM_A, sinpeNombre: NOMBRE },
        select: { id: true },
      });
      const usuario = await tx.usuario.create({
        data: {
          nombre: "Admin satelite",
          email: `satelite-${marca}@ejemplo.test`,
          passwordHash: "x",
          telefono: "80000000",
          cedula: `429-sat-${marca}`,
          rolId: ROL_ADMIN_SATELITE,
          tipoIdentificacionId: TIPO_IDENT,
          zonaId: suya.id,
        },
        select: { id: true },
      });

      const service = new SinpeBodegaService(new ZonaRepository(clienteConSavepoint(tx)));
      const actor = { usuarioId: usuario.id, rol: "adminSatelite" as const };

      // ⚠️ EL `zonaId` DEL PAYLOAD DICE QUE se quiere tocar, NUNCA SI se puede. La zona que decide
      // es la que `usuario.zona_id` tiene en la BASE.
      const r = await service.guardar(ajena.id, { numero: NUM_B, nombre: NOMBRE }, actor);
      expect(r.status).toBe("forbidden");

      // Y la bodega ajena sigue con su valor anterior: el permiso se decide ANTES de escribir.
      const despues = await tx.zona.findUniqueOrThrow({
        where: { id: ajena.id },
        select: { sinpeNumero: true, sinpeRevisadoAt: true },
      });
      expect(despues.sinpeNumero).toBe(NUM_A);
      expect(await tx.historialAccion.count({ where: { entidadId: ajena.id } })).toBe(0);

      // Confirmar la ajena tampoco: quien no puede corregirla tampoco la aprueba.
      expect((await service.confirmar(ajena.id, actor)).status).toBe("forbidden");
      expect(despues.sinpeRevisadoAt).toEqual(
        (
          await tx.zona.findUniqueOrThrow({
            where: { id: ajena.id },
            select: { sinpeRevisadoAt: true },
          })
        ).sinpeRevisadoAt,
      );
    });
  });

  it("⭑ un `adminSatelite` SIN zona no puede editar ninguna: `null` es «ninguna», no «todas»", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const marca = unico();
      const bodega = await tx.zona.create({
        data: { nombre: `429 Huerfana ${marca}`, sinpeNumero: NUM_A, sinpeNombre: NOMBRE },
        select: { id: true },
      });
      const usuario = await tx.usuario.create({
        data: {
          nombre: "Satelite sin zona",
          email: `sinzona-${marca}@ejemplo.test`,
          passwordHash: "x",
          telefono: "80000000",
          cedula: `429-sz-${marca}`,
          rolId: ROL_ADMIN_SATELITE,
          tipoIdentificacionId: TIPO_IDENT,
          zonaId: null, // estado REPRESENTABLE: `usuario.zona_id` es nullable
        },
        select: { id: true },
      });

      const service = new SinpeBodegaService(new ZonaRepository(clienteConSavepoint(tx)));
      const actor = { usuarioId: usuario.id, rol: "adminSatelite" as const };

      // ⚠️ `forbidden`, y NO una lista vacia. Son dos respuestas distintas y la diferencia importa:
      // una lista vacia dice «tu bodega no tiene SINPE», que es imposible (`NOT NULL`), y dejaria a
      // la pantalla pintando un hueco. `forbidden` dice «no administras ninguna bodega», que es lo
      // que de verdad pasa. R19 no le da alcance a un `adminSatelite` que no es el de NINGUNA
      // bodega.
      const lista = await service.listar(actor);
      expect(lista.status).toBe("forbidden");
      expect((await service.guardar(bodega.id, { numero: NUM_B, nombre: NOMBRE }, actor)).status).toBe(
        "forbidden",
      );
    });
  });
});
