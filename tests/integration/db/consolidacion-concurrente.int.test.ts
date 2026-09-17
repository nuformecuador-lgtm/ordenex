import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierreBodegaRepository } from "@/lib/repositories/CierreBodegaRepository";
import { ConsolidacionParcialError } from "@/lib/utils/consolidacion-parcial";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 / T14 (R6/R7) — LA SATELITE CONSOLIDA SIN ESPERAR, Y LA CARRERA NO PARTE LA COLA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LAS DOS MITADES QUE ESTE ARCHIVO MIDE, y son inseparables:
//
//   (A) R6 — CON UNA CONSOLIDACION PENDIENTE DE CONCILIAR, SE PUEDE CREAR OTRA. Es el corazon de
//       la ficha. Hasta hoy lo impedia el indice unico parcial `cierre_bodega_zona_solicitado_uq`
//       (`UNIQUE (zona_id) WHERE estado='solicitado'`), que la migracion
//       `20260919120100_cierre_bodega_conciliacion` BORRA. Si alguien lo recreara, ESTE caso se
//       pone rojo con un `P2002` — que es exactamente lo que tiene que pasar, porque la ficha
//       quedaria sin resolver nada: la satelite podria asignar pero no volver a consolidar.
//
//   (B) R7 — Y LO QUE ESE INDICE PROTEGIA DE VERDAD SIGUE PROTEGIDO, en otro sitio. Dos
//       consolidaciones simultaneas NO pueden repartirse el mismo conjunto de `cierre_dia`: la
//       segunda vincula menos filas de las que pidio, lanza `ConsolidacionParcialError` y su
//       transaccion se deshace ENTERA. No queda ni la cabecera ni los enlaces.
//
//       ⚠️ POR QUE ESO IMPORTA Y NO ES UNA PRECAUCION GENERICA: los totales snapshot
//       (`total_general`, `total_pago_mensajero`, `total_ingreso_bodega_rechazos`) se calculan
//       sobre el conjunto ENTERO ANTES de escribir. Una consolidacion que enlace menos cierres de
//       los que sumo **declara mas dinero del que lleva**. Es un descuadre silencioso en un bulto
//       de efectivo.
//
// ⚠️ POR QUE CONTRA POSTGRES Y NO CON DOBLES. (A) es la AUSENCIA de un indice: un doble no tiene
// indices, asi que con dobles pasaria en verde igual con el indice puesto. Y (B) es una carrera
// real entre dos transacciones; el `updateMany` de la primera es lo que deja a la segunda sin
// filas, y eso solo lo hace la base.
//
// ⚠️ NADA DE `if (!fks) return;`: siembra sus propias filas y falla ruidosamente si no puede.
// Sin base alcanzable se SALTA, y en ese caso el verde de esta task NO cuenta.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const SUFIJO = `431-cc-${Date.now().toString(36)}`;

const TOTALES_CERO = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
} as const;

