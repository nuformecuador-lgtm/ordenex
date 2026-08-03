import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { CajaBackfillClient } from "@/lib/interfaces/services/ICajaBackfillTesoreriaService";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CajaBackfillTesoreriaService } from "@/lib/services/CajaBackfillTesoreriaService";
import { CajaCodFeedService } from "@/lib/services/CajaCodFeedService";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";

/**
 * Feature 173 / T E.3 (R39, y de paso R36/R37/R38/R41/R42 contra el motor) — la idempotencia
 * del registro RETROACTIVO, contra **Postgres de verdad**.
 *
 * Por que no vale un doble aqui. Esta task promete tres cosas que solo el motor puede
 * demostrar:
 *
 *  1. Que la barrera contra el duplicado es el **indice unico parcial**
 *     `(origen_tipo, origen_id, categoria)` y no el filtro del servicio. El filtro se puede
 *     equivocar; el indice no.
 *  2. Que las filas que el backfill propone **pasan el `CHECK` categoria↔tipo** de `T A.2`. Una
 *     fila con la categoria y el tipo cruzados seria rechazada con `23514`, y en un doble en
 *     memoria eso no se ve.
 *  3. Que ejecutar el backfill sobre datos que **ya pasaron por el camino vivo** no duplica —
 *     que es el caso que de verdad importa, porque es el que se va a dar en produccion: la
 *     feature se despliega, empieza a escribir sola, y el backfill se corre despues.
 *
 * Aislamiento: todo corre dentro de una transaccion que SIEMPRE se revierte (patron de la 169).
 * Si el test pasa, si falla o si el runner muere, no queda ni una fila de dinero inventada.
 * Sin base alcanzable, la suite se SALTA (no falla).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** El reloj del backfill: **Navidad**, y ningun dato sembrado cae ese dia (R41). */
const RELOJ = new Date("2026-12-25T18:30:00.000Z");

const RESUELTO_DEL_CIERRE = new Date("2026-06-10T11:22:33.000Z");
const FECHA_DEL_PAGO = new Date("2026-07-30T00:00:00.000Z");

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function backfillReal(tx: Tx) {
  return new CajaBackfillTesoreriaService({
    cliente: tx as unknown as CajaBackfillClient,
    // Los emisores REALES: las filas que aqui llegan a Postgres son las del camino vivo.
    codFeed: new CajaCodFeedService(),
    crearPuertoDePago: (repo) => new CajaPagoTiendaFeedService(repo),
    cajaRepo: new WalletMovimientoRepository(tx as unknown as PrismaClient),
    ahora: () => RELOJ,
  });
}

interface Semilla {
  cierreId: string;
  pagoId: string;
  tiendaA: string;
  tiendaB: string;
}

/**
 * Un cierre aprobado con contra-entrega de DOS tiendas (mas un debito y un ajuste, para que el
 * WHERE del feed tenga algo que descartar) y un pago a tienda con su anulacion.
 *
 * Devuelve `null` si la base de desarrollo no tiene los actores minimos: la suite no siembra
 * usuarios ni zonas, porque eso si dejaria rastro fuera de la transaccion en caso de fallo raro.
 */
async function sembrar(tx: Tx): Promise<Semilla | null> {
  const usuarios = await tx.usuario.findMany({ take: 2, select: { id: true } });
  const zona = await tx.zona.findFirst({ select: { id: true } });
  if (usuarios.length < 2 || zona === null) return null;
  const [tiendaA, tiendaB] = [usuarios[0].id, usuarios[1].id];

  const cierre = await tx.cierreDia.create({
    data: {
      mensajeroId: tiendaA,
      estado: "aprobado",
      destinoTipo: "bodega_central",
      destinoZonaId: zona.id,
      resueltoPor: tiendaB,
      resueltoAt: RESUELTO_DEL_CIERRE,
    },
    select: { id: true },
  });

  await tx.walletTiendaMovimiento.createMany({
    data: [
      { tiendaId: tiendaA, tipo: "credito", categoria: "cod_recaudado", monto: new Prisma.Decimal("12500.75"), origenTipo: "cierre_dia", origenId: cierre.id },
      { tiendaId: tiendaB, tipo: "credito", categoria: "cod_recaudado", monto: new Prisma.Decimal("300.25"), origenTipo: "cierre_dia", origenId: cierre.id },
      { tiendaId: tiendaA, tipo: "debito", categoria: "flete", monto: new Prisma.Decimal("1000.00"), origenTipo: "cierre_dia", origenId: cierre.id },
      { tiendaId: tiendaA, tipo: "credito", categoria: "ajuste_credito", monto: new Prisma.Decimal("999.00"), origenTipo: "cierre_dia", origenId: cierre.id },
    ],
  });

  const pago = await tx.liquidacionPago.create({
    data: {
      claveIdempotencia: randomUUID(),
      tiendaId: tiendaA,
      monto: new Prisma.Decimal("15000.50"),
      metodo: "SINPE",
      referencia: "1234567",
      fechaPago: FECHA_DEL_PAGO,
      registradoPor: tiendaB,
    },
    select: { id: true },
  });

  await tx.liquidacionAnulacion.create({
    data: { pagoId: pago.id, motivo: "prueba de registro retroactivo", anuladoPor: tiendaB },
  });

  return { cierreId: cierre.id, pagoId: pago.id, tiendaA, tiendaB };
}

