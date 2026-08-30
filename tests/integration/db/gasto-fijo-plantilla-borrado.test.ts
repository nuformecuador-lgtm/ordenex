import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { GastoFijoPlantillaRepository } from "@/lib/repositories/GastoFijoPlantillaRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";

/**
 * Ficha 332 (R8/R9) — BORRAR LA PLANTILLA NO TOCA EL LIBRO. Contra Postgres de verdad.
 *
 * Por que no vale un doble aqui. La premisa entera de esta ficha —y lo que hace defendible
 * revocar `45/R25`— es que `wallet_movimiento` **no tiene FK** a `gasto_fijo_plantilla` y que la
 * referencia es DERIVADA (`origen_id = '<plantillaId>:<periodo>'`, texto). Que no haya cascada es
 * un hecho del MOTOR: un doble en memoria demuestra que el codigo no escribe en el libro, no que
 * Postgres no borre por su cuenta. Esto solo lo puede decir el motor.
 *
 * Lo que se monta es exactamente lo que emite el cron (`GeneracionGastosFijosService`): egreso
 * `egreso_gasto_fijo`, `origen_tipo = 'gasto'`, `origen_id = '<id>:<periodo>'`, descripcion
 * `'<concepto> — <periodo>'` y autor NULL. Y se añade un SEGUNDO movimiento ajeno a la plantilla
 * para que «no borro de mas» se mida sobre filas de verdad y no sobre una promesa.
 *
 * Aislamiento: todo corre dentro de una transaccion que SIEMPRE se revierte. Si el test pasa, si
 * falla o si el runner muere, no queda ni una fila de dinero inventada.
 *
 * ⚠️ Sin `DATABASE_URL` este archivo se SALTA entero (no falla) — es la convencion de
 * `tests/integration/db/**`. Lo que NO hace es reportar «passed» sin haber comprobado nada: si la
 * base esta y el fixture no se puede crear, el test FALLA. Nada de `if (!x) return;`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const CONCEPTO = "Alquiler bodega (fixture 332)";
const MONTO = "10000.00";
const PERIODO = "2026-09";
const FECHA_MOVIMIENTO = new Date("2026-09-01T12:34:56.000Z");
const MONTO_AJENO = "777.00";

describeSiHayBase("ficha 332 — el libro sobrevive al borrado de la plantilla (R8/R9)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("borrada la plantilla, su egreso sigue en el libro con monto, fecha, origen_id y descripcion intactos", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const repo = new GastoFijoPlantillaRepository(tx as unknown as PrismaClient);

      // ── Fixture: la plantilla y su egreso, tal como los deja el cron ──
      const plantilla = await repo.crear({
        concepto: CONCEPTO,
        monto: MONTO,
        periodicidadUnidad: "meses",
        periodicidadCantidad: 1,
        fechaCobro: "2026-09-01",
      });

      const origenId = `${plantilla.id}:${PERIODO}`;
      const descripcion = `${CONCEPTO} — ${PERIODO}`;

      const egreso = await tx.walletMovimiento.create({
        data: {
          tipo: "egreso",
          categoria: "egreso_gasto_fijo",
          monto: new Prisma.Decimal(MONTO),
          origenTipo: "gasto",
          origenId,
          descripcion,
          fechaMovimiento: FECHA_MOVIMIENTO,
          registradoPor: null,
        },
      });

      // Un movimiento AJENO a la plantilla: si el borrado se llevara filas de mas, este es el que
      // lo delata. Con `origen_tipo = 'manual'` el `origen_id` va NULL (fuera del indice unico).
      const ajeno = await tx.walletMovimiento.create({
        data: {
          tipo: "ingreso",
          categoria: "ingreso_ajuste",
          monto: new Prisma.Decimal(MONTO_AJENO),
          origenTipo: "manual",
          origenId: null,
          descripcion: "movimiento ajeno a la plantilla (fixture 332)",
          registradoPor: null,
        },
      });

      const movimientosAntes = await tx.walletMovimiento.count();

      // ── La operacion bajo prueba ──
      const borrada = await repo.eliminar(plantilla.id);

      const movimientosDespues = await tx.walletMovimiento.count();

      return {
        plantillaId: plantilla.id,
        origenId,
        descripcion,
        borrada,
        plantillaDespues: await tx.gastoFijoPlantilla.findUnique({ where: { id: plantilla.id } }),
        egresoDespues: await tx.walletMovimiento.findUnique({ where: { id: egreso.id } }),
        ajenoDespues: await tx.walletMovimiento.findUnique({ where: { id: ajeno.id } }),
        egresoCreadoEn: egreso.createdAt,
        movimientosAntes,
        movimientosDespues,
      };
    });

    // (0) EL FIXTURE. Si no se pudo montar, esto FALLA — es lo que separa a este archivo de los
    // que reportan «passed» sin haber ejecutado nada.
    expect(r.plantillaId, "no se pudo crear la plantilla del fixture").toBeTruthy();
    expect(r.origenId).toBe(`${r.plantillaId}:${PERIODO}`);
    expect(r.movimientosAntes, "el fixture no dejo movimientos en el libro").toBeGreaterThanOrEqual(
      2,
    );

    // (1) R2: la plantilla se borro de verdad y ya no esta en la tabla.
    expect(r.borrada).toBe(true);
    expect(r.plantillaDespues).toBeNull();

    // (2) R8/R9: el egreso SIGUE en el libro, con las cuatro columnas que el requisito nombra.
    expect(r.egresoDespues, "el egreso desaparecio al borrar la plantilla").not.toBeNull();
    const egreso = r.egresoDespues!;
    expect(egreso.monto.toFixed(2)).toBe(MONTO); // money-safe: STRING, nunca number
    expect(egreso.fechaMovimiento.getTime()).toBe(FECHA_MOVIMIENTO.getTime());
    expect(egreso.origenId).toBe(r.origenId);
    expect(egreso.descripcion).toBe(r.descripcion);

    // R9: la fila se explica SOLA sin la plantilla — concepto y periodo estan en la descripcion.
    expect(egreso.descripcion).toContain(CONCEPTO);
    expect(egreso.descripcion).toContain(PERIODO);

    // Y no se «actualizo» por dentro: el libro es append-only (no tiene ni updatedAt).
    expect(egreso.createdAt.getTime()).toBe(r.egresoCreadoEn.getTime());
    expect(egreso.categoria).toBe("egreso_gasto_fijo");
    expect(egreso.tipo).toBe("egreso");

    // (3) R8: ni una fila del libro se creo o se borro como consecuencia. Postgres no tenia
    // ninguna cascada que disparar porque NO hay FK: es justo la premisa de la revocacion.
    expect(r.ajenoDespues).not.toBeNull();
    expect(r.movimientosDespues).toBe(r.movimientosAntes);
  });
});
