import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { autoriaDelLibroCajaAction } from "@/lib/actions/libro-caja-autoria";
import { LibroCajaAutoriaRepository } from "@/lib/repositories/LibroCajaAutoriaRepository";
import { LibroCajaAutoriaService } from "@/lib/services/LibroCajaAutoriaService";
import type { AutoriaDeFilaDTO, AutoriaLibroCajaResult } from "@/lib/types/libro-caja-autoria";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, sembrarEscenario459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.7 (R56/R57) — «A quien» y «Registro» del libro de la caja, contra Postgres, sobre el
// escenario de la fase 0 de la 459 (todos los caminos que escriben en la caja, por sus servicios reales)
// + el pago de un gasto de una tienda, un aporte y una anotacion a mano sobre el gasto variable.
//
// Una fila por ORIGEN: el nombre esperado se LEE de la tabla `usuario` (no de la funcion que se prueba)
// y se compara con lo que resuelve el servicio. Nunca un id donde se pinta (H6); el id de la cuenta solo
// en `cuenta` (el enlace). Sin anotacion, «—» (`nombre: null`). Automatico: la accion y quien la decidio.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface Medida {
  porOrigen: Record<string, AutoriaDeFilaDTO[]>;
  nombres: Record<"tiendaA" | "tiendaB" | "mensajero" | "maestro" | "adminSat", string>;
  ids: { tiendaA: string; tiendaB: string; mensajero: string };
  sueldoId: string;
  gastoId: string;
  sinSesion: AutoriaLibroCajaResult;
  comoTienda: AutoriaLibroCajaResult;
}

