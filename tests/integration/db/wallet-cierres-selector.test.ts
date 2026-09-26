import { afterAll, describe, expect, it } from "vitest";

import { cierresDeLaCuentaAction } from "@/lib/actions/wallet-filtros";
import { listarPagosDeMensajeroAction } from "@/lib/actions/wallet-mensajero";
import { listarMovimientosDeTiendaAction } from "@/lib/actions/wallet-tienda";
import { FiltrosWalletRepository } from "@/lib/repositories/FiltrosWalletRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { FiltrosWalletService } from "@/lib/services/FiltrosWalletService";
import { WalletMensajeroService } from "@/lib/services/WalletMensajeroService";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import type { CierresDeLaCuentaResult } from "@/lib/types/wallet-filtros";
import { ORIGENES_FALSOS } from "@/tests/fixtures/origenes-falsos";

import { sembrarPersonas461 } from "./_fixtures/personas-461";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  type TxDeTest,
} from "./_postgres-real";

// =================================================================================================
// FICHA 458-A (TA.4, R10–R12) — el selector de cierre y el WHERE con la cuenta, contra Postgres
// =================================================================================================
//
// Memoria «probar el WHERE donde vive»: aqui el SQL corre en la base, por las actions, con los
// servicios y repositorios REALES sobre una transaccion revertida.
//
//  - R10/R11: el selector de una cuenta ofrece SOLO los cierres con movimientos en ESA cuenta,
//    rotulados con su dia de Costa Rica y su mensajero; la busqueda acota por dia o por nombre.
//  - R12: un cierre AJENO como filtro devuelve 0 filas (la cuenta sigue en el WHERE), y un valor sin
//    forma de identificador muere en el borde.
//
// Mutaciones comprobadas (progress/impl_458-A.md): quitar la cuenta del WHERE de `cierresDeTienda`,
// de `cierresDeMensajero`, de `listarPorTienda` y de `listarPorMensajero` pone rojo su caso.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

async function crearMensajero(tx: TxDeTest, nombre: string, apellido: string, segundo: string | null = null) {
  const plantilla = await tx.usuario.findFirstOrThrow({
    where: { rol: { value: "mensajero" } },
    select: { rolId: true, tipoIdentificacionId: true },
  });
  const sufijo = Math.random().toString(36).slice(2, 10);
  return tx.usuario.create({
    data: {
      nombre,
      primerApellido: apellido,
      segundoApellido: segundo,
      email: `m458a-${sufijo}@example.test`,
      telefono: "88880000",
      passwordHash: "x",
      cedula: `458A-${sufijo}`,
      tipoIdentificacionId: plantilla.tipoIdentificacionId,
      rolId: plantilla.rolId,
      estado: "activo",
    },
    select: { id: true, nombre: true, primerApellido: true, segundoApellido: true },
  });
}

async function sembrar(tx: TxDeTest) {
  const p = await sembrarPersonas461(tx);
  const zona = await tx.zona.findFirstOrThrow({ select: { id: true } });
  // Con segundo apellido, como 11 de los 22 mensajeros de produccion: el rotulo lo lleva entero.
  const ana = await crearMensajero(tx, "Anacleta", "Zúñiga458", "Mora458");
  const beto = await crearMensajero(tx, "Bertoldo", "Quirós458");
  const cierre = (mensajeroId: string, solicitadoAt: string) =>
    tx.cierreDia.create({
      data: {
        mensajeroId,
        estado: "aprobado",
        destinoTipo: "bodega_satelite",
        destinoZonaId: zona.id,
        solicitadoAt: new Date(solicitadoAt),
      },
      select: { id: true },
    });
  // 22:30 del 12 de septiembre en Costa Rica (04:30Z del 13): el dia del rotulo es el 12.
  const cA = await cierre(ana.id, "2026-09-13T04:30:00.000Z");
  const cB = await cierre(beto.id, "2026-09-15T18:00:00.000Z");
  // El libro tiene un UNICO por (origen, categoria): dos filas del mismo cierre van con conceptos distintos.
  const mov = (tiendaId: string, cierreId: string, monto: string, debito = false) => ({
    tiendaId,
    tipo: debito ? ("debito" as const) : ("credito" as const),
    categoria: debito ? ("flete" as const) : ("cod_recaudado" as const),
    monto,
    origenTipo: "cierre_dia" as const,
    origenId: cierreId,
  });
  await tx.walletTiendaMovimiento.createMany({
    data: [mov(p.tiendaId, cA.id, "100.00"), mov(p.tiendaId, cA.id, "50.00", true), mov(p.otraTiendaId, cB.id, "70.00")],
  });
  await tx.pagoMensajeroMovimiento.createMany({
    data: [
      { mensajeroId: ana.id, tipo: "devengo", categoria: "pago_devengado", monto: "3000.00", origenTipo: "cierre_dia", origenId: cA.id },
      { mensajeroId: beto.id, tipo: "devengo", categoria: "pago_devengado", monto: "2000.00", origenTipo: "cierre_dia", origenId: cB.id },
    ],
  });
  return { p, ana, beto, cA, cB };
}

