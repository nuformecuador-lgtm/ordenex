import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { PagoPorCuentaTiendaRepository } from "@/lib/repositories/PagoPorCuentaTiendaRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletService } from "@/lib/services/WalletService";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";
import { enTransaccionRevertida459 } from "./_fixtures/caja-459";
import {
  UP_RECLASIFICACION_459 as UP,
  downCon,
  sumaDe,
  upCon,
  type Aprobado,
} from "./_fixtures/reclasificacion-459-sql";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 459 / T C.5 — la migracion de RECLASIFICACION, ejecutada de verdad contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Se lee el `migration.sql` REAL y se sustituyen SOLO los dos tramos marcados: la lista
// (`-- LISTA-INICIO`/`-- LISTA-FIN`) por cobros sembrados en la base de test, y las constantes de
// control (`-- CONTROL-INICIO`/`-- CONTROL-FIN`) por su numero, su suma y su tienda. Todo lo demas
// —comprobaciones, INSERT, ON CONFLICT, recuento final— es el texto que se desplegara. Igual con el
// `down.sql`. Cada caso corre en una transaccion que SIEMPRE se revierte; los que esperan una
// excepcion la ejecutan dentro de un SAVEPOINT, y luego se comprueba que no quedo NADA escrito.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Ejecuta `sql` en un SAVEPOINT: devuelve el mensaje de la excepcion, o null si no la hubo. */
async function intentar(tx: TxDeTest, sql: string): Promise<string | null> {
  await tx.$executeRawUnsafe("SAVEPOINT reclasificacion_459");
  try {
    await tx.$executeRawUnsafe(sql);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT reclasificacion_459");
    return null;
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT reclasificacion_459");
    return error instanceof Error ? error.message : String(error);
  }
}

interface Siembra {
  tiendaId: string;
  otraTiendaId: string;
  maestroId: string;
  cobros: Aprobado[];
  control: { n: number; suma: string; tienda: string };
  otroDebitoId: string; // un debito de la tienda que NO es un cobro de un costo
}

async function sembrar(tx: TxDeTest): Promise<Siembra> {
  const tipo = await tx.tipoIdentificacion.findUniqueOrThrow({ where: { value: "cedula" }, select: { id: true } });
  const rol = async (v: string) => (await tx.rol.findFirstOrThrow({ where: { value: v as never }, select: { id: true } })).id;
  const sufijo = randomUUID().slice(0, 8);
  const usuario = async (nombre: string, apellido: string | null, r: string) =>
    (
      await tx.usuario.create({
        data: {
          nombre,
          primerApellido: apellido,
          email: `${nombre.toLowerCase()}-rc459-${sufijo}@example.test`,
          telefono: "88880000",
          passwordHash: "x",
          cedula: `RC459-${nombre}-${sufijo}`,
          tipoIdentificacionId: tipo.id,
          rolId: await rol(r),
          estado: "activo",
        },
        select: { id: true },
      })
    ).id;
  const tiendaId = await usuario("Nuformtest", "Prueba", "adminTienda");
  const otraTiendaId = await usuario("Otratienda", null, "adminTienda");
  const maestroId = await usuario("Maestro", null, "maestro");

  const cobro = async (tienda: string, monto: string, instante: string, descripcion: string) =>
    (
      await tx.walletTiendaMovimiento.create({
        data: {
          tiendaId: tienda,
          tipo: "debito",
          categoria: "cobro_manual",
          monto: new Prisma.Decimal(monto),
          origenTipo: "manual",
          descripcion,
          registradoPor: maestroId,
          fechaMovimiento: new Date(instante),
        },
        select: { id: true, monto: true },
      })
    );
  const c1 = await cobro(tiendaId, "86415.60", "2026-08-28T15:04:05.123Z", "Pago Facebook");
  const c2 = await cobro(tiendaId, "11233.20", "2026-08-28T23:59:59.999Z", "FACEBOOK IVA");
  const c3 = await cobro(tiendaId, "0.01", "2026-09-01T06:00:00.000Z", "Jet Cargo");
  const otroDebito = await tx.walletTiendaMovimiento.create({
    data: {
      tiendaId,
      tipo: "debito",
      categoria: "ajuste_debito",
      monto: new Prisma.Decimal("500.00"),
      origenTipo: "manual",
      descripcion: "ajuste",
      registradoPor: maestroId,
    },
    select: { id: true },
  });
  const cobros = [c1, c2, c3].map((c) => ({ id: c.id, monto: c.monto.toFixed(2) }));
  return {
    tiendaId,
    otraTiendaId,
    maestroId,
    cobros,
    control: { n: cobros.length, suma: sumaDe(cobros), tienda: tiendaId },
    otroDebitoId: otroDebito.id,
  };
}

