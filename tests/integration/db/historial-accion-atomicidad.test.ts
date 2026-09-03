import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaRepository } from "@/lib/repositories/TarifaRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 362 / T8.1 (R9/R10/R11/R12) — **NO PUEDE HABER UNA SIN LA OTRA**, MEDIDO CONTRA POSTGRES.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ POR QUE ESTE ARCHIVO NO SE PUEDE SUSTITUIR POR TESTS CON DOBLES. Un doble no revierte nada:
// puede afirmar que `appendAccion` se LLAMO con el `tx`, pero no que si el registro falla la
// accion se deshace. Este repo tiene la leccion escrita —«una imposibilidad razonada no es
// medida»— y ademas la contraria: con dobles, una mutacion del `WHERE` pasa en verde.
//
// Lo que se mide, por cada una de las TRES familias del catalogo:
//   (a) R10 — se FUERZA el fallo del registro dentro de la tx → la MUTACION no persiste;
//   (b) R11 — la mutacion no alcanza ninguna fila → NO queda registro;
//   (c) R12 — un lote parcial deja tantas filas como entidades EFECTIVAMENTE alcanzadas.
//
// COMO SE FUERZA EL FALLO SIN TOCAR EL CODIGO DE PRODUCCION: un `Proxy` sobre el cliente hace que
// `historialAccion.createMany` lance. El repositorio real corre entero, con su `$transaction`
// real: lo unico simulado es el fallo, que es lo que se quiere provocar.
//
// COMO SE ANIDAN LAS TRANSACCIONES: `enTransaccionRevertida` abre la del TEST (que siempre
// revierte, para no dejar ni una fila en la base compartida), y el `$transaction` del repositorio
// se traduce a un SAVEPOINT REAL de Postgres. Un pass-through no serviria: sin savepoint, un
// `throw` dentro del repositorio no revertiria nada y el caso (a) pasaria en verde por accidente.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `362-ato-${Date.now().toString(36)}`;

/** El error con el que se fuerza el fallo del registro. Se reconoce por su nombre. */
class RegistroCaido extends Error {
  constructor() {
    super("362: fallo PROVOCADO del registro de acciones");
    this.name = "RegistroCaido";
  }
}

/**
 * El cliente que se le da al repositorio: la `tx` del test MAS un `$transaction` que abre un
 * SAVEPOINT REAL. Es lo que hace que el `throw` de dentro revierta de verdad.
 *
 * `romperRegistro` sustituye `historialAccion.createMany` por una funcion que lanza. Nada mas se
 * toca: la mutacion, el `where`, el congelado del actor y la etiqueta son los reales.
 */