describeSiHayBase("458-B/TB.7 — «A quien» y «Registro» del libro de la caja (Postgres real)", () => {
  let prisma: PrismaClient;
  let medida: Medida | undefined;
  let fallo: unknown;

  function m(): Medida {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la medida no llego a tomarse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      medida = await enTransaccionRevertida459(prisma, async (tx) => {
        const s = montarServicios459(tx);
        const previos = new Set((await tx.walletMovimiento.findMany({ select: { id: true } })).map((x) => x.id));
        const esc = await sembrarEscenario459(tx, cat);
        const pago = await s.pagoPorCuenta.registrar(
          { claveIdempotencia: randomUUID(), tiendaId: esc.tiendaA, beneficiario: "Imprenta Ruiz", monto: "100.00", metodo: "efectivo", motivo: "Etiquetas" },
          null,
          esc.maestro,
        );
        if (pago.status !== "ok") throw new Error(`pago por cuenta: ${JSON.stringify(pago)}`);
        const aporte = await s.aporteCapital.registrar(
          { claveIdempotencia: randomUUID(), clase: "aporte", monto: "50.00", fecha: "2026-09-20", motivo: "Aporte 458" },
          null,
          esc.maestro,
        );
        if (aporte.status !== "ok") throw new Error(`aporte: ${JSON.stringify(aporte)}`);
        const gasto = await tx.walletMovimiento.findFirstOrThrow({
          where: { categoria: "egreso_gasto_variable", registradoPor: esc.maestro.usuarioId },
          select: { id: true },
        });
        await tx.walletAnotacion.create({ data: { movimientoId: gasto.id, contraparteNombre: "Cartonera del Valle" } });
        const sueldo = await tx.walletMovimiento.findFirstOrThrow({
          where: { categoria: "egreso_sueldo", registradoPor: esc.maestro.usuarioId },
          select: { id: true },
        });

        const nuevas = (await tx.walletMovimiento.findMany({ select: { id: true, origenTipo: true } })).filter((x) => !previos.has(x.id));
        const servicio = new LibroCajaAutoriaService(new LibroCajaAutoriaRepository(s.cliente));
        const r = await autoriaDelLibroCajaAction(
          { movimientoIds: nuevas.map((x) => x.id) },
          { getActor: async () => esc.maestro, service: servicio },
        );
        if (r.status !== "ok") throw new Error(`autoria: ${JSON.stringify(r)}`);
        const origenDe = new Map(nuevas.map((x) => [x.id, x.origenTipo as string]));
        const porOrigen: Record<string, AutoriaDeFilaDTO[]> = {};
        for (const f of r.filas) (porOrigen[origenDe.get(f.movimientoId) as string] ??= []).push(f);

        const nombreDe = async (id: string) => (await tx.usuario.findUniqueOrThrow({ where: { id }, select: { nombre: true } })).nombre;
        const adminSat = await tx.cierreDia.findUniqueOrThrow({ where: { id: esc.cierreId }, select: { resueltoPor: true } });
        return {
          porOrigen,
          nombres: {
            tiendaA: await nombreDe(esc.tiendaA),
            tiendaB: await nombreDe(esc.tiendaB),
            mensajero: await nombreDe(esc.mensajeroId),
            maestro: await nombreDe(esc.maestro.usuarioId),
            adminSat: await nombreDe(adminSat.resueltoPor as string),
          },
          ids: { tiendaA: esc.tiendaA, tiendaB: esc.tiendaB, mensajero: esc.mensajeroId },
          sueldoId: sueldo.id,
          gastoId: gasto.id,
          sinSesion: await autoriaDelLibroCajaAction({ movimientoIds: [gasto.id] }, { getActor: async () => null, service: servicio }),
          comoTienda: await autoriaDelLibroCajaAction(
            { movimientoIds: [gasto.id] },
            { getActor: async () => ({ usuarioId: esc.tiendaA, rol: "adminTienda" }), service: servicio },
          ),
        };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("anti-vacuidad: hay filas de los nueve origenes que el escenario escribe en la caja", () => {
    expect(Object.keys(m().porOrigen).sort()).toEqual([
      "aporte_capital",
      "cierre_dia",
      "cobro_tienda",
      "gasto",
      "gestion_orden",
      "manual",
      "pago_por_cuenta_tienda",
      "pago_tienda",
      "ranking_snapshot_fila",
    ]);
  });

  it("R56: el cierre → su MENSAJERO (con enlace); R57: automatico, «aprobacion del cierre» por quien lo aprobo", () => {
    for (const f of m().porOrigen.cierre_dia) {
      expect(f.aQuien).toEqual({ nombre: m().nombres.mensajero, beneficiario: null, cuenta: { tipo: "mensajero", id: m().ids.mensajero }, esOrdenex: false });
      expect(f.registro).toEqual({ nombre: null, automatico: { accion: "aprobacion_cierre", por: m().nombres.adminSat } });
    }
  });

  it("R56: el pago a una tienda → ESA tienda; el cobro por rechazo → la tienda cobrada; el cobro de Ordenex → la tienda; R57: el maestro", () => {
    const tiendas = m().porOrigen.pago_tienda.map((f) => f.aQuien.nombre).sort();
    expect(tiendas).toEqual([m().nombres.tiendaA, m().nombres.tiendaA, m().nombres.tiendaB].sort());
    for (const f of m().porOrigen.gestion_orden) {
      expect(f.aQuien.cuenta).toEqual({ tipo: "tienda", id: m().ids.tiendaA });
      expect(f.registro.nombre).toBe(m().nombres.maestro);
    }
    for (const f of m().porOrigen.cobro_tienda) expect(f.aQuien.cuenta).toEqual({ tipo: "tienda", id: m().ids.tiendaB });
  });

  it("R56: el premio → el mensajero del podio; el pago de un gasto → la tienda Y el tercero; el aporte → «Ordenex»", () => {
    for (const f of m().porOrigen.ranking_snapshot_fila) expect(f.aQuien.cuenta).toEqual({ tipo: "mensajero", id: m().ids.mensajero });
    expect(m().porOrigen.pago_por_cuenta_tienda.map((f) => [f.aQuien.nombre, f.aQuien.beneficiario])).toEqual([
      [m().nombres.tiendaA, "Imprenta Ruiz"],
    ]);
    expect(m().porOrigen.aporte_capital.map((f) => f.aQuien.esOrdenex)).toEqual([true]);
  });

  it("R42/R56: el gasto con anotacion dice A QUIEN; el sueldo anterior sin anotacion, «—» (`null`)", () => {
    const porId = new Map(m().porOrigen.gasto.map((f) => [f.movimientoId, f]));
    expect(porId.get(m().gastoId)?.aQuien.nombre).toBe("Cartonera del Valle");
    expect(porId.get(m().sueldoId)?.aQuien.nombre).toBeNull();
    for (const f of m().porOrigen.manual) expect(f.aQuien.nombre).toBeNull();
  });

  it("H6: ningun nombre, beneficiario ni registro lleva un identificador", () => {
    for (const filas of Object.values(m().porOrigen)) {
      for (const f of filas) {
        expect(f.aQuien.nombre ?? "").not.toMatch(UUID);
        expect(f.aQuien.beneficiario ?? "").not.toMatch(UUID);
        expect(f.registro.nombre ?? "").not.toMatch(UUID);
        expect(f.registro.automatico?.por ?? "").not.toMatch(UUID);
      }
    }
  });

  it("R82: sin sesion `unauthenticated`; una tienda `forbidden`", () => {
    expect(m().sinSesion).toEqual({ status: "unauthenticated" });
    expect(m().comoTienda).toEqual({ status: "forbidden" });
  });
});
