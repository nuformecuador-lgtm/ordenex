import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { AbonoTiendaRepository } from "@/lib/repositories/AbonoTiendaRepository";
import { EgresoCajaDocumentosRepository, IndemnizacionDocumentosRepository } from "@/lib/repositories/EgresoCajaDocumentosRepository";
import { RechazoTiendaCobroAnulacionRepository } from "@/lib/repositories/RechazoTiendaCobroAnulacionRepository";
import { AjusteCajaAnulacionRepository } from "@/lib/repositories/AjusteCajaAnulacionRepository";
import { CobroTiendaAnulacionRepository } from "@/lib/repositories/CobroTiendaAnulacionRepository";
import { PagoPorCuentaTiendaRepository } from "@/lib/repositories/PagoPorCuentaTiendaRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletService } from "@/lib/services/WalletService";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";
import { enTransaccionRevertida459 } from "./_fixtures/caja-459";
import { DOWN_COMPLETAR_461_EN_TX, UP_COMPLETAR_461 } from "./_fixtures/completar-caja-461-sql";
import { upCon as reclasificarCon } from "./_fixtures/reclasificacion-459-sql";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 461 / T B.11 — la migracion de datos que COMPLETA la linea de caja de los cobros previos,
// ejecutada de verdad contra Postgres (R31–R36; design §3.3/§14.4).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Se ejecuta el `migration.sql` REAL, sin sustituir nada (su criterio es por datos), sobre cobros
// sembrados con INSERT DIRECTO —como los que dejo el servicio de la 381, sin linea de caja—, mas uno
// RECLASIFICADO por el SQL real de la 459 y otro con su cargo PROPIO (como los escribe el servicio de
// la 461). Cada caso corre en una transaccion REPEATABLE READ que SIEMPRE se revierte; los que esperan
// una excepcion la ejecutan dentro de un SAVEPOINT y despues comprueban que no quedo NADA escrito.
//
// La base local puede traer cobros propios sin linea (el criterio es por datos): por eso todo se mide
// por DIFERENCIA y sobre los ids sembrados, nunca «las N primeras».
//
// MUTACIONES que este archivo pone en rojo (design §14.2): (8) la migracion escribe tambien para un
// reclasificado; (9) sin `ON CONFLICT`; (10) el `down` borra aunque haya reverso.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Ejecuta `sql` en un SAVEPOINT: devuelve el mensaje de la excepcion, o null si no la hubo. */
async function intentar(tx: TxDeTest, sql: string): Promise<string | null> {
  const punto = `sp461_${randomUUID().replace(/-/g, "")}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
  try {
    await tx.$executeRawUnsafe(sql);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
    return null;
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
    return error instanceof Error ? error.message : String(error);
  }
}

interface Siembra {
  tiendaId: string;
  otraTiendaId: string;
  maestroId: string;
  /** Tres cobros LEGADOS (sin linea de caja): los candidatos. */
  legados: { id: string; monto: string; fecha: string; descripcion: string }[];
  /** Un cobro RECLASIFICADO por la 459: NO es candidato (R32). */
  reclasificadoId: string;
  /** Un cobro con su cargo PROPIO (origen `cobro_tienda`): NO es candidato (R32). */
  conCargoPropioId: string;
  /** Un debito que NO es un cobro: jamas es candidato. */
  otroDebitoId: string;
}

async function sembrar(tx: TxDeTest): Promise<Siembra> {
  const tipo = await tx.tipoIdentificacion.findUniqueOrThrow({ where: { value: "cedula" }, select: { id: true } });
  const rol = async (v: string) =>
    (await tx.rol.findFirstOrThrow({ where: { value: v as never }, select: { id: true } })).id;
  const sufijo = randomUUID().slice(0, 8);
  const usuario = async (nombre: string, apellido: string | null, r: string) =>
    (
      await tx.usuario.create({
        data: {
          nombre,
          primerApellido: apellido,
          email: `${nombre.toLowerCase()}-cc461-${sufijo}@example.test`,
          telefono: "88880000",
          passwordHash: "x",
          cedula: `CC461-${nombre}-${sufijo}`,
          tipoIdentificacionId: tipo.id,
          rolId: await rol(r),
          estado: "activo",
        },
        select: { id: true },
      })
    ).id;
  const tiendaId = await usuario("Tiendacc", "Prueba", "adminTienda");
  const otraTiendaId = await usuario("Otratiendacc", null, "adminTienda");
  const maestroId = await usuario("Maestrocc", null, "maestro");

  const cobro = async (tienda: string, monto: string, instante: string, descripcion: string) =>
    tx.walletTiendaMovimiento.create({
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
      select: { id: true },
    });
  const l1 = await cobro(tiendaId, "42000.00", "2026-09-24T15:04:05.123Z", "Publicidad de la tienda");
  const l2 = await cobro(tiendaId, "0.01", "2026-09-01T06:00:00.000Z", "Un centimo");
  const l3 = await cobro(otraTiendaId, "2500.50", "2026-09-20T23:59:59.999Z", "Etiquetas");
  const legados = [
    { id: l1.id, monto: "42000.00", fecha: "2026-09-24T15:04:05.123Z", descripcion: "Publicidad de la tienda" },
    { id: l2.id, monto: "0.01", fecha: "2026-09-01T06:00:00.000Z", descripcion: "Un centimo" },
    { id: l3.id, monto: "2500.50", fecha: "2026-09-20T23:59:59.999Z", descripcion: "Etiquetas" },
  ];

  // El reclasificado: un cobro mas su salida escrita por el SQL REAL de la 459.
  const rec = await cobro(tiendaId, "86415.60", "2026-08-28T15:04:05.123Z", "Pago Facebook");
  await tx.$executeRawUnsafe(
    reclasificarCon([{ id: rec.id, monto: "86415.60" }], { n: 1, suma: "86415.60", tienda: tiendaId }),
  );
  // El cobro con cargo PROPIO: como lo escribe el servicio de la 461.
  const propio = await cobro(tiendaId, "1500.00", "2026-09-25T10:00:00.000Z", "Reposicion");
  await tx.walletMovimiento.create({
    data: {
      tipo: "ingreso",
      categoria: "ingreso_cobro_tienda",
      monto: new Prisma.Decimal("1500.00"),
      origenTipo: "cobro_tienda",
      origenId: propio.id,
      descripcion: "Tiendacc Prueba · Reposicion",
      registradoPor: maestroId,
      fechaMovimiento: new Date("2026-09-25T10:00:00.000Z"),
    },
  });
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
  return {
    tiendaId,
    otraTiendaId,
    maestroId,
    legados,
    reclasificadoId: rec.id,
    conCargoPropioId: propio.id,
    otroDebitoId: otroDebito.id,
  };
}

async function completadas(tx: TxDeTest, ids: string[]) {
  return tx.walletMovimiento.findMany({
    where: { origenTipo: "cobro_tienda_completado", origenId: { in: ids } },
    orderBy: { monto: "desc" },
  });
}

/** La caja por `WalletService` (la lectura REAL de la tarjeta), en la tx del test. */
function walletDe(tx: TxDeTest) {
  return new WalletService(new WalletMovimientoRepository(tx as never), tx as never, new AporteCapitalRepository(tx as never), {
    pagosPorCuenta: new PagoPorCuentaTiendaRepository(tx as never),
    aportes: new AporteCapitalRepository(tx as never),
    cobros: new CobroTiendaAnulacionRepository(tx as never),
    ajustes: new AjusteCajaAnulacionRepository(tx as never),
    abonos: new AbonoTiendaRepository(tx as never), // ficha 457: lo exige `LectoresDocumentosCaja`
    // Ficha 458-B: lo exige `LectoresDocumentosCaja`.
    egresos: new EgresoCajaDocumentosRepository(tx as never),
    indemnizaciones: new IndemnizacionDocumentosRepository(tx as never),
    rechazos: new RechazoTiendaCobroAnulacionRepository(tx as never),
  });
}

const d = (a: string, b: string) => new Prisma.Decimal(b).sub(a).toFixed(2);

describeSiHayBase("461/B.11 — la migracion que completa la caja de los cobros previos, contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("el SQL que se ejecuta es el REAL, con su criterio por datos, su `ON CONFLICT` y su control final", () => {
    // Anti-vacuidad del fixture: lo que se prueba abajo es este texto, no una copia.
    expect(UP_COMPLETAR_461).toContain("'cobro_manual_reclasificado'");
    expect(UP_COMPLETAR_461).toContain("'ingreso_cobro_tienda'");
    expect(UP_COMPLETAR_461).toContain("'cobro_tienda_completado'");
    expect(UP_COMPLETAR_461).toMatch(/ON CONFLICT \("origen_tipo", "origen_id", "categoria"\) WHERE "origen_id" IS NOT NULL DO NOTHING/);
    expect(UP_COMPLETAR_461).toMatch(/n_escritas <> n_candidatos OR suma_escrita <> suma_candidatos/);
    expect(UP_COMPLETAR_461).not.toMatch(/LISTA-INICIO/); // sin lista: el criterio es por datos
    expect(DOWN_COMPLETAR_461_EN_TX).toMatch(/DELETE FROM wallet_movimiento/);
    expect(DOWN_COMPLETAR_461_EN_TX).toMatch(/egreso_reverso_cobro_tienda/);
  });

  it("R31/R32/R33: una linea por cobro legado —mismo monto, MISMO instante, misma persona, con la tienda—; ni para el reclasificado ni para el que ya tiene cargo; y dos pasadas dejan una", async () => {
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      const s = await sembrar(tx);
      const idsLegados = s.legados.map((c) => c.id);
      const cajaAntes = await tx.walletMovimiento.count();
      const tiendaAntes = await tx.walletTiendaMovimiento.findMany({ where: { tiendaId: { in: [s.tiendaId, s.otraTiendaId] } }, orderBy: { id: "asc" } });
      const e1 = await intentar(tx, UP_COMPLETAR_461);
      const trasUna = await tx.walletMovimiento.count();
      const e2 = await intentar(tx, UP_COMPLETAR_461);
      return {
        s,
        e1,
        e2,
        escritas: await completadas(tx, idsLegados),
        cobrosEnBase: await tx.walletTiendaMovimiento.findMany({ where: { id: { in: idsLegados } } }),
        tiendas: await tx.usuario.findMany({ where: { id: { in: [s.tiendaId, s.otraTiendaId] } }, select: { id: true, nombre: true, primerApellido: true } }),
        delReclasificado: await tx.walletMovimiento.findMany({ where: { origenId: s.reclasificadoId } }),
        delPropio: await tx.walletMovimiento.findMany({ where: { origenId: s.conCargoPropioId } }),
        delOtroDebito: await tx.walletMovimiento.count({ where: { origenId: s.otroDebitoId } }),
        nuevasTrasUna: trasUna - cajaAntes,
        nuevasTrasDos: (await tx.walletMovimiento.count()) - cajaAntes,
        tiendaAntes,
        tiendaDespues: await tx.walletTiendaMovimiento.findMany({ where: { tiendaId: { in: [s.tiendaId, s.otraTiendaId] } }, orderBy: { id: "asc" } }),
      };
    });
    expect(r.e1).toBeNull();
    expect(r.e2).toBeNull();
    // R31: los TRES legados, y cada linea copia el cobro al microsegundo.
    expect(r.escritas).toHaveLength(3);
    const porCobro = new Map(r.cobrosEnBase.map((c) => [c.id, c]));
    const nombreDe = new Map(r.tiendas.map((t) => [t.id, [t.nombre, t.primerApellido].filter(Boolean).join(" ")]));
    for (const w of r.escritas) {
      const c = porCobro.get(w.origenId as string)!;
      expect([w.tipo, w.categoria, w.origenTipo]).toEqual(["ingreso", "ingreso_cobro_tienda", "cobro_tienda_completado"]);
      expect(w.monto.toFixed(2)).toBe(c.monto.toFixed(2));
      expect(w.fechaMovimiento.toISOString()).toBe(c.fechaMovimiento.toISOString()); // R31: el MISMO instante
      expect(w.registradoPor).toBe(c.registradoPor); // la persona que registro el cobro
      expect(w.descripcion).toBe(`${nombreDe.get(c.tiendaId)} · ${c.descripcion}`); // «{Tienda} · {descripcion}»
      expect(w.descripcion).not.toContain(c.id);
    }
    // R32: el reclasificado sigue con SU salida y nada mas; el propio, con SU cargo y nada mas.
    expect(r.delReclasificado.map((m) => [m.categoria, m.origenTipo])).toEqual([["egreso_pago_por_cuenta_tienda", "cobro_manual_reclasificado"]]);
    expect(r.delPropio.map((m) => [m.categoria, m.origenTipo])).toEqual([["ingreso_cobro_tienda", "cobro_tienda"]]);
    expect(r.delOtroDebito).toBe(0);
    // R31: ni una fila del libro de las tiendas cambia.
    expect(r.tiendaDespues).toEqual(r.tiendaAntes);
    // R33: la segunda pasada no escribe nada. (Por diferencia: la base puede traer candidatos propios,
    // asi que se afirma que la segunda pasada deja la caja EXACTAMENTE igual que la primera.)
    expect(r.nuevasTrasDos).toBe(r.nuevasTrasUna);
    expect(r.nuevasTrasUna).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it("R25/R8 con la caja REAL: antes, «De las tiendas» − Σ saldos = Σ legados (la excepcion de la 459); despues, 0,00 y la ganancia sube la suma", async () => {
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      const s = await sembrar(tx);
      const wallet = walletDe(tx);
      const actor = { usuarioId: s.maestroId, rol: "maestro" as const };
      const leer = async () => {
        const x = await wallet.verResumenCaja({ page: 1, pageSize: 1 }, actor);
        if (x.status !== "ok") throw new Error("resumen");
        return x.resumen;
      };
      const saldos = async () => {
        const filas = await tx.walletTiendaMovimiento.findMany({ where: { tiendaId: { in: [s.tiendaId, s.otraTiendaId] } } });
        return filas.reduce((acc, f) => (f.tipo === "credito" ? acc.add(f.monto) : acc.sub(f.monto)), new Prisma.Decimal(0)).toFixed(2);
      };
      // La caja ANTES de sembrar no se puede leer aqui (la siembra ya paso), asi que se mide el
      // efecto de la MIGRACION por diferencia: antes y despues de correrla.
      const antes = await leer();
      const saldosAntes = await saldos();
      const error = await intentar(tx, UP_COMPLETAR_461);
      const despues = await leer();
      return { error, antes, despues, saldosAntes, saldosDespues: await saldos() };
    });
    expect(r.error).toBeNull();
    // Σ legados = 42 000,00 + 0,01 + 2 500,50 = 44 500,51. (Los candidatos ajenos que traiga la base
    // tambien entran en la diferencia, por eso se afirma «al menos» y el reparto exacto por cubeta.)
    const suma = new Prisma.Decimal(d(r.antes.ganancia, r.despues.ganancia));
    expect(suma.gte("44500.51")).toBe(true);
    // Ganancia +Σ, «De las tiendas» −Σ, cifra principal, «Entro» y «Salio» SIN cambio (R38, §2.4).
    expect(d(r.antes.deTerceros, r.despues.deTerceros)).toBe(suma.neg().toFixed(2));
    expect(d(r.antes.enCaja, r.despues.enCaja)).toBe("0.00");
    expect(d(r.antes.entradas, r.despues.entradas)).toBe("0.00");
    expect(d(r.antes.salidas, r.despues.salidas)).toBe("0.00");
    expect(d(r.antes.capital, r.despues.capital)).toBe("0.00");
    // Y el libro de las tiendas no se movio.
    expect(r.saldosDespues).toBe(r.saldosAntes);
  }, 120_000);

  it("R35: sin ningun candidato, termina sin escribir nada y lo dice (NOTICE, no error)", async () => {
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      // Primera pasada: completa lo que haya (los candidatos propios de la base, si los hay).
      const e1 = await intentar(tx, UP_COMPLETAR_461);
      const cajaAntes = await tx.walletMovimiento.count();
      // Segunda pasada: ya no queda ningun candidato.
      const e2 = await intentar(tx, UP_COMPLETAR_461);
      return { e1, e2, nuevas: (await tx.walletMovimiento.count()) - cajaAntes };
    });
    expect(r.e1).toBeNull();
    expect(r.e2).toBeNull();
    expect(r.nuevas).toBe(0);
  }, 120_000);

  it("R34: si el recuento final no cuadra con los candidatos, falla y no deja NADA escrito", async () => {
    // Una linea PREVIA para un legado con OTRO monto, con el origen de la migracion: el candidato sigue
    // siendolo (su linea no es `ingreso_cobro_tienda`? — si lo es: entonces NO es candidato). Se usa
    // otra categoria para que siga siendo candidato y el `ON CONFLICT` no aplique… no: la clave del
    // indice es (origen, id, categoria). Con la MISMA categoria y el MISMO origen, la fila previa se
    // respeta por `ON CONFLICT`, el cobro ya no es candidato (tiene linea) y el recuento cuadra. Por
    // eso el recuento se hace fallar de la unica forma posible: un candidato cuya linea se escribe
    // con un monto distinto porque alguien la puso antes con el ORIGEN de la migracion pero con la
    // categoria del cobro... que lo saca de candidato. Conclusion medida: con el criterio por datos
    // «tiene linea» y la clave del indice, R34 no puede dispararse por una fila previa. Se dispara
    // SOLO si el INSERT escribe menos de lo que cuenta: se simula quitando la unicidad? No se puede
    // sin tocar el esquema. Lo que SI se puede afirmar es la otra mitad del control: la migracion
    // falla si un candidato NO se puede escribir (FK de la tienda rota) y no deja nada.
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      const s = await sembrar(tx);
      // Un cobro legado cuya tienda NO existe en `usuario`: el JOIN lo deja fuera del INSERT pero
      // sigue siendo candidato → n_escritas < n_candidatos → EXCEPTION.
      await tx.$executeRawUnsafe(`ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tienda_id_fkey"`);
      await tx.walletTiendaMovimiento.create({
        data: {
          tiendaId: randomUUID(),
          tipo: "debito",
          categoria: "cobro_manual",
          monto: new Prisma.Decimal("7.00"),
          origenTipo: "manual",
          descripcion: "tienda fantasma",
          registradoPor: s.maestroId,
        },
      });
      const cajaAntes = await tx.walletMovimiento.count();
      const error = await intentar(tx, UP_COMPLETAR_461);
      return { error, nuevas: (await tx.walletMovimiento.count()) - cajaAntes, legadas: (await completadas(tx, s.legados.map((c) => c.id))).length };
    });
    expect(r.error).toMatch(/completar caja 461: escritas \d+ por [\d.]+, candidatos \d+ por [\d.]+/);
    // Nada escrito: ni siquiera las tres legadas sanas (todo o nada).
    expect(r.nuevas).toBe(0);
    expect(r.legadas).toBe(0);
  }, 120_000);

  it("R36: el `down` borra EXACTAMENTE las lineas completadas y ninguna otra; con un reverso de anulacion, ABORTA sin borrar", async () => {
    const r = await enTransaccionRevertida459(prisma, async (tx) => {
      const s = await sembrar(tx);
      const ids = s.legados.map((c) => c.id);
      const e1 = await intentar(tx, UP_COMPLETAR_461);
      const totalAntesDown = await tx.walletMovimiento.count();
      const completadasAntes = await tx.walletMovimiento.count({ where: { origenTipo: "cobro_tienda_completado" } });
      // Un reverso de anulacion de UNA completada (como lo escribe `CobroTiendaService.anular`).
      await tx.walletMovimiento.create({
        data: {
          tipo: "egreso",
          categoria: "egreso_reverso_cobro_tienda",
          monto: new Prisma.Decimal(s.legados[0].monto),
          origenTipo: "cobro_tienda",
          origenId: s.legados[0].id,
          descripcion: "Anulación · prueba",
          registradoPor: s.maestroId,
        },
      });
      // Mutacion 10 de design §14.2 (el `down` borra aunque haya reverso) → este `e2` seria null.
      const e2 = await intentar(tx, DOWN_COMPLETAR_461_EN_TX);
      const trasAbortar = await tx.walletMovimiento.count({ where: { origenTipo: "cobro_tienda_completado" } });
      // Sin el reverso: el `down` borra las completadas —TODAS las de la base, que son las suyas— y
      // no toca el cargo propio, la salida reclasificada ni el resto de la caja.
      await tx.walletMovimiento.deleteMany({ where: { categoria: "egreso_reverso_cobro_tienda", origenId: s.legados[0].id } });
      const e3 = await intentar(tx, DOWN_COMPLETAR_461_EN_TX);
      return {
        e1,
        e2,
        e3,
        completadasAntes,
        trasAbortar,
        trasDown: (await completadas(tx, ids)).length,
        completadasTrasDown: await tx.walletMovimiento.count({ where: { origenTipo: "cobro_tienda_completado" } }),
        borradas: totalAntesDown - (await tx.walletMovimiento.count()),
        propioSigue: await tx.walletMovimiento.count({ where: { origenId: s.conCargoPropioId } }),
        reclasificadoSigue: await tx.walletMovimiento.count({ where: { origenId: s.reclasificadoId } }),
      };
    });
    expect(r.e1).toBeNull();
    expect(r.e2).toMatch(/rollback 461: 1 lineas completadas ya tienen su reverso de anulacion; se aborta sin borrar nada/);
    expect(r.trasAbortar).toBe(r.completadasAntes);
    expect(r.e3).toBeNull();
    expect(r.trasDown).toBe(0);
    expect(r.completadasTrasDown).toBe(0);
    expect(r.borradas).toBe(r.completadasAntes);
    expect(r.propioSigue).toBe(1);
    expect(r.reclasificadoSigue).toBe(1);
  }, 120_000);
});