/** Las filas de la caja de un origen concreto, ya legibles. */
async function filasDeCaja(tx: Tx, origenId: string) {
  const filas = await tx.walletMovimiento.findMany({
    where: { origenId },
    orderBy: { categoria: "asc" },
    select: { tipo: true, categoria: true, monto: true, origenTipo: true, fechaMovimiento: true },
  });
  return filas.map((f) => ({
    tipo: f.tipo,
    categoria: f.categoria,
    monto: f.monto.toFixed(2),
    origenTipo: f.origenTipo,
    fecha: f.fechaMovimiento.toISOString(),
  }));
}

describeSiHayBase("173/T E.3 — el registro retroactivo contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R39: dos ejecuciones seguidas — la SEGUNDA inserta 0 y ningun importe cambia", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      if (semilla === null) return null;
      const backfill = backfillReal(tx);

      const antesDeAplicar = await backfill.ejecutar("simular");
      const primera = await backfill.ejecutar("aplicar");
      const trasLaPrimera = [
        ...(await filasDeCaja(tx, semilla.cierreId)),
        ...(await filasDeCaja(tx, semilla.pagoId)),
      ];

      const segunda = await backfill.ejecutar("aplicar");
      const trasLaSegunda = [
        ...(await filasDeCaja(tx, semilla.cierreId)),
        ...(await filasDeCaja(tx, semilla.pagoId)),
      ];

      const comprobacion = await backfill.ejecutar("comprobar");
      return { antesDeAplicar, primera, segunda, trasLaPrimera, trasLaSegunda, comprobacion, semilla };
    });

    if (resultado === null) return; // base sin usuarios o sin zonas: nada que probar
    const { antesDeAplicar, primera, segunda, trasLaPrimera, trasLaSegunda, comprobacion, semilla } =
      resultado;

    // La semilla SI llego a la base y SI se vio: las tres filas de esta prueba estan en el plan.
    // Sin esta afirmacion, una base sin actores dejaria toda la suite pasando en vacio.
    const documentos = [semilla.cierreId, semilla.pagoId];
    expect(
      antesDeAplicar.pendientes.filter((p) => documentos.includes(p.documentoId)),
    ).toHaveLength(3);

    // La primera escribio al menos esas tres (la base de desarrollo puede tener historia propia,
    // asi que se afirma «al menos», no un numero exacto).
    expect(primera.insertadas).toBeGreaterThanOrEqual(3);
    expect(primera.insertadas).toBe(primera.pendientes.length);

    // R39: la segunda pasada es un NO-OP. Cero filas, sin error.
    expect(segunda.pendientes).toEqual([]);
    expect(segunda.insertadas).toBe(0);

    // Y NINGUN importe cambio: las filas son, campo por campo, las mismas.
    expect(trasLaSegunda).toEqual(trasLaPrimera);

    // Tras aplicar, la comprobacion dice que el entorno esta al dia (R44 por el otro lado).
    expect(comprobacion.alDia).toBe(true);
    expect(comprobacion.insertadas).toBe(0);
  });

  it("las TRES filas llegan a la tabla con su categoria, su monto y la fecha de su ORIGEN", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      if (semilla === null) return null;
      await backfillReal(tx).ejecutar("aplicar");
      return {
        delCierre: await filasDeCaja(tx, semilla.cierreId),
        delPago: await filasDeCaja(tx, semilla.pagoId),
      };
    });

    if (resultado === null) return;

    // Contra-entrega: 12500.75 + 300.25 = 12801.00. Ni el debito de flete ni el ajuste entran.
    // Fecha: el cierre no tenia movimientos de caja, asi que manda su `resuelto_at` (§6.2).
    expect(resultado.delCierre).toEqual([
      {
        tipo: "ingreso",
        categoria: "ingreso_cod_recaudado",
        monto: "12801.00",
        origenTipo: "cierre_dia",
        fecha: RESUELTO_DEL_CIERRE.toISOString(),
      },
    ]);

    // El pago y su anulacion COMPARTEN `(origen_tipo, origen_id)` y caben los dos: el indice
    // unico es parcial y lleva la categoria dentro.
    expect(resultado.delPago).toEqual([
      {
        tipo: "egreso",
        categoria: "egreso_pago_tienda",
        monto: "15000.50",
        origenTipo: "pago_tienda",
        fecha: FECHA_DEL_PAGO.toISOString(),
      },
      {
        tipo: "ingreso",
        categoria: "ingreso_reverso_pago_tienda",
        monto: "15000.50",
        origenTipo: "pago_tienda",
        // El dia CALENDARIO de CR de la anulacion, que se acaba de crear: lo unico que se puede
        // afirmar sin fijar el reloj del servidor es que NO es el reloj del backfill.
        fecha: expect.not.stringMatching(RELOJ.toISOString()) as unknown as string,
      },
    ]);

    // Neto sobre la caja de ese pago: cero. Sale y vuelve.
    const neto = resultado.delPago.reduce(
      (acc, f) => (f.tipo === "ingreso" ? acc.plus(f.monto) : acc.minus(f.monto)),
      new Prisma.Decimal(0),
    );
    expect(neto.toFixed(2)).toBe("0.00");
  });

  it("R39 (el caso que importa): sobre datos que YA pasaron por el camino vivo, no duplica", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      if (semilla === null) return null;

      // ── El CAMINO VIVO, tal cual corre en produccion ──
      const repo = new WalletMovimientoRepository(tx as unknown as PrismaClient);
      // Tanda B: la aprobacion del cierre mete el contra-entrega.
      const delCierre = await new CajaCodFeedService().construirIngresoCod(semilla.cierreId, tx);
      const insertadasVivo = await repo.crearMovimientos(tx, delCierre);
      // Tanda C: el pago sale de la caja y la anulacion lo devuelve.
      const puerto = new CajaPagoTiendaFeedService(repo);
      await puerto.emitirEgresoDePago(tx, {
        pagoId: semilla.pagoId,
        monto: "15000.50",
        descripcion: "SINPE · 1234567",
        registradoPor: semilla.tiendaB,
        fechaMovimiento: FECHA_DEL_PAGO,
      });
      await puerto.emitirReversoDeAnulacion(tx, {
        pagoId: semilla.pagoId,
        monto: "15000.50",
        descripcion: "Anulación de pago · SINPE · 1234567",
        registradoPor: semilla.tiendaB,
        fechaMovimiento: new Date("2026-08-05T00:00:00.000Z"),
      });
      const antes = [
        ...(await filasDeCaja(tx, semilla.cierreId)),
        ...(await filasDeCaja(tx, semilla.pagoId)),
      ];

      // ── Y AHORA el backfill, encima ──
      const backfill = backfillReal(tx);
      const simulado = await backfill.ejecutar("simular");
      const aplicado = await backfill.ejecutar("aplicar");
      const despues = [
        ...(await filasDeCaja(tx, semilla.cierreId)),
        ...(await filasDeCaja(tx, semilla.pagoId)),
      ];

      return { insertadasVivo, antes, simulado, aplicado, despues, semilla };
    });

    if (resultado === null) return;
    const { insertadasVivo, antes, simulado, aplicado, despues, semilla } = resultado;

    expect(insertadasVivo).toBe(1); // el camino vivo escribio el contra-entrega
    expect(antes).toHaveLength(3); // 1 del cierre + 2 del pago

    // Ni la simulacion los propone ni la aplicacion los escribe.
    const documentos = [semilla.cierreId, semilla.pagoId];
    expect(simulado.pendientes.filter((p) => documentos.includes(p.documentoId))).toEqual([]);
    expect(aplicado.pendientes.filter((p) => documentos.includes(p.documentoId))).toEqual([]);

    // Y la tabla queda EXACTAMENTE como la dejo el camino vivo: mismas filas, mismos importes,
    // mismas fechas. Nada duplicado, nada movido.
    expect(despues).toEqual(antes);
    expect(despues).toHaveLength(3);
  });

  it("R42: `simular` y `comprobar` no dejan NI UNA fila nueva en la caja", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      if (semilla === null) return null;
      const backfill = backfillReal(tx);

      const antes = await tx.walletMovimiento.count();
      const simulado = await backfill.ejecutar("simular");
      const comprobado = await backfill.ejecutar("comprobar");
      const despues = await tx.walletMovimiento.count();

      return { antes, despues, simulado, comprobado, semilla };
    });

    if (resultado === null) return;
    const { antes, despues, simulado, comprobado, semilla } = resultado;

    expect(despues).toBe(antes); // ni una fila, en ninguno de los dos modos
    expect(simulado.insertadas).toBe(0);
    expect(comprobado.insertadas).toBe(0);
    // Y los dos VIERON lo que falta: la comprobacion nombra los documentos de la semilla.
    for (const informe of [simulado, comprobado]) {
      expect(informe.alDia).toBe(false);
      const documentos = informe.pendientes.map((p) => p.documentoId);
      expect(documentos).toContain(semilla.cierreId);
      expect(documentos.filter((d) => d === semilla.pagoId)).toHaveLength(2);
    }
  });

  it("el `CHECK` de `T A.2` acepta las tres filas: ninguna cruza categoria y tipo", async () => {
    // Si el backfill emitiera una fila incoherente —un `ingreso` con categoria `egreso_*`— la
    // base la rechazaria con 23514 y el `aplicar` de arriba habria reventado. Aqui se comprueba
    // de frente que lo insertado casa con la disyuncion del CHECK.
    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      if (semilla === null) return null;
      await backfillReal(tx).ejecutar("aplicar");
      return [
        ...(await filasDeCaja(tx, semilla.cierreId)),
        ...(await filasDeCaja(tx, semilla.pagoId)),
      ];
    });

    if (filas === null) return;
    expect(filas).toHaveLength(3);
    for (const fila of filas) {
      expect(fila.categoria.startsWith(fila.tipo), `${fila.tipo}/${fila.categoria}`).toBe(true);
    }
  });
});