function clienteConSavepoint(tx: TxDeTest, romperRegistro = false): PrismaClient {
  const proxy: unknown = new Proxy(tx as object, {
    get(objetivo, prop) {
      if (prop === "$transaction") {
        return async (fn: (t: unknown) => unknown) => {
          const punto = `sp_${randomUUID().replace(/-/g, "")}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
          try {
            const salida = await fn(proxy);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
            return salida;
          } catch (error) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
            throw error;
          }
        };
      }
      if (romperRegistro && prop === "historialAccion") {
        return {
          createMany: () => {
            throw new RegistroCaido();
          },
        };
      }
      const valor = Reflect.get(objetivo, prop) as unknown;
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  });
  return proxy as PrismaClient;
}

describeSiHayBase("362/T8.1 — la accion y su registro son atomicos (Postgres real)", () => {
  let prisma: PrismaClient;
  let FKS: Awaited<ReturnType<typeof fksDeOrden>>;
  let ESTATUS_ID: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    FKS = await fksDeOrden(prisma);
    if (FKS === null) {
      // ⚠️ LANZA, no `return`. Un `if (!fks) return;` reporta `passed` sin comprobar NADA, y este
      // repo ya se comio esa mentira una vez.
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y `pnpm exec tsx scripts/seed-zonas.ts`) antes de esta suite.",
      );
    }
    ESTATUS_ID = FKS.estatusId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Siembra `n` ordenes vivas y devuelve sus ids. */
  async function sembrarOrdenes(tx: TxDeTest, n: number, marca: string): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const fila = await tx.orden.create({
        data: {
          numRemision: `R-${SUFIJO}-${marca}-${i}`,
          destinatario: "Dest",
          telefonoDest: "88880000",
          producto: "Prod",
          estatusId: ESTATUS_ID,
          tiendaId: FKS!.tiendaId,
          zonaId: FKS!.zonaId,
          provinciaId: FKS!.provinciaId,
          cantonId: FKS!.cantonId,
        },
        select: { id: true },
      });
      ids.push(fila.id);
    }
    return ids;
  }

  /** Las filas del registro que apuntan a estas entidades. */
  async function registroDe(tx: TxDeTest, entidadIds: string[]) {
    return tx.historialAccion.findMany({
      where: { entidadId: { in: entidadIds } },
      select: {
        accion: true,
        entidadId: true,
        entidadEtiqueta: true,
        actorNombre: true,
        actorRol: true,
        loteId: true,
      },
      orderBy: { entidadId: "asc" },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // FAMILIA «HACE DESAPARECER ALGO» — el caso que abre la ficha: 79 ordenes borradas sin rastro
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe("familia 1/3 · hace desaparecer algo (`orden_eliminada`)", () => {
    it("⭑ R10: si el REGISTRO falla, la orden NO queda borrada", async () => {
      // El test que mas importa de la ficha, en su primera direccion.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const [ordenId] = await sembrarOrdenes(tx, 1, "r10");
        const repo = new OrdenRepository(clienteConSavepoint(tx, true));

        let lanzo: unknown = null;
        try {
          await repo.softDelete({ ids: [ordenId], ownerId: null, actorUsuarioId: FKS!.tiendaId });
        } catch (error) {
          lanzo = error;
        }

        const orden = await tx.orden.findUniqueOrThrow({
          where: { id: ordenId },
          select: { deletedAt: true },
        });
        return { lanzo, deletedAt: orden.deletedAt, registro: await registroDe(tx, [ordenId]) };
      });

      // El fallo se PROPAGA: no se lo traga nadie. Un `try/catch` que lo silenciara aqui es la
      // mutacion que R10 prohibe.
      expect(r.lanzo).toBeInstanceOf(RegistroCaido);
      // Y la orden sigue VIVA: la transaccion revirtio el `UPDATE`.
      expect(r.deletedAt, "la orden se borro sin su registro: R10 roto").toBeNull();
      expect(r.registro).toEqual([]);
    });

    it("⭑ R11: una orden que YA estaba borrada no deja fila de registro", async () => {
      // «Se pidio borrar» y «se borro» son cosas distintas. El `where` con `deleted_at IS NULL` no
      // alcanza ninguna fila, el `RETURNING` vuelve vacio y `appendAccion` es no-op.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const [ordenId] = await sembrarOrdenes(tx, 1, "r11");
        await tx.orden.update({ where: { id: ordenId }, data: { deletedAt: new Date() } });

        const repo = new OrdenRepository(clienteConSavepoint(tx));
        const eliminadas = await repo.softDelete({
          ids: [ordenId],
          ownerId: null,
          actorUsuarioId: FKS!.tiendaId,
        });
        return { eliminadas, registro: await registroDe(tx, [ordenId]) };
      });

      expect(r.eliminadas).toBe(0);
      expect(r.registro, "se registro un borrado que no ocurrio").toEqual([]);
    });

    it("⭑ R12: de un lote de 3 con UNA ya borrada se registran EXACTAMENTE 2", async () => {
      // ⚠️ ES LA MUTACION QUE EL DESIGN NOMBRA: «construir las entradas con los ids PEDIDOS en vez
      // de con los devueltos por la escritura». Con los pedidos, este caso encontraria 3 filas —y
      // una de ellas seria la auditoria de un borrado que no ocurrio.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const ids = await sembrarOrdenes(tx, 3, "r12");
        await tx.orden.update({ where: { id: ids[1] }, data: { deletedAt: new Date() } });

        const repo = new OrdenRepository(clienteConSavepoint(tx));
        const eliminadas = await repo.softDelete({
          ids,
          ownerId: null,
          actorUsuarioId: FKS!.tiendaId,
        });
        return { ids, eliminadas, registro: await registroDe(tx, ids) };
      });

      expect(r.eliminadas).toBe(2);
      expect(r.registro).toHaveLength(2);
      // Y son las DOS que se borraron de verdad, no dos cualesquiera.
      expect(r.registro.map((f) => f.entidadId).sort()).toEqual(
        [r.ids[0], r.ids[2]].sort(),
      );
      expect(r.registro.map((f) => f.entidadId)).not.toContain(r.ids[1]);
      for (const fila of r.registro) expect(fila.accion).toBe("orden_eliminada");
    });

    it("R7: las filas de UN borrado por lote comparten `lote_id`, y dos borrados NO", async () => {
      // La diferencia entre «se borraron 79 de una vez» y «hubo 79 borrados».
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const lote1 = await sembrarOrdenes(tx, 3, "lote1");
        const lote2 = await sembrarOrdenes(tx, 2, "lote2");
        const repo = new OrdenRepository(clienteConSavepoint(tx));

        await repo.softDelete({ ids: lote1, ownerId: null, actorUsuarioId: FKS!.tiendaId });
        await repo.softDelete({ ids: lote2, ownerId: null, actorUsuarioId: FKS!.tiendaId });

        return {
          uno: await registroDe(tx, lote1),
          dos: await registroDe(tx, lote2),
        };
      });

      expect(new Set(r.uno.map((f) => f.loteId)).size).toBe(1);
      expect(new Set(r.dos.map((f) => f.loteId)).size).toBe(1);
      expect(r.uno[0].loteId).not.toBe(r.dos[0].loteId);
    });

    it("R3/R4: la fila congela la GUIA de la orden y el nombre y rol del actor", async () => {
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const [ordenId] = await sembrarOrdenes(tx, 1, "congelado");
        const actor = await tx.usuario.findFirstOrThrow({
          select: { id: true, nombre: true, primerApellido: true, rol: { select: { value: true } } },
        });
        const repo = new OrdenRepository(clienteConSavepoint(tx));
        await repo.softDelete({ ids: [ordenId], ownerId: null, actorUsuarioId: actor.id });
        return { actor, registro: await registroDe(tx, [ordenId]) };
      });

      expect(r.registro).toHaveLength(1);
      const esperado = [r.actor.nombre, r.actor.primerApellido]
        .filter((p) => p != null && p !== "")
        .join(" ");
      expect(r.registro[0].actorNombre).toBe(esperado);
      expect(r.registro[0].actorRol).toBe(r.actor.rol.value);
      // La orden sembrada no tiene guia: la etiqueta cae a la REMISION, que si tiene.
      expect(r.registro[0].entidadEtiqueta).toContain(SUFIJO);
    });

    it("R4: `orden_recuperada` es el reverso, y deja SU propia fila", async () => {
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const [ordenId] = await sembrarOrdenes(tx, 1, "recup");
        const repo = new OrdenRepository(clienteConSavepoint(tx));
        await repo.softDelete({ ids: [ordenId], ownerId: null, actorUsuarioId: FKS!.tiendaId });
        const recuperadas = await repo.restore([ordenId], FKS!.tiendaId);
        return { recuperadas, registro: await registroDe(tx, [ordenId]) };
      });

      expect(r.recuperadas).toBe(1);
      // DOS filas: borrar y recuperar son dos hechos, no uno que se deshace.
      expect(r.registro.map((f) => f.accion).sort()).toEqual(["orden_eliminada", "orden_recuperada"]);
    });

    it("R11: recuperar una orden que NUNCA se borro no deja fila", async () => {
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const [ordenId] = await sembrarOrdenes(tx, 1, "recup-noop");
        const repo = new OrdenRepository(clienteConSavepoint(tx));
        const recuperadas = await repo.restore([ordenId], FKS!.tiendaId);
        return { recuperadas, registro: await registroDe(tx, [ordenId]) };
      });

      expect(r.recuperadas).toBe(0);
      expect(r.registro).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // FAMILIA «MUEVE DINERO» — la tarifa, que ademas borra en FISICO
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe("familia 2/3 · mueve dinero (`tarifa_creada` / `tarifa_borrada`)", () => {
    async function crearTarifa(tx: TxDeTest, actorId: string) {
      const repo = new TarifaRepository(clienteConSavepoint(tx));
      return repo.create(
        {
          tiendaId: null,
          valorFlete: 1000,
          valorFleteDevuelto: 500,
          valorFleteGam: 800,
          valorFleteDevueltoGam: 400,
          fulfillment: null,
          comisionCod: 5,
          ivaFlete: 13,
          ivaComisionCod: 13,
          tarifaEspecial: null,
          tarifaEspecialDevuelta: null,
          zonaId: FKS!.zonaId,
          isDefault: false,
        },
        actorId,
      );
    }

    it("⭑ R10: si el REGISTRO falla, la tarifa NO queda creada", async () => {
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const antes = await tx.tarifa.count();
        const repo = new TarifaRepository(clienteConSavepoint(tx, true));

        let lanzo: unknown = null;
        try {
          await repo.create(
            {
              tiendaId: null,
              valorFlete: 1000,
              valorFleteDevuelto: 500,
              valorFleteGam: 800,
              valorFleteDevueltoGam: 400,
              fulfillment: null,
              comisionCod: 5,
              ivaFlete: 13,
              ivaComisionCod: 13,
              tarifaEspecial: null,
              tarifaEspecialDevuelta: null,
              zonaId: FKS!.zonaId,
              isDefault: false,
            },
            FKS!.tiendaId,
          );
        } catch (error) {
          lanzo = error;
        }
        return { lanzo, antes, despues: await tx.tarifa.count() };
      });

      expect(r.lanzo).toBeInstanceOf(RegistroCaido);
      expect(r.despues, "la tarifa se creo sin su registro: R10 roto").toBe(r.antes);
    });

    it("⭑ R4: la etiqueta CONGELADA sobrevive al borrado FISICO de la tarifa", async () => {
      // El caso que justifica congelar: despues del `DELETE` no hay a quien preguntar de que
      // tarifa se trataba. Si la etiqueta se resolviera por join al leer, esta fila diria nada.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const zona = await tx.zona.findUniqueOrThrow({
          where: { id: FKS!.zonaId },
          select: { nombre: true },
        });
        const tarifa = await crearTarifa(tx, FKS!.tiendaId);
        const repo = new TarifaRepository(clienteConSavepoint(tx));
        const borrado = await repo.hardDelete(tarifa.id, FKS!.tiendaId);

        return {
          borrado,
          existe: await tx.tarifa.count({ where: { id: tarifa.id } }),
          registro: await registroDe(tx, [tarifa.id]),
          zonaNombre: zona.nombre,
        };
      });

      expect(r.borrado).toBe("ok");
      // La tarifa YA NO EXISTE …
      expect(r.existe).toBe(0);
      // … y su fila del registro sigue diciendo de cual se trataba.
      const borrada = r.registro.find((f) => f.accion === "tarifa_borrada");
      expect(borrada, "no quedo rastro del borrado fisico").toBeDefined();
      expect(borrada?.entidadEtiqueta).toContain(r.zonaNombre);
    });

    it("R1: crear y borrar dejan DOS filas, una por hecho", async () => {
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const tarifa = await crearTarifa(tx, FKS!.tiendaId);
        await new TarifaRepository(clienteConSavepoint(tx)).hardDelete(tarifa.id, FKS!.tiendaId);
        return registroDe(tx, [tarifa.id]);
      });
      expect(r.map((f) => f.accion).sort()).toEqual(["tarifa_borrada", "tarifa_creada"]);
    });

    it("Q3: la tarifa NO guarda el valor anterior — se vive con «quien y cuando»", async () => {
      // Decision del humano del 2026-09-02: NO se abre el versionado de tarifas. Este caso lo
      // deja escrito en una asercion, para que quien mañana quiera meter ahi un volcado se tope
      // con un test en vez de con un comentario.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const tarifa = await crearTarifa(tx, FKS!.tiendaId);
        await new TarifaRepository(clienteConSavepoint(tx)).update(
          tarifa.id,
          { valorFlete: 2000 },
          FKS!.tiendaId,
        );
        return tx.historialAccion.findMany({
          where: { entidadId: tarifa.id },
          select: { accion: true, monto: true, valorAnterior: true, valorNuevo: true },
        });
      });

      const actualizada = r.find((f) => f.accion === "tarifa_actualizada");
      expect(actualizada, "no se registro la actualizacion de la tarifa").toBeDefined();
      // Las TRES columnas van NULL: `monto` porque una tarifa son diez importes y no uno;
      // `valorAnterior`/`valorNuevo` porque Q3 quedo cerrada en «no se versiona».
      expect(actualizada?.monto).toBeNull();
      expect(actualizada?.valorAnterior).toBeNull();
      expect(actualizada?.valorNuevo).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // FAMILIA «CAMBIA QUIEN PUEDE HACER QUE» — el estado de un usuario
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe("familia 3/3 · cambia quien puede hacer que (`usuario_estado_cambiado`)", () => {
    /** Un usuario desechable, clonado de los catalogos que ya existen. */
    async function sembrarUsuario(tx: TxDeTest, marca: string): Promise<string> {
      const plantilla = await tx.usuario.findFirstOrThrow({
        select: { tipoIdentificacionId: true, rolId: true },
      });
      const fila = await tx.usuario.create({
        data: {
          nombre: `Test${marca}`,
          primerApellido: "Efimero",
          email: `${SUFIJO}-${marca}@example.test`,
          telefono: "88880000",
          passwordHash: "x",
          cedula: `${SUFIJO}-${marca}`,
          estado: "activo",
          tipoIdentificacionId: plantilla.tipoIdentificacionId,
          rolId: plantilla.rolId,
        },
        select: { id: true },
      });
      return fila.id;
    }

    it("⭑ R10: si el REGISTRO falla, el estado del usuario NO cambia", async () => {
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const usuarioId = await sembrarUsuario(tx, "r10u");
        const repo = new UserRepository(clienteConSavepoint(tx, true));

        let lanzo: unknown = null;
        try {
          await repo.setEstado(usuarioId, "inactivo", FKS!.tiendaId);
        } catch (error) {
          lanzo = error;
        }
        const fila = await tx.usuario.findUniqueOrThrow({
          where: { id: usuarioId },
          select: { estado: true },
        });
        return { lanzo, estado: fila.estado, registro: await registroDe(tx, [usuarioId]) };
      });

      expect(r.lanzo).toBeInstanceOf(RegistroCaido);
      expect(r.estado, "el estado cambio sin su registro: R10 roto").toBe("activo");
      expect(r.registro).toEqual([]);
    });

    it("⭑ R11: fijar el estado QUE YA TENIA no deja fila", async () => {
      // El `updateMany` alcanza la fila (Postgres no distingue), pero el estado no CAMBIA: el
      // repositorio compara contra el previo y no registra. Un registro que dice «cambio de
      // activo a activo» es ruido que ahoga el modulo.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const usuarioId = await sembrarUsuario(tx, "r11u");
        const repo = new UserRepository(clienteConSavepoint(tx));
        await repo.setEstado(usuarioId, "activo", FKS!.tiendaId);
        return registroDe(tx, [usuarioId]);
      });
      expect(r).toEqual([]);
    });

    it("R11: un usuario INEXISTENTE no deja fila y devuelve `null`", async () => {
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const inventado = randomUUID();
        const repo = new UserRepository(clienteConSavepoint(tx));
        const salida = await repo.setEstado(inventado, "inactivo", FKS!.tiendaId);
        return { salida, registro: await registroDe(tx, [inventado]) };
      });
      expect(r.salida).toBeNull();
      expect(r.registro).toEqual([]);
    });

    it("el cambio de estado SI se registra, con el estado anterior y el nuevo (vocabulario cerrado)", async () => {
      // Control positivo: sin el, los tres `toEqual([])` de arriba podrian estar verdes porque el
      // registro no funciona en absoluto.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const usuarioId = await sembrarUsuario(tx, "ok-u");
        const repo = new UserRepository(clienteConSavepoint(tx));
        await repo.setEstado(usuarioId, "inactivo", FKS!.tiendaId);
        return tx.historialAccion.findMany({
          where: { entidadId: usuarioId },
          select: { accion: true, valorAnterior: true, valorNuevo: true, entidadEtiqueta: true },
        });
      });

      expect(r).toHaveLength(1);
      expect(r[0].accion).toBe("usuario_estado_cambiado");
      expect(r[0].valorAnterior).toBe("activo");
      expect(r[0].valorNuevo).toBe("inactivo");
      expect(r[0].entidadEtiqueta).toContain("Efimero");
    });

    it("⭑ R7: cambiar ROL y ZONA a la vez produce DOS filas con el MISMO `lote_id`", async () => {
      // Un acto de dos efectos, no dos actos. Es lo que el `lote_id` existe para poder decir.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const usuarioId = await sembrarUsuario(tx, "lote-u");
        const otroRol = await tx.rol.findFirstOrThrow({
          where: { value: { in: ["mensajero", "adminSatelite"] } },
          select: { id: true },
        });
        const repo = new UserRepository(clienteConSavepoint(tx));
        await repo.update(usuarioId, { rolId: otroRol.id, zonaId: FKS!.zonaId }, FKS!.tiendaId);
        return tx.historialAccion.findMany({
          where: { entidadId: usuarioId },
          select: { accion: true, loteId: true, valorAnterior: true, valorNuevo: true },
          orderBy: { accion: "asc" },
        });
      });

      expect(r.map((f) => f.accion)).toEqual(["usuario_rol_cambiado", "usuario_zona_cambiada"]);
      expect(new Set(r.map((f) => f.loteId)).size, "dos efectos de UN acto, un solo lote").toBe(1);
      // Vocabulario CERRADO: valores de enum y nombres de catalogo, nunca texto libre.
      expect(r[0].valorNuevo).toMatch(/^(mensajero|adminSatelite)$/);
    });

    it("⭑ Q2: cambiar el `fulfillment` de una tienda SI registra, y va como DINERO", async () => {
      // ⚠️ ESTE CASO EXISTE PORQUE LA GUARDIA DE CENSO NO BASTA, Y ESTA MEDIDO: con un
      // `if (false && …)` delante de la rama del `fulfillment`, la guardia de T7.1 SIGUE VERDE —
      // el literal del tipo sigue en el cuerpo del metodo—. Lo unico que caza esa mutacion es
      // ejercer el camino contra Postgres y contar la fila.
      //
      // Q2 la cerro el humano el 2026-09-02: cambiar `fulfillment` a una tienda activa un cobro
      // periodico de bodega, o sea MUEVE DINERO.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const usuarioId = await sembrarUsuario(tx, "fulf-u");
        const repo = new UserRepository(clienteConSavepoint(tx));
        await repo.update(usuarioId, { fulfillment: true }, FKS!.tiendaId);
        const fila = await tx.usuario.findUniqueOrThrow({
          where: { id: usuarioId },
          select: { fulfillment: true },
        });
        return {
          fulfillment: fila.fulfillment,
          registro: await tx.historialAccion.findMany({
            where: { entidadId: usuarioId },
            select: { accion: true, valorAnterior: true, valorNuevo: true },
          }),
        };
      });

      // Control positivo: la mutacion ocurrio de verdad …
      expect(r.fulfillment).toBe(true);
      // … y dejo EXACTAMENTE una fila, con su vocabulario cerrado.
      expect(r.registro).toHaveLength(1);
      expect(r.registro[0].accion).toBe("usuario_fulfillment_cambiado");
      expect(r.registro[0].valorAnterior).toBe("false");
      expect(r.registro[0].valorNuevo).toBe("true");
    });

    it("Q2: re-enviar el MISMO `fulfillment` no deja fila", async () => {
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const usuarioId = await sembrarUsuario(tx, "fulf-noop");
        const repo = new UserRepository(clienteConSavepoint(tx));
        await repo.update(usuarioId, { fulfillment: false }, FKS!.tiendaId);
        return registroDe(tx, [usuarioId]);
      });
      expect(r).toEqual([]);
    });

    it("⭑ editar SOLO el telefono NO registra nada (el caso (b) de T3.1)", async () => {
      // La otra mitad de R5 dicha en positivo: corregir un dato que no cambia lo que la persona
      // puede hacer —ni mueve dinero— no entra en el registro.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const usuarioId = await sembrarUsuario(tx, "tel-u");
        const repo = new UserRepository(clienteConSavepoint(tx));
        await repo.update(usuarioId, { telefono: "88887777" }, FKS!.tiendaId);
        const fila = await tx.usuario.findUniqueOrThrow({
          where: { id: usuarioId },
          select: { telefono: true },
        });
        return { telefono: fila.telefono, registro: await registroDe(tx, [usuarioId]) };
      });

      // El telefono SI cambio (control positivo: la mutacion ocurrio) …
      expect(r.telefono).toBe("88887777");
      // … y NO dejo rastro.
      expect(r.registro).toEqual([]);
    });
  });
});