async function salidas(tx: TxDeTest, ids: string[]) {
  return tx.walletMovimiento.findMany({
    where: { origenTipo: "cobro_manual_reclasificado", origenId: { in: ids } },
    orderBy: { monto: "desc" },
  });
}

describeSiHayBase("459/C.5 — la migracion de reclasificacion contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R83 (esta base): la migracion REAL ya aplicada aqui no escribio nada — ningun id aprobado existe", async () => {
    const ids = [...UP.slice(UP.indexOf("-- LISTA-INICIO"), UP.indexOf("-- LISTA-FIN")).matchAll(/'([0-9a-f-]{36})'/g)].map(
      (m) => m[1],
    );
    expect(ids).toHaveLength(203);
    expect(await prisma.walletMovimiento.count({ where: { origenTipo: "cobro_manual_reclasificado" } })).toBe(0);
    expect(await prisma.walletTiendaMovimiento.count({ where: { id: { in: ids } } })).toBe(0);
    // Y ejecutarla otra vez tal cual tampoco escribe nada ni falla.
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      const error = await intentar(tx, UP);
      return { error, n: await tx.walletMovimiento.count({ where: { origenTipo: "cobro_manual_reclasificado" } }) };
    });
    expect(r).toEqual({ error: null, n: 0 });
  }, 120_000);

  it("R81/R87/R8: una salida por cobro, mismo monto y MISMO instante; el libro de la tienda intacto; «De las tiendas» baja en la suma", async () => {
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      const s = await sembrar(tx);
      // Ficha 461: `LectoresDocumentosCaja` gana `cobros` (solo cableado, exigido por el compilador; ninguna asercion de este archivo cambia, R61).
      const wallet = new WalletService(new WalletMovimientoRepository(tx as never), tx as never, new AporteCapitalRepository(tx as never), { pagosPorCuenta: new PagoPorCuentaTiendaRepository(tx as never), aportes: new AporteCapitalRepository(tx as never), cobros: { estadoDeDocumentos: async () => [] }, ajustes: { estadoDeDocumentos: async () => [] }, abonos: { estadoDeDocumentos: async () => [] }, egresos: { estadoDeDocumentos: async () => [] }, indemnizaciones: { estadoDeDocumentos: async () => [] }, rechazos: { estadoDeDocumentos: async () => [] }, pagosATienda: { estadoDeDocumentos: async () => [] }, premios: { estadoDeDocumentos: async () => [] } });
      const actor = { usuarioId: s.maestroId, rol: "maestro" as const };
      const leer = async () => {
        const x = await wallet.verResumenCaja({ page: 1, pageSize: 1 }, actor);
        if (x.status !== "ok") throw new Error("resumen");
        return x.resumen;
      };
      const tiendaAntes = await tx.walletTiendaMovimiento.findMany({ where: { tiendaId: s.tiendaId }, orderBy: { id: "asc" } });
      const cajaAntes = await tx.walletMovimiento.count();
      const antes = await leer();
      const error = await intentar(tx, upCon(s.cobros, s.control));
      const despues = await leer();
      return {
        s,
        error,
        escritas: await salidas(tx, s.cobros.map((c) => c.id)),
        cobrosEnBase: await tx.walletTiendaMovimiento.findMany({ where: { id: { in: s.cobros.map((c) => c.id) } } }),
        tiendaAntes,
        tiendaDespues: await tx.walletTiendaMovimiento.findMany({ where: { tiendaId: s.tiendaId }, orderBy: { id: "asc" } }),
        nuevasEnCaja: (await tx.walletMovimiento.count()) - cajaAntes,
        antes,
        despues,
      };
    });
    expect(r.error).toBeNull();
    expect(r.nuevasEnCaja).toBe(3);
    const porCobro = new Map(r.cobrosEnBase.map((c) => [c.id, c]));
    expect(r.escritas).toHaveLength(3);
    for (const w of r.escritas) {
      const c = porCobro.get(w.origenId as string)!;
      expect([w.tipo, w.categoria, w.origenTipo]).toEqual(["egreso", "egreso_pago_por_cuenta_tienda", "cobro_manual_reclasificado"]);
      expect(w.monto.toFixed(2)).toBe(c.monto.toFixed(2));
      expect(w.fechaMovimiento.toISOString()).toBe(c.fechaMovimiento.toISOString()); // R81: el MISMO instante
      expect(w.registradoPor).toBe(c.registradoPor);
      expect(w.descripcion).toBe(`Nuformtest Prueba · ${c.descripcion}`);
    }
    // R87 — lo que la tienda ve de esos cobros NO cambia: fila a fila.
    expect(r.tiendaDespues).toEqual(r.tiendaAntes);
    // R8 — «De las tiendas» y la cifra bajan exactamente en la suma (86 415,60 + 11 233,20 + 0,01);
    // la ganancia no se mueve; los cobros dejan de contar como «sin reclasificar».
    const d = (a: string, b: string) => new Prisma.Decimal(b).sub(a).toFixed(2);
    expect(d(r.antes.deTerceros, r.despues.deTerceros)).toBe("-97648.81");
    expect(d(r.antes.enCaja, r.despues.enCaja)).toBe("-97648.81");
    expect(d(r.antes.ganancia, r.despues.ganancia)).toBe("0.00");
    expect(d(r.antes.capital, r.despues.capital)).toBe("0.00");
  }, 120_000);

  it("R85: aplicada DOS veces deja una sola salida por cobro; R86: el down borra exactamente esas", async () => {
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      const s = await sembrar(tx);
      const ids = s.cobros.map((c) => c.id);
      // Un senuelo: una salida reclasificada de OTRO cobro que no esta en la lista. El down no la toca.
      const ajeno = await tx.walletTiendaMovimiento.create({
        data: {
          tiendaId: s.otraTiendaId,
          tipo: "debito",
          categoria: "cobro_manual",
          monto: new Prisma.Decimal("10.00"),
          origenTipo: "manual",
          descripcion: "ajeno",
          registradoPor: s.maestroId,
        },
        select: { id: true },
      });
      await tx.walletMovimiento.create({
        data: {
          tipo: "egreso",
          categoria: "egreso_pago_por_cuenta_tienda",
          monto: new Prisma.Decimal("10.00"),
          origenTipo: "cobro_manual_reclasificado",
          origenId: ajeno.id,
          descripcion: "senuelo",
        },
      });
      const e1 = await intentar(tx, upCon(s.cobros, s.control));
      const e2 = await intentar(tx, upCon(s.cobros, s.control));
      const trasDos = (await salidas(tx, ids)).length;
      const totalAntesDown = await tx.walletMovimiento.count();
      const e3 = await intentar(tx, downCon(s.cobros));
      return {
        e1,
        e2,
        e3,
        trasDos,
        trasDown: (await salidas(tx, ids)).length,
        borradas: totalAntesDown - (await tx.walletMovimiento.count()),
        senuelo: await tx.walletMovimiento.count({ where: { origenId: ajeno.id } }),
      };
    });
    expect(r).toEqual({ e1: null, e2: null, e3: null, trasDos: 3, trasDown: 0, borradas: 3, senuelo: 1 });
  }, 120_000);

  it("R82: monto distinto, tienda distinta o no-cobro -> excepcion y CERO filas escritas", async () => {
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      const s = await sembrar(tx);
      const ids = s.cobros.map((c) => c.id);
      const casos: Record<string, string | null> = {};
      // Monto: la lista dice un centimo mas en UNA fila (la suma de control acompana, para que lo
      // que salte sea la comprobacion por fila y no la de la lista).
      const otroMonto = s.cobros.map((c, i) => (i === 1 ? { ...c, monto: "11233.21" } : c));
      casos.monto = await intentar(tx, upCon(otroMonto, { ...s.control, suma: sumaDe(otroMonto) }));
      // Tienda: la constante aprobada es OTRA tienda.
      casos.tienda = await intentar(tx, upCon(s.cobros, { ...s.control, tienda: s.otraTiendaId }));
      // Categoria: un debito que no es un cobro de un costo, en la lista.
      const conAjuste = [...s.cobros.slice(0, 2), { id: s.otroDebitoId, monto: "500.00" }];
      casos.categoria = await intentar(tx, upCon(conAjuste, { ...s.control, suma: sumaDe(conAjuste) }));
      return { casos, escritas: (await salidas(tx, [...ids, s.otroDebitoId])).length };
    });
    for (const [caso, error] of Object.entries(r.casos)) {
      expect(error, caso).toMatch(/algun cobro no coincide en tipo, categoria, tienda o monto/);
    }
    expect(r.escritas).toBe(0);
  }, 120_000);

  it("R83: presentes solo ALGUNOS -> excepcion y cero filas; NINGUNO -> sin error y cero filas", async () => {
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      const s = await sembrar(tx);
      const inexistente = { id: randomUUID(), monto: "1.00" };
      const parcial = [...s.cobros, inexistente];
      const eParcial = await intentar(tx, upCon(parcial, { ...s.control, n: 4, suma: sumaDe(parcial) }));
      const nadie = [inexistente, { id: randomUUID(), monto: "2.00" }];
      const eNadie = await intentar(tx, upCon(nadie, { ...s.control, n: 2, suma: sumaDe(nadie) }));
      return { eParcial, eNadie, escritas: (await salidas(tx, [...s.cobros.map((c) => c.id), inexistente.id])).length };
    });
    expect(r.eParcial).toMatch(/existen 3 de 4 cobros aprobados/);
    expect(r.eNadie).toBeNull();
    expect(r.escritas).toBe(0);
  }, 120_000);

  it("R84: si al terminar las salidas no suman lo aprobado -> excepcion y nada escrito; la lista contra su control, tambien", async () => {
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      const s = await sembrar(tx);
      // Una salida PREVIA para el primer cobro con otro monto: el ON CONFLICT la respeta y el
      // recuento final ya no cuadra.
      await tx.walletMovimiento.create({
        data: {
          tipo: "egreso",
          categoria: "egreso_pago_por_cuenta_tienda",
          monto: new Prisma.Decimal("1.00"),
          origenTipo: "cobro_manual_reclasificado",
          origenId: s.cobros[0].id,
        },
      });
      const eRecuento = await intentar(tx, upCon(s.cobros, s.control));
      const trasRecuento = (await salidas(tx, s.cobros.map((c) => c.id))).length;
      const eControl = await intentar(tx, upCon(s.cobros, { ...s.control, suma: "1.00" }));
      return { eRecuento, trasRecuento, eControl };
    });
    expect(r.eRecuento).toMatch(/escritas 3 por .*, esperadas 3 por 97648.81/);
    expect(r.trasRecuento).toBe(1); // solo la previa: lo que la migracion escribio se revirtio
    expect(r.eControl).toMatch(/la lista tiene 3 filas por 97648.81, se esperaban 3 por 1.00/);
  }, 120_000);
});