describeSiHayBase("431/T14 — consolidar sin esperar, y la carrera (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function sembrarZona(tx: TxDeTest, marca: string): Promise<string> {
    const fila = await tx.zona.create({
      data: {
        nombre: `Zona ${SUFIJO}-${marca}`,
        sinpeNumero: "80000000",
        sinpeNombre: "Titular de Prueba",
        cobroVehiculo: false,
        esCentral: false,
      },
      select: { id: true },
    });
    return fila.id;
  }

  async function algunUsuarioId(tx: TxDeTest): Promise<string> {
    const fila = await tx.usuario.findFirst({ select: { id: true } });
    if (!fila) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `usuario` esta vacia: sin FK no se puede sembrar un " +
          "cierre_dia. Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    return fila.id;
  }

  /** Un `cierre_dia` CONSOLIDABLE: aprobado, con destino a esta bodega y sin consolidar. */
  async function sembrarConsolidable(
    tx: TxDeTest,
    zonaId: string,
    mensajeroId: string,
    total: string,
  ): Promise<string> {
    const fila = await tx.cierreDia.create({
      data: {
        mensajeroId,
        estado: "aprobado",
        destinoTipo: "bodega_satelite",
        destinoZonaId: zonaId,
        totalEfectivo: new Prisma.Decimal(total),
        totalGeneral: new Prisma.Decimal(total),
      },
      select: { id: true },
    });
    return fila.id;
  }

  // -------------------------------------------------------------------------------------------
  // (A) R6 — se puede consolidar otra vez sin que nadie marque la anterior.
  // -------------------------------------------------------------------------------------------

  it("⭑ R6: DOS consolidaciones `solicitado` en la MISMA zona conviven (el indice unico se fue)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "dos");
      const repo = new CierreBodegaRepository(tx as unknown as PrismaClient);

      const cd1 = await sembrarConsolidable(tx, zonaId, usuarioId, "100.00");
      const primera = await repo.crearCierreBodega({
        zonaId,
        solicitadoPor: usuarioId,
        cierreDiaIds: [cd1],
        totales: { ...TOTALES_CERO, efectivo: "100.00", general: "100.00" },
        totalPagoMensajero: "0.00",
        totalIngresoBodegaRechazos: "0.00",
      });

      // Nadie la marca. La bodega sigue trabajando y vuelve a consolidar.
      const cd2 = await sembrarConsolidable(tx, zonaId, usuarioId, "200.00");
      const segunda = await repo.crearCierreBodega({
        zonaId,
        solicitadoPor: usuarioId,
        cierreDiaIds: [cd2],
        totales: { ...TOTALES_CERO, efectivo: "200.00", general: "200.00" },
        totalPagoMensajero: "0.00",
        totalIngresoBodegaRechazos: "0.00",
      });

      const solicitadas = await tx.cierreBodega.count({
        where: { zonaId, estado: "solicitado" },
      });
      return { primera, segunda, solicitadas };
    });

    expect(r.primera).not.toBe(r.segunda);
    // ⭑ DOS. Con `cierre_bodega_zona_solicitado_uq` vivo, la segunda llamada habria muerto con un
    // `P2002` y este caso no llegaria aqui.
    expect(r.solicitadas).toBe(2);
  });

  it("⭑ R6: y una TERCERA tambien — no hay tope escondido en ningun sitio", async () => {
    const solicitadas = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "tres");
      const repo = new CierreBodegaRepository(tx as unknown as PrismaClient);

      for (const total of ["10.00", "20.00", "30.00"]) {
        const cd = await sembrarConsolidable(tx, zonaId, usuarioId, total);
        await repo.crearCierreBodega({
          zonaId,
          solicitadoPor: usuarioId,
          cierreDiaIds: [cd],
          totales: { ...TOTALES_CERO, efectivo: total, general: total },
          totalPagoMensajero: "0.00",
          totalIngresoBodegaRechazos: "0.00",
        });
      }
      return tx.cierreBodega.count({ where: { zonaId, estado: "solicitado" } });
    });

    expect(solicitadas).toBe(3);
  });

  // -------------------------------------------------------------------------------------------
  // (B) R7 — el todo-o-nada: la carrera no parte la cola.
  // -------------------------------------------------------------------------------------------

  it("⭑ R7: la segunda consolidacion sobre la MISMA cola LANZA y NO deja fila", async () => {
    // La carrera, reproducida de forma determinista: la primera consolidacion ya se llevo los tres
    // `cierre_dia`, y la segunda los pide igual —es lo que le paso a la que perdio la carrera, que
    // leyo la cola antes—. El `updateMany` vincula CERO de tres y el todo-o-nada muerde.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "carrera");
      const repo = new CierreBodegaRepository(tx as unknown as PrismaClient);

      const ids = [
        await sembrarConsolidable(tx, zonaId, usuarioId, "100.00"),
        await sembrarConsolidable(tx, zonaId, usuarioId, "200.00"),
        await sembrarConsolidable(tx, zonaId, usuarioId, "300.00"),
      ];

      // La que GANA: se lleva los tres.
      const ganadora = await repo.crearCierreBodega({
        zonaId,
        solicitadoPor: usuarioId,
        cierreDiaIds: ids,
        totales: { ...TOTALES_CERO, efectivo: "600.00", general: "600.00" },
        totalPagoMensajero: "0.00",
        totalIngresoBodegaRechazos: "0.00",
      });

      const antes = await tx.cierreBodega.count({ where: { zonaId } });

      // La que PIERDE: pide el mismo conjunto, que ya no esta libre.
      let error: unknown = null;
      try {
        await repo.crearCierreBodega({
          zonaId,
          solicitadoPor: usuarioId,
          cierreDiaIds: ids,
          totales: { ...TOTALES_CERO, efectivo: "600.00", general: "600.00" },
          totalPagoMensajero: "0.00",
          totalIngresoBodegaRechazos: "0.00",
        });
      } catch (e) {
        error = e;
      }

      const despues = await tx.cierreBodega.count({ where: { zonaId } });
      const vinculados = await tx.cierreDia.findMany({
        where: { id: { in: ids } },
        select: { id: true, cierreBodegaId: true },
      });
      return { ganadora, antes, despues, error, vinculados };
    });

    // Una gana …
    expect(r.antes).toBe(1);
    // … y la otra LANZA.
    expect(r.error, "la segunda consolidacion no lanzo: se repartio la cola").toBeInstanceOf(
      ConsolidacionParcialError,
    );
    // ⭑ Y NO DEJA FILA. Este es el numero que importa: sin el `throw`, aqui habria DOS cabeceras y
    // la segunda declararia ₡600 sin llevar ni un cierre.
    expect(r.despues).toBe(1);
    // Los tres `cierre_dia` siguen colgando de la GANADORA, y de ninguna otra.
    expect(new Set(r.vinculados.map((c) => c.cierreBodegaId))).toEqual(new Set([r.ganadora]));
  });

  it("⭑ R7: tambien lanza si solo SOBREVIVE PARTE de la cola (el caso peligroso de verdad)", async () => {
    // El caso que un `count === 0` NO cazaria: la segunda consolidacion alcanza a vincular UNO de
    // tres. Sin el todo-o-nada quedaria una cabecera que declara ₡600 llevando ₡100.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "parcial");
      const repo = new CierreBodegaRepository(tx as unknown as PrismaClient);

      const ids = [
        await sembrarConsolidable(tx, zonaId, usuarioId, "100.00"),
        await sembrarConsolidable(tx, zonaId, usuarioId, "200.00"),
        await sembrarConsolidable(tx, zonaId, usuarioId, "300.00"),
      ];

      // Otra consolidacion se lleva DOS de los tres.
      await repo.crearCierreBodega({
        zonaId,
        solicitadoPor: usuarioId,
        cierreDiaIds: ids.slice(1),
        totales: { ...TOTALES_CERO, efectivo: "500.00", general: "500.00" },
        totalPagoMensajero: "0.00",
        totalIngresoBodegaRechazos: "0.00",
      });

      const antes = await tx.cierreBodega.count({ where: { zonaId } });
      let error: unknown = null;
      try {
        await repo.crearCierreBodega({
          zonaId,
          solicitadoPor: usuarioId,
          cierreDiaIds: ids, // pide los TRES; solo uno esta libre
          totales: { ...TOTALES_CERO, efectivo: "600.00", general: "600.00" },
          totalPagoMensajero: "0.00",
          totalIngresoBodegaRechazos: "0.00",
        });
      } catch (e) {
        error = e;
      }
      const despues = await tx.cierreBodega.count({ where: { zonaId } });
      const libre = await tx.cierreDia.findUnique({
        where: { id: ids[0] },
        select: { cierreBodegaId: true },
      });
      return { antes, despues, error, libre };
    });

    expect(r.antes).toBe(1);
    expect(r.error).toBeInstanceOf(ConsolidacionParcialError);
    expect(r.despues).toBe(1);
    // Y el `cierre_dia` que SI estaba libre sigue libre: la transaccion se deshizo entera.
    expect(r.libre?.cierreBodegaId).toBeNull();
  });

  it("R7 (control positivo): con la cola entera libre, la consolidacion SI se crea y vincula", async () => {
    // Sin este caso, un `throw` incondicional pasaria los dos de arriba en verde y nadie podria
    // volver a consolidar nunca.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "feliz");
      const repo = new CierreBodegaRepository(tx as unknown as PrismaClient);
      const ids = [
        await sembrarConsolidable(tx, zonaId, usuarioId, "100.00"),
        await sembrarConsolidable(tx, zonaId, usuarioId, "200.00"),
      ];
      const id = await repo.crearCierreBodega({
        zonaId,
        solicitadoPor: usuarioId,
        cierreDiaIds: ids,
        totales: { ...TOTALES_CERO, efectivo: "300.00", general: "300.00" },
        totalPagoMensajero: "0.00",
        totalIngresoBodegaRechazos: "0.00",
      });
      const vinculados = await tx.cierreDia.count({ where: { cierreBodegaId: id } });
      return { id, vinculados };
    });

    expect(r.id).toBeTruthy();
    expect(r.vinculados).toBe(2);
  });
});