function filtros(tx: TxDeTest, actor: unknown) {
  return {
    getActor: async () => actor as never,
    service: new FiltrosWalletService(new FiltrosWalletRepository(tx as never)),
  };
}

function opciones(r: CierresDeLaCuentaResult) {
  if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);
  return r.opciones;
}

describeSiHayBase("458-A R10–R12 — el selector de cierre y el WHERE con la cuenta, contra Postgres", () => {
  const prisma = crearPrismaDeTest();
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R11 tienda: solo los cierres con movimientos en ESA tienda, con día CR, mensajero y cuántos", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrar(tx);
      const res = await cierresDeLaCuentaAction({ cuenta: "tienda", tiendaId: e.p.tiendaId }, filtros(tx, e.p.maestro));
      return { e, res };
    });
    expect(opciones(r.res)).toEqual([
      {
        cierreId: r.e.cA.id,
        dia: "2026-09-12",
        hora: "22:30",
        // Escrito a mano (revision m6): compararlo contra `etiquetaDeCuenta(...)` estaria siempre verde.
        mensajero: "Anacleta Zúñiga458 Mora458",
        movimientos: 2,
      },
    ]);
  });

  it("R11 mensajero: solo SUS cierres", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrar(tx);
      const res = await cierresDeLaCuentaAction({ cuenta: "mensajero", mensajeroId: e.beto.id }, filtros(tx, e.p.maestro));
      return { e, res };
    });
    expect(opciones(r.res).map((o) => o.cierreId)).toEqual([r.e.cB.id]);
  });

  it("R10: la búsqueda acota por nombre del mensajero o por día de Costa Rica", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrar(tx);
      const d = filtros(tx, e.p.maestro);
      const base = { cuenta: "tienda" as const, tiendaId: e.p.tiendaId };
      return {
        e,
        porNombre: await cierresDeLaCuentaAction({ ...base, busqueda: "zúñiga458" }, d),
        porSegundoApellido: await cierresDeLaCuentaAction({ ...base, busqueda: "mora458" }, d),
        porOtroNombre: await cierresDeLaCuentaAction({ ...base, busqueda: "Bertoldo" }, d),
        porDia: await cierresDeLaCuentaAction({ ...base, busqueda: "2026-09-12" }, d),
        porDiaUtc: await cierresDeLaCuentaAction({ ...base, busqueda: "2026-09-13" }, d),
      };
    });
    expect(opciones(r.porNombre).map((o) => o.cierreId)).toEqual([r.e.cA.id]);
    expect(opciones(r.porSegundoApellido).map((o) => o.cierreId)).toEqual([r.e.cA.id]);
    expect(opciones(r.porOtroNombre)).toEqual([]); // Bertoldo no tiene cierres en ESTA tienda
    expect(opciones(r.porDia).map((o) => o.cierreId)).toEqual([r.e.cA.id]);
    expect(opciones(r.porDiaUtc)).toEqual([]); // el 13 en UTC es el 12 en Costa Rica
  });

  // Revision 458-A (m4): la busqueda iba a una lectura previa SIN tope cuyos ids viajaban en un `IN`.
  // Buscar un nombre muy comun casa los cierres de casi toda la historia y el `IN` pasa el limite de
  // parametros de Postgres (32.767): el selector entraba en «error». Aqui 33.000 cierres de Anacleta
  // SIN movimientos en la tienda ni en su libro casan la busqueda; la respuesta tiene que seguir
  // siendo el unico cierre suyo que SI los tiene.
  it("m4: 33.000 cierres que casan la búsqueda no rompen el selector (tienda y mensajero)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrar(tx);
      const zona = await tx.zona.findFirstOrThrow({ select: { id: true } });
      await tx.$executeRaw`
        INSERT INTO "cierre_dia" ("id", "mensajero_id", "estado", "destino_tipo", "destino_zona_id", "solicitado_at", "updated_at")
        SELECT gen_random_uuid()::text, ${e.ana.id}, 'aprobado'::"cierre_estado", 'bodega_satelite'::"cierre_destino_tipo",
               ${zona.id}, TIMESTAMP '2026-01-01 00:00:00' + g * INTERVAL '1 minute', now()
        FROM generate_series(1, 33000) AS g
      `;
      const d = filtros(tx, e.p.maestro);
      return {
        e,
        tienda: await cierresDeLaCuentaAction({ cuenta: "tienda", tiendaId: e.p.tiendaId, busqueda: "Zúñiga458" }, d),
        mensajero: await cierresDeLaCuentaAction({ cuenta: "mensajero", mensajeroId: e.ana.id, busqueda: "Anacleta" }, d),
      };
    });
    expect(opciones(r.tienda).map((o) => o.cierreId)).toEqual([r.e.cA.id]);
    expect(opciones(r.mensajero).map((o) => o.cierreId)).toEqual([r.e.cA.id]);
  }, 60_000);

  it("m4: el texto buscado es literal, `%` y `_` no son comodines", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrar(tx);
      const d = filtros(tx, e.p.maestro);
      const base = { cuenta: "tienda" as const, tiendaId: e.p.tiendaId };
      return {
        porciento: await cierresDeLaCuentaAction({ ...base, busqueda: "%" }, d),
        guion: await cierresDeLaCuentaAction({ ...base, busqueda: "Z_ñiga458" }, d),
      };
    });
    expect(opciones(r.porciento)).toEqual([]);
    expect(opciones(r.guion)).toEqual([]);
  });

  it("R12 tienda: un cierre AJENO como filtro devuelve 0 filas; el propio, las suyas", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrar(tx);
      const deps = {
        getActor: async () => e.p.maestro,
        service: new WalletTiendaService(new WalletTiendaMovimientoRepository(tx as never)),
        origenes: ORIGENES_FALSOS,
      };
      return {
        ajeno: await listarMovimientosDeTiendaAction({ tiendaId: e.p.tiendaId, cierreId: e.cB.id }, deps),
        propio: await listarMovimientosDeTiendaAction({ tiendaId: e.p.tiendaId, cierreId: e.cA.id }, deps),
      };
    });
    if (r.ajeno.status !== "ok" || r.propio.status !== "ok") throw new Error("esperado ok");
    expect(r.ajeno.data.movimientos).toEqual([]);
    expect(r.ajeno.data.total).toBe(0);
    expect(r.ajeno.data.desglose.aFavor).toBe("0.00");
    expect(r.propio.data.total).toBe(2);
  });

  it("R12 mensajero: un cierre de OTRO mensajero como filtro devuelve 0 filas", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrar(tx);
      const deps = {
        getActor: async () => e.p.maestro,
        service: new WalletMensajeroService(new PagoMensajeroMovimientoRepository(tx as never)),
        origenes: ORIGENES_FALSOS,
      };
      return {
        ajeno: await listarPagosDeMensajeroAction({ mensajeroId: e.ana.id, cierreId: e.cB.id }, deps),
        propio: await listarPagosDeMensajeroAction({ mensajeroId: e.ana.id, cierreId: e.cA.id }, deps),
      };
    });
    if (r.ajeno.status !== "ok" || r.propio.status !== "ok") throw new Error("esperado ok");
    expect(r.ajeno.data.total).toBe(0);
    expect(r.ajeno.data.cuenta.devengado).toBe("0.00");
    expect(r.propio.data.total).toBe(1);
  });

  it("R12 borde: un valor sin forma de identificador es validation_error y no llega a la base", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrar(tx);
      const deps = {
        getActor: async () => e.p.maestro,
        service: new WalletTiendaService(new WalletTiendaMovimientoRepository(tx as never)),
        origenes: ORIGENES_FALSOS,
      };
      return Promise.all(
        ["ID del cierre", "' OR 1=1 --", e.cA.id.slice(0, 8)].map((cierreId) =>
          listarMovimientosDeTiendaAction({ tiendaId: e.p.tiendaId, cierreId }, deps),
        ),
      );
    });
    expect(r.map((x) => x.status)).toEqual(["validation_error", "validation_error", "validation_error"]);
  });
});
