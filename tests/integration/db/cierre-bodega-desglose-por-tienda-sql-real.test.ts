import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { partesPorTienda } from "@/lib/utils/ingreso-ordenex";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * 💰 FICHA 396 (TANDA D) — **QUÉ FILAS SE AGRUPAN EN CADA NIVEL DEL CIERRE DE BODEGA,
 * EJECUTADO CONTRA POSTGRES.**
 *
 * ⚠️ Recordatorio, porque cambia cómo se lee todo lo demás: **esto no es un defecto de dinero.**
 * `wallet_tienda_movimiento` lleva los movimientos separados por tienda desde siempre. Lo que
 * faltaba era que la pantalla dijera de quién es cada parte de un total ya correcto como total.
 *
 * ─── POR QUÉ ESTE ARCHIVO EXISTE, Y POR QUÉ NO BASTA EL DEL MENSAJERO ─────────────────────
 *
 * El detalle del cierre de bodega tiene **DOS niveles** y **cada uno agrupa un conjunto de filas
 * distinto**: el de cada mensajero, sus propias gestiones; el agregado, las de todos. Los tests
 * de servicio usan dobles del repositorio y **no ven el SQL**: si `findCierreBodegaConDetalle`
 * dejara de componer cada `cierre_dia` con SU snapshot —o si compusiera todas las gestiones
 * contra el snapshot equivocado—, el doble seguiría devolviendo lo que el test le dijo y todo
 * quedaría verde. Este repo ya midió cuatro veces que una mutación de una proyección o de un
 * `where` sobrevive en verde por arriba.
 *
 * Aquí la única forma de que un caso pase es que **Postgres devuelva de verdad** esas filas, con
 * el `tienda_id` que afirmamos y repartidas entre los `cierre_dia` que afirmamos.
 *
 * ─── LOS TRES SEÑUELOS, QUE SON LO QUE HACE ÚTIL AL TEST ──────────────────────────────────
 *
 *  1. **Las dos tiendas se llaman IGUAL** en el snapshot. Agrupar por `tienda_nombre` las
 *     fundiría en una sola fila con el dinero de una atribuido a la otra en pantalla.
 *  2. **Las órdenes se re-apuntan a OTRA tienda DESPUÉS de congelar el snapshot**, cruzadas. Si
 *     el desglose leyera la tienda viva, los importes de las dos tiendas del agregado saldrían
 *     exactamente INTERCAMBIADOS (125.000,00 ↔ 40.000,00): no «un poco distintos», sino al
 *     revés, que es imposible de acertar por casualidad.
 *  3. ⚠️ **LOS DOS NIVELES TIENEN CARDINALES DISTINTOS, a propósito.** Ana llevó órdenes de UNA
 *     sola tienda; Beto, de DOS; la bodega entera, DOS. Es el caso que separa los umbrales
 *     (R19 vs R20): el del nivel-mensajero se evalúa sobre las tiendas **DE ESE MENSAJERO**. Si
 *     alguien derivara el desglose del nivel de Ana del conjunto de toda la bodega, a Ana le
 *     saldrían DOS tiendas y este archivo se pone rojo.
 *
 * Y de regalo, el caso de Q8/R20: **la tienda A aparece en los DOS mensajeros** y en el agregado
 * sale UNA sola vez, con sus cifras sumadas.
 *
 * TODO corre dentro de una transacción que SIEMPRE se revierte. Sin base alcanzable se SALTA
 * (`describe.skip`), no pasa en verde; con base pero sin catálogo, **falla ruidosamente**.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo único por corrida: `num_remision`, `num_guia`, `email` y `cedula` son UNIQUE. */
const SUFIJO = `396d-${Date.now().toString(36)}`;
const GUIA_BASE = 940_000_000 + (Date.now() % 50_000_000);

/**
 * ⭑ EL NOMBRE ES EL MISMO PARA LAS DOS TIENDAS, a propósito. Es el señuelo de R7: dos tiendas
 * distintas pueden llamarse igual, y el nombre no puede ser la clave.
 */
const NOMBRE_COMPARTIDO = "Comercial Talamanca";

