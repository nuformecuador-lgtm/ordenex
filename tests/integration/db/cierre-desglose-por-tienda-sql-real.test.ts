import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { partesPorTienda } from "@/lib/utils/ingreso-ordenex";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * 💰 FICHA 396 (B3) — **QUÉ FILAS SE AGRUPAN, EJECUTADO CONTRA POSTGRES.**
 *
 * ⚠️ Recordatorio, porque cambia cómo se lee todo lo demás: **esto no es un defecto de dinero.**
 * `wallet_tienda_movimiento` lleva los movimientos separados por tienda desde siempre. Lo que
 * faltaba era que la pantalla dijera de quién es cada parte del total agregado.
 *
 * ─── POR QUÉ ESTE ARCHIVO EXISTE ──────────────────────────────────────────────────────────
 *
 * R6 dice que el desglose agrupa por la tienda **CONGELADA en `cierre_detail`**, nunca por la
 * tienda VIVA de la orden. Y R7 dice que la clave es el **identificador**, no el nombre.
 *
 * Ninguna de las dos se puede probar por arriba. Los tests de servicio usan dobles del
 * repositorio y **no ven el SQL**: si `DETALLE_ADMIN_SELECT` dejara de proyectar `tienda_id`, o
 * si alguien cambiara el mapper para leer `orden.tienda_id`, el doble seguiría devolviendo lo
 * que el test le dijo y todo quedaría verde. Este repo ya midió **cuatro veces** que una
 * mutación de una proyección o de un `where` sobrevive en verde por arriba.
 *
 * Aquí la única forma de que el caso pase es que **Postgres devuelva de verdad** las filas que
 * afirmamos, con el `tienda_id` que afirmamos.
 *
 * ─── LOS DOS SEÑUELOS, QUE SON LO QUE HACE ÚTIL AL TEST ───────────────────────────────────
 *
 *  1. **Las dos tiendas se llaman IGUAL** en el snapshot. Agrupar por `tienda_nombre` las
 *     fundiría en una sola fila de 140.000,00, con el dinero de una atribuido a la otra en
 *     pantalla. El test afirma que salen DOS.
 *  2. **Las órdenes se re-apuntan a OTRA tienda DESPUÉS de crear el cierre**, cruzadas. Si el
 *     desglose leyera la tienda viva, las dos filas saldrían con los importes intercambiados —
 *     no «un poco distintos», sino exactamente al revés, que es imposible de acertar por
 *     casualidad.
 *
 * TODO corre dentro de una transacción que SIEMPRE se revierte. Sin base alcanzable se SALTA
 * (`describe.skip`), no pasa en verde; con base pero sin catálogo, **falla ruidosamente**.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo único por corrida: `num_remision`, `num_guia`, `email` y `cedula` son UNIQUE. */
const SUFIJO = `396-${Date.now().toString(36)}`;
const GUIA_BASE = 930_000_000 + (Date.now() % 50_000_000);

const ALCANCE_TOTAL: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

/**
 * ⭑ EL NOMBRE ES EL MISMO PARA LAS DOS TIENDAS, a propósito. Es el señuelo de R7: dos tiendas
 * distintas pueden llamarse igual, y el nombre no puede ser la clave.
 */
const NOMBRE_COMPARTIDO = "Distribuidora del Valle";

/**
 * LOS IMPORTES, ESCRITOS A MANO. Salen de la tarifa congelada que se siembra abajo
 * (flete 2.000,00 · IVA 13% · comisión COD 3% · flete devuelto 1.500,00), aplicada a los
 * `monto_cobrar` de cada orden. No se derivan aquí con las funciones de producción: son el
 * CONTRATO contra el que se mide.
 *
 *   Tienda A (dos órdenes: una entrega de 100.000,00 y UN RECHAZO)
 *     recaudado    100.000,00
 *     flete+IVA      2.260,00   (2.000,00 + 260,00)
 *     comisión+IVA   3.390,00   (3% de 100.000,00 = 3.000,00, + 390,00)
 *     facturado      7.345,00   (5.650,00 de la entrega + 1.695,00 del rechazo)
 *     se le paga    94.350,00   (100.000,00 − 2.260,00 − 3.390,00)
 *     gana          92.655,00   (100.000,00 − 7.345,00)
 *
 *   Tienda B (una entrega de 40.000,00, SIN rechazos)
 *     recaudado     40.000,00
 *     se le paga    36.384,00   (40.000,00 − 2.260,00 − 1.356,00)
 *     gana          36.384,00   (40.000,00 − 3.616,00)
 */
