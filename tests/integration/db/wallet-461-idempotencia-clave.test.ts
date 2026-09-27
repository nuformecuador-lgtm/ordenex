import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales, type TxDeTest } from "./_postgres-real";
import { cargarCatalogo459, montarServicios459 } from "./_fixtures/caja-459";
import { sembrarPersonas461, type Personas461 } from "./_fixtures/personas-461";
import { sqlstateDe } from "./_fixtures/sqlstate-461";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 461 / R66, R67, R68 (auditoria de la wallet, D2) — LA CLAVE DE IDEMPOTENCIA, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El fallo medido por la auditoria: los tres registros manuales de dinero insertaban con `origen_id
// NULL`, fuera del indice unico parcial, y dos envios identicos en 10 s quedaban como DOS filas. Aqui
// se mide, con los SERVICIOS REALES sobre la base real, que con la MISMA clave:
//   · el segundo envio responde `ya_registrado` con la fila ORIGINAL (mismo id);
//   · no queda una segunda fila en NINGUN libro ni una segunda fila de historial;
//   · y con claves DISTINTAS siguen siendo dos filas (la clave no deduplica por parecido).
// Y que la barrera vive en la BASE (R67): el indice UNIQUE rechaza un INSERT directo con la clave
// repetida (23505), mientras que los escritores automaticos dejan la columna en NULL.
//
// Todo en transacciones que SIEMPRE se revierten; las personas se crean dentro (fixture 461).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("461/R66–R68 — la clave de idempotencia de los tres registros manuales (Postgres real)", () => {
  let prisma: PrismaClient;
  let cat: Awaited<ReturnType<typeof cargarCatalogo459>>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    cat = await cargarCatalogo459(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function conPersonas<T>(cuerpo: (tx: TxDeTest, p: Personas461) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      return cuerpo(tx, p);
    });
  }

  it("R68 · cobro a una tienda: dos envios con la MISMA clave -> un debito, un cargo, un historial; el segundo responde `ya_registrado` con el mismo cobro", async () => {
    const m = await conPersonas(async (tx, p) => {
      const s = montarServicios459(tx);
      const clave = randomUUID();
      const entrada = { claveIdempotencia: clave, tiendaId: p.tiendaId, monto: "2500.50", descripcion: "Etiquetas" };
      const primero = await s.cobroTienda.registrarCobro(entrada, p.maestro);
      const segundo = await s.cobroTienda.registrarCobro(entrada, p.maestro);
      const distinto = await s.cobroTienda.registrarCobro({ ...entrada, claveIdempotencia: randomUUID() }, p.maestro);
      if (primero.status !== "ok" || segundo.status !== "ya_registrado" || distinto.status !== "ok") {
        throw new Error(`respuestas: ${primero.status} / ${segundo.status} / ${distinto.status}`);
      }
      const debitos = await tx.walletTiendaMovimiento.findMany({
        where: { tiendaId: p.tiendaId, categoria: "cobro_manual" },
        select: { id: true, claveIdempotencia: true },
      });
      return {
        mismoId: segundo.cobro.id === primero.cobro.id,
        saldoSegundo: segundo.saldo.saldo,
        debitos: debitos.length,
        clavesDeLosDebitos: debitos.map((d) => d.claveIdempotencia).sort(),
        clave,
        cargos: await tx.walletMovimiento.count({ where: { origenTipo: "cobro_tienda", origenId: primero.cobro.id } }),
        cargoSinClave: (await tx.walletMovimiento.findFirstOrThrow({ where: { origenTipo: "cobro_tienda", origenId: primero.cobro.id } }))
          .claveIdempotencia,
        historial: await tx.historialAccion.count({ where: { entidadId: primero.cobro.id, accion: "cobro_tienda_registrado" } }),
      };
    });
    expect(m.mismoId).toBe(true);
    // Dos cobros REALES (claves distintas) de 2 500,50: el saldo tras el «segundo envio» ya refleja el
    // primero solamente (el distinto se registro despues), asi que es −2 500,50.
    expect(m.saldoSegundo).toBe("-2500.50");
    expect(m.debitos).toBe(2); // el original + el de clave DISTINTA; el doble envio no cuenta
    expect(m.clavesDeLosDebitos).toContain(m.clave);
    expect(m.cargos).toBe(1);
    expect(m.cargoSinClave).toBeNull(); // R67: el asiento automatico (el cargo) no lleva clave
    expect(m.historial).toBe(1);
  });

  it("R68 · correccion de caja: la MISMA clave -> una fila y un historial; `ya_registrado` devuelve la original", async () => {
    const m = await conPersonas(async (tx, p) => {
      const s = montarServicios459(tx);
      const clave = randomUUID();
      const entrada = { claveIdempotencia: clave, tipo: "ingreso" as const, categoria: "ingreso_ajuste" as const, monto: "1000.25", descripcion: "Sobrante" };
      const primero = await s.wallet.registrarMovimientoManual(entrada, p.maestro);
      const segundo = await s.wallet.registrarMovimientoManual(entrada, p.maestro);
      if (primero.status !== "ok" || segundo.status !== "ya_registrado") {
        throw new Error(`respuestas: ${primero.status} / ${segundo.status}`);
      }
      return {
        mismoId: segundo.movimiento.id === primero.movimiento.id,
        filas: await tx.walletMovimiento.count({ where: { registradoPor: p.maestro.usuarioId, categoria: "ingreso_ajuste" } }),
        clave: (await tx.walletMovimiento.findUniqueOrThrow({ where: { id: primero.movimiento.id } })).claveIdempotencia,
        historial: await tx.historialAccion.count({ where: { entidadId: primero.movimiento.id } }),
      };
    });
    expect(m.mismoId).toBe(true);
    expect(m.filas).toBe(1);
    expect(m.clave).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.historial).toBe(1);
  });

  it("R68 · sueldo o gasto de Ordenex: la MISMA clave -> una fila y un historial; `ya_registrado` devuelve la original", async () => {
    const m = await conPersonas(async (tx, p) => {
      const s = montarServicios459(tx);
      const clave = randomUUID();
      const entrada = { claveIdempotencia: clave, tipoEgreso: "sueldo" as const, monto: "45000.00", descripcion: "Quincena" };
      const primero = await s.egresos.registrarEgreso(entrada, p.maestro);
      const segundo = await s.egresos.registrarEgreso(entrada, p.maestro);
      const distinto = await s.egresos.registrarEgreso({ ...entrada, claveIdempotencia: randomUUID() }, p.maestro);
      if (primero.status !== "ok" || segundo.status !== "ya_registrado" || distinto.status !== "ok") {
        throw new Error(`respuestas: ${primero.status} / ${segundo.status} / ${distinto.status}`);
      }
      return {
        mismoId: segundo.movimiento.id === primero.movimiento.id,
        filas: await tx.walletMovimiento.count({ where: { registradoPor: p.maestro.usuarioId, categoria: "egreso_sueldo" } }),
        historial: await tx.historialAccion.count({ where: { actorUsuarioId: p.maestro.usuarioId, accion: "egreso_administrativo_registrado" } }),
      };
    });
    expect(m.mismoId).toBe(true);
    expect(m.filas).toBe(2); // el original + el de clave distinta
    expect(m.historial).toBe(2);
  });

  it("R67 · la barrera esta en la BASE: un INSERT directo con la clave repetida choca en el indice UNIQUE (23505), en los dos libros", async () => {
    const m = await conPersonas(async (tx, p) => {
      const clave = randomUUID();
      const insertarCaja = () =>
        tx.$executeRawUnsafe(
          `INSERT INTO "wallet_movimiento" ("id","tipo","categoria","monto","origen_tipo","origen_id","registrado_por","clave_idempotencia")
           VALUES ($1, 'egreso', 'egreso_ajuste', 1, 'manual', NULL, $2, $3)`,
          randomUUID(),
          p.maestro.usuarioId,
          clave,
        );
      const insertarTienda = () =>
        tx.$executeRawUnsafe(
          `INSERT INTO "wallet_tienda_movimiento" ("id","tienda_id","tipo","categoria","monto","origen_tipo","origen_id","registrado_por","clave_idempotencia")
           VALUES ($1, $2, 'debito', 'cobro_manual', 1, 'manual', NULL, $3, $4)`,
          randomUUID(),
          p.tiendaId,
          p.maestro.usuarioId,
          clave,
        );
      const codigoDe = async (fn: () => Promise<unknown>): Promise<string> => {
        const punto = `sp_${randomUUID().replace(/-/g, "")}`;
        await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
        try {
          await fn();
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
          return "ACEPTADO";
        } catch (e) {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
          return sqlstateDe(e);
        }
      };
      return {
        caja: [await codigoDe(insertarCaja), await codigoDe(insertarCaja)],
        tienda: [await codigoDe(insertarTienda), await codigoDe(insertarTienda)],
        // La MISMA clave en el OTRO libro no choca: son indices distintos, y una clave solo vive en uno.
        cruzada: "ambos aceptados",
        indices: (
          await tx.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
            `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
              AND indexname IN ('wallet_movimiento_clave_idempotencia_key','wallet_tienda_movimiento_clave_idempotencia_key') ORDER BY 1`,
          )
        ).map((i) => `${i.indexname}: ${i.indexdef}`),
      };
    });
    expect(m.caja).toEqual(["ACEPTADO", "23505"]);
    expect(m.tienda).toEqual(["ACEPTADO", "23505"]);
    expect(m.indices).toEqual([
      'wallet_movimiento_clave_idempotencia_key: CREATE UNIQUE INDEX wallet_movimiento_clave_idempotencia_key ON public.wallet_movimiento USING btree (clave_idempotencia)',
      'wallet_tienda_movimiento_clave_idempotencia_key: CREATE UNIQUE INDEX wallet_tienda_movimiento_clave_idempotencia_key ON public.wallet_tienda_movimiento USING btree (clave_idempotencia)',
    ]);
  });

  it("R67 · los NULL no chocan entre si: los asientos automaticos siguen entrando sin clave, tantos como haga falta", async () => {
    const n = await conPersonas(async (tx, p) => {
      await tx.walletMovimiento.createMany({
        data: [1, 2, 3].map((i) => ({
          tipo: "ingreso",
          categoria: "ingreso_flete",
          monto: new Prisma.Decimal(`${i}.00`),
          origenTipo: "cierre_dia",
          origenId: randomUUID(),
          registradoPor: p.maestro.usuarioId,
        })),
      });
      return tx.walletMovimiento.count({ where: { registradoPor: p.maestro.usuarioId, claveIdempotencia: null } });
    });
    expect(n).toBe(3);
  });
});