/**
 * LOS IMPORTES, ESCRITOS A MANO. Salen de la tarifa congelada que se siembra abajo
 * (flete 2.000,00 · IVA 13 % · comisión COD 3 % · flete devuelto 1.500,00) aplicada a los
 * `monto_cobrar` de cada orden. **No se derivan aquí con las funciones de producción**: son el
 * CONTRATO contra el que se mide, y compararlos contra su propia fuente dejaría el test siempre
 * verde.
 *
 *   ANA (cierre_dia 1) — snapshot general 100.000,00 · UNA sola tienda (la A)
 *     a1 · entrega de 100.000,00 → flete+IVA 2.260,00 · comisión+IVA 3.390,00 · total 5.650,00
 *     a2 · RECHAZO de 20.000,00  → flete devuelto+IVA 1.695,00 · total 1.695,00
 *     tienda A: recaudado 100.000,00 · se le paga 94.350,00 · gana 92.655,00
 *
 *   BETO (cierre_dia 2) — snapshot general 65.000,00 · DOS tiendas
 *     b1 · entrega de 40.000,00 (tienda B) → 2.260,00 · 1.356,00 · total 3.616,00
 *     b2 · entrega de 25.000,00 (tienda A) → 2.260,00 ·   847,50 · total 3.107,50
 *     tienda B: recaudado 40.000,00 · se le paga 36.384,00 · gana 36.384,00
 *     tienda A: recaudado 25.000,00 · se le paga 21.892,50 · gana 21.892,50
 *
 *   AGREGADO — snapshot general 165.000,00 · DOS tiendas (A sale UNA vez, no dos)
 *     tienda A: recaudado 125.000,00 · se le paga 116.242,50 · gana 114.547,50
 *     tienda B: recaudado  40.000,00 · se le paga  36.384,00 · gana  36.384,00
 */
const ANA_GENERAL = "100000.00";
const BETO_GENERAL = "65000.00";
const BODEGA_GENERAL = "165000.00";

const ANA_A = { recaudado: "100000.00", pagoTienda: "94350.00", ganaLaTienda: "92655.00" };
const BETO_B = { recaudado: "40000.00", pagoTienda: "36384.00", ganaLaTienda: "36384.00" };
const BETO_A = { recaudado: "25000.00", pagoTienda: "21892.50", ganaLaTienda: "21892.50" };
const AGREGADO_A = { recaudado: "125000.00", pagoTienda: "116242.50", ganaLaTienda: "114547.50" };
const AGREGADO_B = { recaudado: "40000.00", pagoTienda: "36384.00", ganaLaTienda: "36384.00" };