const A_RECAUDADO = "100000.00";
const A_PAGO = "94350.00";
const A_GANA = "92655.00";
const B_RECAUDADO = "40000.00";
const B_PAGO = "36384.00";
const B_GANA = "36384.00";

describeSiHayBase("396/B3 — el desglose por tienda agrupa por lo CONGELADO, contra Postgres", () => {
  let prisma: PrismaClient;

  let conCorpus: <T>(
    fn: (ctx: {
      repo: CierresAdminRepository;
      cierreId: string;
      tiendaA: string;
      tiendaB: string;
      /** La MISMA transacción, para leer la tienda VIVA y contrastarla con la congelada. */
      tiendaVivaDe: (numRemision: string) => Promise<string | null>;
      remisionA1: string;
      remisionA2: string;
      remisionB1: string;
    }) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();

    const fks = await fksDeOrden(prisma);
    // Fallo RUIDOSO, no `return` silencioso: con base alcanzable y sin catálogo este archivo no
    // puede comprobar nada, y un `passed` en esas condiciones es peor que no tener el test.
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el " +
          "corpus. Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }

    // Plantilla para crear las DOS tiendas nuevas. Se crean en vez de reusar usuarios existentes
    // porque hacen falta dos que NO tengan tarifa propia (la que se siembra abajo es única por
    // par `(zona, tienda)`) y porque el nombre compartido tiene que ser cosa del test.
    const plantilla = await prisma.usuario.findFirst({
      select: { tipoIdentificacionId: true, rolId: true, passwordHash: true },
    });
    if (plantilla === null) {
      throw new Error(
        "la tabla `usuario` esta vacia: no hay de donde tomar `tipo_identificacion_id` ni " +
          "`rol_id` para crear las dos tiendas del corpus. Corre las semillas antes.",
      );
    }

    // `cierre_dia.mensajero_id` es FK -> `usuario`. Se reusa uno REAL: lo que se mide aqui es el
    // agrupamiento por tienda, no un rol.
    const mensajero = await prisma.usuario.findFirst({ select: { id: true } });
    if (mensajero === null) throw new Error("no hay ningun usuario para ser el mensajero");

    const estatus = await prisma.orderStatus.findFirst({
      where: { value: "en_reparto" },
      select: { id: true },
    });
    if (estatus === null) {
      throw new Error(
        "falta el estatus «en_reparto» en el catalogo `order_status`. Corre `pnpm run db:seed`: " +
          "sin el, este archivo no puede sembrar el corpus y NO debe pasar en verde.",
      );
    }

    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        // PRIMERA sentencia: serializa contra los otros archivos que escriben en las tablas
        // reales de `public` (ver `_postgres-real.ts`).
        await serializarEscriturasReales(tx);

        const nuevaTienda = async (clave: string) =>
          (
            await tx.usuario.create({
              data: {
                // El nombre VIVO también es el mismo en las dos: nada en el corpus permite
                // distinguirlas por texto.
                nombre: NOMBRE_COMPARTIDO,
                email: `tienda-${clave}-${SUFIJO}@ordenex.test`,
                telefono: "88880000",
                passwordHash: plantilla.passwordHash,
                cedula: `C-${clave}-${SUFIJO}`,
                tipoIdentificacionId: plantilla.tipoIdentificacionId,
                rolId: plantilla.rolId,
              },
              select: { id: true },
            })
          ).id;

        const tiendaA = await nuevaTienda("a");
        const tiendaB = await nuevaTienda("b");

        // LA TARIFA CONGELADA del corpus. `cierre_detail.tarifa_id` es FK con ON DELETE RESTRICT,
        // asi que tiene que apuntar a una fila real; se crea una sola y la comparten las tres
        // filas del snapshot, porque lo que importa aqui son los VALORES congelados, no de que
        // fila salieron.
        const tarifa = await tx.tarifa.create({
          data: {
            tiendaId: tiendaA,
            zonaId: null,
            valorFlete: new Prisma.Decimal("2000.00"),
            valorFleteGam: new Prisma.Decimal("2500.00"),
            valorFleteDevuelto: new Prisma.Decimal("1500.00"),
            valorFleteDevueltoGam: new Prisma.Decimal("1800.00"),
            fulfillment: new Prisma.Decimal("0.00"),
            comisionCod: new Prisma.Decimal("3.00"), // 3 %
            ivaFlete: new Prisma.Decimal("13.00"), // 13 %
            ivaComisionCod: new Prisma.Decimal("13.00"), // 13 %
          },
          select: { id: true },
        });

        const cierre = await tx.cierreDia.create({
          data: {
            mensajeroId: mensajero.id,
            estado: "solicitado",
            destinoTipo: "bodega_central",
            destinoZonaId: fks.zonaId,
          },
          select: { id: true },
        });

        /**
         * Siembra UNA orden + su gestión + su fila CONGELADA de `cierre_detail`.
         *
         * `tiendaCongelada` y `tiendaViva` se pasan por separado y **a propósito distintas**: es
         * lo que separa «lo que el cierre recuerda» de «lo que la orden dice hoy».
         */
        const sembrar = async (opciones: {
          clave: string;
          guia: number;
          tiendaCongelada: string;
          tiendaViva: string;
          montoCobrar: string;
          resultado: "entregada" | "rechazada";
          pago: { metodo: "efectivo" | "SINPE"; monto: string } | null;
        }) => {
          const numRemision = `R-${SUFIJO}-${opciones.clave}`;
          const orden = await tx.orden.create({
            data: {
              numGuia: GUIA_BASE + opciones.guia,
              numRemision,
              destinatario: `Dest ${opciones.clave}`,
              telefonoDest: "88880000",
              producto: `Prod ${opciones.clave}`,
              montoCobrar: new Prisma.Decimal(opciones.montoCobrar),
              cobraComision: true,
              estatusId: estatus.id,
              mensajeroAsignadoId: mensajero.id,
              // La orden nace apuntando a SU tienda; el cruce viene después de congelar.
              tiendaId: opciones.tiendaCongelada,
              zonaId: fks.zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
            },
            select: { id: true },
          });

          await tx.gestionOrden.create({
            data: {
              ordenId: orden.id,
              mensajeroId: mensajero.id,
              resultado: opciones.resultado,
              cierreId: cierre.id,
              montoRecibido:
                opciones.pago === null ? null : new Prisma.Decimal(opciones.pago.monto),
              metodoPago: opciones.pago?.metodo ?? null,
              pagos:
                opciones.pago === null
                  ? undefined
                  : {
                      create: [
                        {
                          metodo: opciones.pago.metodo,
                          monto: new Prisma.Decimal(opciones.pago.monto),
                        },
                      ],
                    },
            },
            select: { id: true },
          });

          await tx.cierreDetail.create({
            data: {
              cierreId: cierre.id,
              ordenId: orden.id,
              montoCobrar: new Prisma.Decimal(opciones.montoCobrar),
              cobraComision: true,
              zonaId: fks.zonaId,
              // ⭑ LA COLUMNA DE LA FICHA. Es lo que el cierre RECUERDA.
              tiendaId: opciones.tiendaCongelada,
              esCentral: false,
              esZonaEspecial: false,
              tarifaId: tarifa.id,
              tarifaValorFlete: new Prisma.Decimal("2000.00"),
              tarifaValorFleteGam: new Prisma.Decimal("2500.00"),
              tarifaValorFleteDevuelto: new Prisma.Decimal("1500.00"),
              tarifaValorFleteDevueltoGam: new Prisma.Decimal("1800.00"),
              tarifaComisionCod: new Prisma.Decimal("3.00"),
              tarifaIvaFlete: new Prisma.Decimal("13.00"),
              tarifaIvaComisionCod: new Prisma.Decimal("13.00"),
              tarifaFulfillment: new Prisma.Decimal("0.00"),
              numGuia: GUIA_BASE + opciones.guia,
              numRemision,
              destinatario: `Dest ${opciones.clave}`,
              producto: `Prod ${opciones.clave}`,
              // ⭑ EL MISMO NOMBRE PARA LAS DOS TIENDAS: el señuelo de R7.
              tiendaNombre: NOMBRE_COMPARTIDO,
              zonaNombre: "Zona 396",
              provinciaNombre: "Provincia 396",
              cantonNombre: "Canton 396",
            },
            select: { id: true },
          });

          // ⭑ EL CRUCE. Ocurre DESPUÉS de congelar: la orden pasa a decir que es de la OTRA
          // tienda. Es exactamente lo que pasa en producción cuando alguien re-apunta una orden
          // después del cierre — y es el momento en que «lo vivo» y «lo congelado» dejan de
          // coincidir.
          if (opciones.tiendaViva !== opciones.tiendaCongelada) {
            await tx.orden.update({
              where: { id: orden.id },
              data: { tiendaId: opciones.tiendaViva },
            });
          }

          return numRemision;
        };

        // Tienda A congela DOS órdenes (una entrega grande y un rechazo); tienda B, UNA entrega.
        // Y las tres se re-apuntan CRUZADAS: lo vivo queda exactamente al revés de lo congelado.
        const remisionA1 = await sembrar({
          clave: "a1-entrega",
          guia: 11,
          tiendaCongelada: tiendaA,
          tiendaViva: tiendaB,
          montoCobrar: "100000.00",
          resultado: "entregada",
          pago: { metodo: "efectivo", monto: "100000.00" },
        });
        const remisionA2 = await sembrar({
          clave: "a2-rechazo",
          guia: 12,
          tiendaCongelada: tiendaA,
          tiendaViva: tiendaB,
          montoCobrar: "20000.00",
          resultado: "rechazada",
          pago: null,
        });
        const remisionB1 = await sembrar({
          clave: "b1-entrega",
          guia: 13,
          tiendaCongelada: tiendaB,
          tiendaViva: tiendaA,
          montoCobrar: "40000.00",
          resultado: "entregada",
          pago: { metodo: "SINPE", monto: "40000.00" },
        });

        const repo = new CierresAdminRepository(
          tx as unknown as PrismaClient,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        );

        return fn({
          repo,
          cierreId: cierre.id,
          tiendaA,
          tiendaB,
          remisionA1,
          remisionA2,
          remisionB1,
          tiendaVivaDe: async (numRemision) =>
            (
              await tx.orden.findFirst({ where: { numRemision }, select: { tiendaId: true } })
            )?.tiendaId ?? null,
        });
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("CONTROL POSITIVO: el corpus existe — tres gestiones y DOS tiendas congeladas distintas", async () => {
    // Sin esto, todo lo de abajo podría estar midiendo el vacío. Nada de `if (!filas) return;`:
    // un `return` silencioso reporta `passed` sin haber comprobado nada.
    const { cardinalGestiones, tiendasCongeladas, esperadas } = await conCorpus(async (ctx) => {
      const r = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreId, ALCANCE_TOTAL);
      if (r === null) throw new Error("el cierre sembrado no se encontro: el corpus no existe");
      return {
        cardinalGestiones: r.gestiones.length,
        tiendasCongeladas: [...new Set(r.gestiones.map((g) => g.tiendaId))].sort(),
        esperadas: [ctx.tiendaA, ctx.tiendaB].sort(),
      };
    });

    expect(cardinalGestiones).toBe(3);
    expect(tiendasCongeladas).toHaveLength(2);
    expect(tiendasCongeladas).toEqual(esperadas);
  });

  it("R6: la proyección sube el `tienda_id` CONGELADO, no el de la orden viva", async () => {
    // El contraste directo, fila a fila: lo que devuelve el repositorio contra lo que la orden
    // dice HOY. Si `DETALLE_ADMIN_SELECT` dejara de proyectar `tienda_id`, o si el mapper leyera
    // `orden.tienda_id`, estas dos columnas coincidirían y el caso cae.
    const medido = await conCorpus(async (ctx) => {
      const r = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreId, ALCANCE_TOTAL);
      if (r === null) throw new Error("el cierre sembrado no se encontro");
      const porRemision = new Map(r.gestiones.map((g) => [g.numRemision, g.tiendaId]));
      return {
        congeladaA1: porRemision.get(ctx.remisionA1),
        congeladaA2: porRemision.get(ctx.remisionA2),
        congeladaB1: porRemision.get(ctx.remisionB1),
        vivaA1: await ctx.tiendaVivaDe(ctx.remisionA1),
        vivaA2: await ctx.tiendaVivaDe(ctx.remisionA2),
        vivaB1: await ctx.tiendaVivaDe(ctx.remisionB1),
        tiendaA: ctx.tiendaA,
        tiendaB: ctx.tiendaB,
      };
    });

    // Lo CONGELADO: A, A, B.
    expect(medido.congeladaA1).toBe(medido.tiendaA);
    expect(medido.congeladaA2).toBe(medido.tiendaA);
    expect(medido.congeladaB1).toBe(medido.tiendaB);

    // Lo VIVO, cruzado: B, B, A. Esta es la mitad que impide que el caso pase por casualidad —
    // si la re-apuntada no hubiera ocurrido, las dos columnas coincidirían y no habría nada que
    // distinguir.
    expect(medido.vivaA1).toBe(medido.tiendaB);
    expect(medido.vivaA2).toBe(medido.tiendaB);
    expect(medido.vivaB1).toBe(medido.tiendaA);
  });

  it("R6/R7: el desglose sale de lo congelado y NO se funde aunque las dos tiendas se llamen igual", async () => {
    const partes = await conCorpus(async (ctx) => {
      const r = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreId, ALCANCE_TOTAL);
      if (r === null) throw new Error("el cierre sembrado no se encontro");
      const salida = partesPorTienda(r.gestiones);
      return salida.map((p) => ({
        ...p,
        // El id se traduce a una etiqueta estable para poder afirmar literales: los uuid son
        // distintos en cada corrida.
        cual: p.tiendaId === ctx.tiendaA ? "A" : p.tiendaId === ctx.tiendaB ? "B" : "DESCONOCIDA",
      }));
    });

    // DOS filas, no una: agrupar por `tienda_nombre` daría UNA sola de 140.000,00 con el dinero
    // de una atribuido a la otra.
    expect(partes).toHaveLength(2);
    expect(partes.map((p) => p.tiendaNombre)).toEqual([NOMBRE_COMPARTIDO, NOMBRE_COMPARTIDO]);

    // Y los importes son los de LO CONGELADO. Si se leyera la tienda viva saldrían exactamente
    // AL REVÉS (A con 40.000,00 y B con 100.000,00), que es imposible de acertar por casualidad.
    expect(
      partes.map((p) => ({
        cual: p.cual,
        tiendaNombre: p.tiendaNombre,
        recaudado: p.recaudado,
        pagoTienda: p.pagoTienda,
        ganaLaTienda: p.ganaLaTienda,
      })),
    ).toEqual([
      {
        cual: "A",
        tiendaNombre: NOMBRE_COMPARTIDO,
        recaudado: A_RECAUDADO,
        pagoTienda: A_PAGO,
        ganaLaTienda: A_GANA,
      },
      {
        cual: "B",
        tiendaNombre: NOMBRE_COMPARTIDO,
        recaudado: B_RECAUDADO,
        pagoTienda: B_PAGO,
        ganaLaTienda: B_GANA,
      },
    ]);
  });

  it("las identidades se sostienen sobre datos que salieron de Postgres, no de un doble", async () => {
    const { sumaPago, sumaGana, sumaRecaudado, difA, difB } = await conCorpus(async (ctx) => {
      const r = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreId, ALCANCE_TOTAL);
      if (r === null) throw new Error("el cierre sembrado no se encontro");
      const partes = partesPorTienda(r.gestiones);
      const suma = (montos: string[]) =>
        montos.reduce((a, m) => a.plus(new Prisma.Decimal(m)), new Prisma.Decimal(0)).toFixed(2);
      const dif = (id: string) => {
        const p = partes.find((x) => x.tiendaId === id);
        if (p === undefined) throw new Error("falta una tienda en el desglose");
        return new Prisma.Decimal(p.pagoTienda).minus(p.ganaLaTienda).toFixed(2);
      };
      return {
        sumaPago: suma(partes.map((p) => p.pagoTienda)),
        sumaGana: suma(partes.map((p) => p.ganaLaTienda)),
        sumaRecaudado: suma(partes.map((p) => p.recaudado)),
        difA: dif(ctx.tiendaA),
        difB: dif(ctx.tiendaB),
      };
    });

    // R10 / R11 / R12, contra literales escritos a mano.
    expect(sumaPago).toBe("130734.00"); // 94.350,00 + 36.384,00
    expect(sumaGana).toBe("129039.00"); // 92.655,00 + 36.384,00
    expect(sumaRecaudado).toBe("140000.00"); // 100.000,00 + 40.000,00

    // La CUARTA identidad, por tienda: A tuvo un rechazo (1.695,00) y B no (0,00). Que una de
    // las dos NO sea cero es lo que impide que este caso pase sin comprobar nada.
    expect(difA).toBe("1695.00");
    expect(difB).toBe("0.00");
  });
});