describeSiHayBase(
  "396/D — el desglose por tienda del cierre de BODEGA, nivel a nivel, contra Postgres",
  () => {
    let prisma: PrismaClient;

    let conCorpus: <T>(
      fn: (ctx: {
        repo: CierresBodegaAdminRepository;
        cierreBodegaId: string;
        cierreAnaId: string;
        cierreBetoId: string;
        tiendaA: string;
        tiendaB: string;
        /** La MISMA transacción, para leer la tienda VIVA y contrastarla con la congelada. */
        tiendaVivaDe: (numRemision: string) => Promise<string | null>;
        remisiones: { a1: string; a2: string; b1: string; b2: string };
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

      const plantilla = await prisma.usuario.findFirst({
        select: { tipoIdentificacionId: true, rolId: true, passwordHash: true },
      });
      if (plantilla === null) {
        throw new Error(
          "la tabla `usuario` esta vacia: no hay de donde tomar `tipo_identificacion_id` ni " +
            "`rol_id` para crear las tiendas y los mensajeros del corpus. Corre las semillas.",
        );
      }

      // `cierre_bodega.solicitado_por` es FK -> `usuario`. Se reusa uno REAL: lo que se mide
      // aqui es el agrupamiento por tienda, no un rol.
      const solicitante = await prisma.usuario.findFirst({ select: { id: true } });
      if (solicitante === null) throw new Error("no hay ningun usuario para ser el solicitante");

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

          const nuevoUsuario = async (clave: string, nombre: string) =>
            (
              await tx.usuario.create({
                data: {
                  nombre,
                  email: `u-${clave}-${SUFIJO}@ordenex.test`,
                  telefono: "88880000",
                  passwordHash: plantilla.passwordHash,
                  cedula: `C-${clave}-${SUFIJO}`,
                  tipoIdentificacionId: plantilla.tipoIdentificacionId,
                  rolId: plantilla.rolId,
                },
                select: { id: true },
              })
            ).id;

          // El nombre VIVO también es el mismo en las dos tiendas: nada en el corpus permite
          // distinguirlas por texto.
          const tiendaA = await nuevoUsuario("tienda-a", NOMBRE_COMPARTIDO);
          const tiendaB = await nuevoUsuario("tienda-b", NOMBRE_COMPARTIDO);
          const ana = await nuevoUsuario("mensajera-ana", "Ana Mensajera");
          const beto = await nuevoUsuario("mensajero-beto", "Beto Mensajero");

          // LA TARIFA CONGELADA del corpus. `cierre_detail.tarifa_id` es FK con ON DELETE
          // RESTRICT, asi que tiene que apuntar a una fila real; se crea una sola y la comparten
          // las cuatro filas del snapshot, porque lo que importa son los VALORES congelados.
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

          // El cierre de BODEGA con su snapshot AGREGADO, y los dos `cierre_dia` colgando de él.
          const cierreBodega = await tx.cierreBodega.create({
            data: {
              zonaId: fks.zonaId,
              solicitadoPor: solicitante.id,
              estado: "solicitado",
              totalEfectivo: new Prisma.Decimal("125000.00"),
              totalSimpe: new Prisma.Decimal("40000.00"),
              totalTransferencia: new Prisma.Decimal("0.00"),
              totalGeneral: new Prisma.Decimal(BODEGA_GENERAL),
              totalPagoMensajero: new Prisma.Decimal("9000.00"),
              totalIngresoBodegaRechazos: new Prisma.Decimal("500.00"),
            },
            select: { id: true },
          });

          const nuevoCierreDia = async (
            mensajeroId: string,
            totales: { efectivo: string; simpe: string; general: string },
            pagoMensajero: string,
            ingresoBodega: string,
          ) =>
            (
              await tx.cierreDia.create({
                data: {
                  mensajeroId,
                  estado: "aprobado",
                  destinoTipo: "bodega_satelite",
                  destinoZonaId: fks.zonaId,
                  cierreBodegaId: cierreBodega.id,
                  totalEfectivo: new Prisma.Decimal(totales.efectivo),
                  totalSimpe: new Prisma.Decimal(totales.simpe),
                  totalTransferencia: new Prisma.Decimal("0.00"),
                  totalGeneral: new Prisma.Decimal(totales.general),
                  totalPagoMensajero: new Prisma.Decimal(pagoMensajero),
                  totalIngresoBodegaRechazos: new Prisma.Decimal(ingresoBodega),
                },
                select: { id: true },
              })
            ).id;

          const cierreAnaId = await nuevoCierreDia(
            ana,
            { efectivo: ANA_GENERAL, simpe: "0.00", general: ANA_GENERAL },
            "5000.00",
            "500.00",
          );
          const cierreBetoId = await nuevoCierreDia(
            beto,
            { efectivo: "25000.00", simpe: "40000.00", general: BETO_GENERAL },
            "4000.00",
            "0.00",
          );

          /**
           * Siembra UNA orden + su gestión + su fila CONGELADA de `cierre_detail`.
           *
           * `tiendaCongelada` y `tiendaViva` se pasan por separado y **a propósito distintas**:
           * es lo que separa «lo que el cierre recuerda» de «lo que la orden dice hoy».
           */
          const sembrar = async (opciones: {
            clave: string;
            guia: number;
            cierreId: string;
            mensajeroId: string;
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
                mensajeroAsignadoId: opciones.mensajeroId,
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
                mensajeroId: opciones.mensajeroId,
                resultado: opciones.resultado,
                cierreId: opciones.cierreId,
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
                cierreId: opciones.cierreId,
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
            // tienda. Es lo que pasa en producción cuando alguien re-apunta una orden después
            // del cierre — el momento en que «lo vivo» y «lo congelado» dejan de coincidir.
            if (opciones.tiendaViva !== opciones.tiendaCongelada) {
              await tx.orden.update({
                where: { id: orden.id },
                data: { tiendaId: opciones.tiendaViva },
              });
            }

            return numRemision;
          };

          // ANA: dos órdenes de la tienda A (una entrega grande y un rechazo) → UNA tienda.
          const a1 = await sembrar({
            clave: "a1-entrega",
            guia: 21,
            cierreId: cierreAnaId,
            mensajeroId: ana,
            tiendaCongelada: tiendaA,
            tiendaViva: tiendaB,
            montoCobrar: "100000.00",
            resultado: "entregada",
            pago: { metodo: "efectivo", monto: "100000.00" },
          });
          const a2 = await sembrar({
            clave: "a2-rechazo",
            guia: 22,
            cierreId: cierreAnaId,
            mensajeroId: ana,
            tiendaCongelada: tiendaA,
            tiendaViva: tiendaB,
            montoCobrar: "20000.00",
            resultado: "rechazada",
            pago: null,
          });
          // BETO: una de la tienda B y otra de la tienda A → DOS tiendas, y la A repetida.
          const b1 = await sembrar({
            clave: "b1-entrega",
            guia: 23,
            cierreId: cierreBetoId,
            mensajeroId: beto,
            tiendaCongelada: tiendaB,
            tiendaViva: tiendaA,
            montoCobrar: "40000.00",
            resultado: "entregada",
            pago: { metodo: "SINPE", monto: "40000.00" },
          });
          const b2 = await sembrar({
            clave: "b2-entrega",
            guia: 24,
            cierreId: cierreBetoId,
            mensajeroId: beto,
            tiendaCongelada: tiendaA,
            tiendaViva: tiendaB,
            montoCobrar: "25000.00",
            resultado: "entregada",
            pago: { metodo: "efectivo", monto: "25000.00" },
          });

          const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);

          return fn({
            repo,
            cierreBodegaId: cierreBodega.id,
            cierreAnaId,
            cierreBetoId,
            tiendaA,
            tiendaB,
            remisiones: { a1, a2, b1, b2 },
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

    it("CONTROL POSITIVO: el corpus existe — DOS cierre_dia, CUATRO gestiones y DOS tiendas congeladas", async () => {
      // Sin esto, todo lo de abajo podría estar midiendo el vacío. Nada de `if (!filas) return;`:
      // un `return` silencioso reporta `passed` sin haber comprobado nada.
      const medido = await conCorpus(async (ctx) => {
        const r = await ctx.repo.findCierreBodegaConDetalle(ctx.cierreBodegaId);
        if (r === null) throw new Error("el cierre de bodega sembrado no se encontro");
        const todas = r.cierresDia.flatMap((cd) => cd.gestiones);
        return {
          cardinalDias: r.cierresDia.length,
          cardinalGestiones: todas.length,
          generalAgregado: r.cierre.totales.general,
          tiendasCongeladas: [...new Set(todas.map((g) => g.tiendaId))].sort(),
          esperadas: [ctx.tiendaA, ctx.tiendaB].sort(),
        };
      });

      expect(medido.cardinalDias).toBe(2);
      expect(medido.cardinalGestiones).toBe(4);
      expect(medido.generalAgregado).toBe(BODEGA_GENERAL);
      expect(medido.tiendasCongeladas).toHaveLength(2);
      expect(medido.tiendasCongeladas).toEqual(medido.esperadas);
    });

    it("R6: cada `cierre_dia` sube el `tienda_id` CONGELADO de SUS filas, no el de la orden viva", async () => {
      // El contraste directo, fila a fila: lo que devuelve el repositorio contra lo que la orden
      // dice HOY. Si `DETALLE_ADMIN_SELECT` dejara de proyectar `tienda_id`, o si el mapper
      // leyera `orden.tienda_id`, estas dos columnas coincidirían y el caso cae.
      const medido = await conCorpus(async (ctx) => {
        const r = await ctx.repo.findCierreBodegaConDetalle(ctx.cierreBodegaId);
        if (r === null) throw new Error("el cierre de bodega sembrado no se encontro");
        const porRemision = new Map(
          r.cierresDia.flatMap((cd) => cd.gestiones).map((g) => [g.numRemision, g.tiendaId]),
        );
        return {
          congeladas: {
            a1: porRemision.get(ctx.remisiones.a1),
            a2: porRemision.get(ctx.remisiones.a2),
            b1: porRemision.get(ctx.remisiones.b1),
            b2: porRemision.get(ctx.remisiones.b2),
          },
          vivas: {
            a1: await ctx.tiendaVivaDe(ctx.remisiones.a1),
            a2: await ctx.tiendaVivaDe(ctx.remisiones.a2),
            b1: await ctx.tiendaVivaDe(ctx.remisiones.b1),
            b2: await ctx.tiendaVivaDe(ctx.remisiones.b2),
          },
          tiendaA: ctx.tiendaA,
          tiendaB: ctx.tiendaB,
        };
      });

      // Lo CONGELADO: A, A, B, A.
      expect(medido.congeladas.a1).toBe(medido.tiendaA);
      expect(medido.congeladas.a2).toBe(medido.tiendaA);
      expect(medido.congeladas.b1).toBe(medido.tiendaB);
      expect(medido.congeladas.b2).toBe(medido.tiendaA);

      // Lo VIVO, cruzado: B, B, A, B. Esta es la mitad que impide que el caso pase por
      // casualidad — si la re-apuntada no hubiera ocurrido, las dos columnas coincidirían y no
      // habría nada que distinguir.
      expect(medido.vivas.a1).toBe(medido.tiendaB);
      expect(medido.vivas.a2).toBe(medido.tiendaB);
      expect(medido.vivas.b1).toBe(medido.tiendaA);
      expect(medido.vivas.b2).toBe(medido.tiendaB);
    });

    it("⚠️ R19 vs R20: el nivel de CADA MENSAJERO agrupa SUS gestiones — Ana tiene UNA tienda y la bodega DOS", async () => {
      // ESTE es el caso que separa los dos umbrales. Si el desglose del nivel-mensajero se
      // derivara del conjunto de toda la bodega, a Ana le saldrían DOS tiendas: enseñaría un
      // desglose en un mensajero que sólo llevó una.
      const medido = await conCorpus(async (ctx) => {
        const r = await ctx.repo.findCierreBodegaConDetalle(ctx.cierreBodegaId);
        if (r === null) throw new Error("el cierre de bodega sembrado no se encontro");
        const etiqueta = (id: string) =>
          id === ctx.tiendaA ? "A" : id === ctx.tiendaB ? "B" : "DESCONOCIDA";
        const conEtiqueta = (gestiones: Parameters<typeof partesPorTienda>[0]) =>
          partesPorTienda(gestiones).map((p) => ({
            cual: etiqueta(p.tiendaId),
            tiendaNombre: p.tiendaNombre,
            recaudado: p.recaudado,
            pagoTienda: p.pagoTienda,
            ganaLaTienda: p.ganaLaTienda,
          }));
        const deAna = r.cierresDia.find((cd) => cd.resumen.cierreDiaId === ctx.cierreAnaId);
        const deBeto = r.cierresDia.find((cd) => cd.resumen.cierreDiaId === ctx.cierreBetoId);
        if (deAna === undefined || deBeto === undefined) {
          throw new Error("falta uno de los dos cierre_dia sembrados");
        }
        return {
          ana: conEtiqueta(deAna.gestiones),
          beto: conEtiqueta(deBeto.gestiones),
          agregado: conEtiqueta(r.cierresDia.flatMap((cd) => cd.gestiones)),
          generalAna: deAna.resumen.totales.general,
          generalBeto: deBeto.resumen.totales.general,
        };
      });

      // ANA: UNA sola tienda. Con su snapshot cuadrando con lo que suman sus gestiones.
      expect(medido.generalAna).toBe(ANA_GENERAL);
      expect(medido.ana).toEqual([{ cual: "A", tiendaNombre: NOMBRE_COMPARTIDO, ...ANA_A }]);

      // BETO: DOS tiendas, ordenadas por lo que se les paga (36.384,00 antes que 21.892,50).
      expect(medido.generalBeto).toBe(BETO_GENERAL);
      expect(medido.beto).toEqual([
        { cual: "B", tiendaNombre: NOMBRE_COMPARTIDO, ...BETO_B },
        { cual: "A", tiendaNombre: NOMBRE_COMPARTIDO, ...BETO_A },
      ]);

      // AGREGADO: DOS filas y no tres — la tienda A aparece en los DOS mensajeros y sale UNA
      // sola vez, con sus cifras sumadas (R20/Q8: sin cruce tienda × mensajero). Y NO se funde
      // con la B pese a llamarse igual (R7). Si se leyera la tienda VIVA, los importes saldrían
      // exactamente intercambiados.
      expect(medido.agregado).toEqual([
        { cual: "A", tiendaNombre: NOMBRE_COMPARTIDO, ...AGREGADO_A },
        { cual: "B", tiendaNombre: NOMBRE_COMPARTIDO, ...AGREGADO_B },
      ]);
    });

    it("las identidades de los TRES niveles se sostienen sobre datos que salieron de Postgres", async () => {
      const medido = await conCorpus(async (ctx) => {
        const r = await ctx.repo.findCierreBodegaConDetalle(ctx.cierreBodegaId);
        if (r === null) throw new Error("el cierre de bodega sembrado no se encontro");
        const suma = (montos: string[]) =>
          montos.reduce((a, m) => a.plus(new Prisma.Decimal(m)), new Prisma.Decimal(0)).toFixed(2);
        const resumir = (gestiones: Parameters<typeof partesPorTienda>[0]) => {
          const partes = partesPorTienda(gestiones);
          return {
            pago: suma(partes.map((p) => p.pagoTienda)),
            gana: suma(partes.map((p) => p.ganaLaTienda)),
            recaudado: suma(partes.map((p) => p.recaudado)),
          };
        };
        const todas = r.cierresDia.flatMap((cd) => cd.gestiones);
        const partesAgregado = partesPorTienda(todas);
        const dif = (id: string) => {
          const p = partesAgregado.find((x) => x.tiendaId === id);
          if (p === undefined) throw new Error("falta una tienda en el desglose agregado");
          return new Prisma.Decimal(p.pagoTienda).minus(p.ganaLaTienda).toFixed(2);
        };
        const deAna = r.cierresDia.find((cd) => cd.resumen.cierreDiaId === ctx.cierreAnaId)!;
        const deBeto = r.cierresDia.find((cd) => cd.resumen.cierreDiaId === ctx.cierreBetoId)!;
        return {
          ana: resumir(deAna.gestiones),
          beto: resumir(deBeto.gestiones),
          agregado: resumir(todas),
          difA: dif(ctx.tiendaA),
          difB: dif(ctx.tiendaB),
        };
      });

      // R10 / R11 / R12 en el nivel de ANA, contra literales escritos a mano.
      expect(medido.ana).toEqual({
        pago: "94350.00",
        gana: "92655.00",
        recaudado: ANA_GENERAL,
      });

      // …en el nivel de BETO: 36.384,00 + 21.892,50 y 40.000,00 + 25.000,00.
      expect(medido.beto).toEqual({
        pago: "58276.50",
        gana: "58276.50",
        recaudado: BETO_GENERAL,
      });

      // …y en el AGREGADO: 116.242,50 + 36.384,00 · 114.547,50 + 36.384,00 · 125.000,00 + 40.000,00.
      expect(medido.agregado).toEqual({
        pago: "152626.50",
        gana: "150931.50",
        recaudado: BODEGA_GENERAL,
      });

      // La CUARTA identidad, por tienda, en el agregado: A tuvo un rechazo (1.695,00) y B no
      // (0,00). Que una de las dos NO sea cero es lo que impide que este caso pase sin comprobar
      // nada — con las dos en cero, derivar una de las dos cifras con el subconjunto equivocado
      // no se notaría.
      expect(medido.difA).toBe("1695.00");
      expect(medido.difB).toBe("0.00");
    });
  },
);
