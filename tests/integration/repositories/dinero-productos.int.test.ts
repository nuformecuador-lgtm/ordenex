import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "../db/_postgres-real";
import { prepararConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import { DineroProductosRepository } from "@/lib/repositories/DineroProductosRepository";
import type { FilaDineroCruda } from "@/lib/interfaces/repositories/IDineroProductosRepository";
import { fundirDinero, claveDeGrupoProducto } from "@/lib/services/ConteoProductosService";
import { DetalleDineroProductoService } from "@/lib/services/DetalleDineroProductoService";

// FICHA 347 / B3.3 — EL RECORTE Y EL CUADRE DONDE VIVEN: CONTRA POSTGRES.
// Cubre R7, R18, R19, R20, R21, R23, R26, R28, R38, R39, R40, R43, R74, y ⟨Q3⟩.
//
// ⚠ POR QUE ESTE ARCHIVO EXISTE, y no basta el test de servicio. En este repo esta MEDIDO —cuatro
// veces seguidas— que una mutacion del `WHERE` pasa EN VERDE con dobles: un doble del repositorio
// devuelve las filas que el test le dio, asi que demuestra que el doble devuelve lo que le
// dieron. La separacion entre inquilinos vive en el SQL, y aqui es donde se mira. Sin policies
// RLS debajo (Prisma se conecta con credenciales de servicio) esa condicion es la UNICA
// separacion: un fallo no da una cifra equivocada, ensena el DINERO de una tienda a otra.
//
// ⚠ ESTE TEST NO SE ABSTIENE. No hay ninguna rama `if (!datos) return;`: si la siembra no produjo
// el caso, el test FALLA con el motivo escrito. Es el modo de fallo medido en este repo —un
// `return` temprano reporta `passed` sin comprobar nada— y en un camino de dinero es peor.
// Lo unico que lo salta es la AUSENCIA de `DATABASE_URL` (vitest lo marca SKIPPED, no passed).
//
// COMO NO ENSUCIA NADA: todo ocurre dentro de `enTransaccionRevertida`, que SIEMPRE hace rollback
// (pase el test, falle o muera el proceso).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const AHORA = new Date("2026-09-01T12:00:00.000Z");

/** El producto que las DOS tiendas venden: la prueba de que su dinero no se mezcla. */
const TEXTO_COMPARTIDO = "1 * Base C";
/** Una orden MULTIPRODUCTO: su importe entero cuenta en los DOS productos (R12). */
const TEXTO_ACOMPANADO = "1 * Base C. 1 * Dr Melaxin.";
const CLAVE_BASE_C = "base c";
const CLAVE_MELAXIN = "dr melaxin";

/**
 * LOS NUMEROS DE LA TARIFA SEMBRADA, y las cifras que salen de ellos, CALCULADAS A MANO. No se
 * leen de ninguna funcion del codigo: una asercion contra su propia fuente esta siempre verde.
 *
 *   flete 3.000 · iva flete 13 % · comision COD 5 % · iva comision 13 %
 *   flete devuelto 2.000
 *
 *   entrega de 10.000 -> ordenex = 3.000 + 390 + 500 + 65 = 3.955,00
 *                        tienda  = 10.000 - 3.390 - 565   = 6.045,00
 *   entrega de  4.000 -> ordenex = 3.000 + 390 + 200 + 26 = 3.616,00
 *                        tienda  =  4.000 - 3.390 - 226   =   384,00
 *   rechazo           -> retorno = 2.000 + 260            = 2.260,00
 */
const TARIFA = {
  valorFlete: "3000.00",
  valorFleteGam: "2500.00",
  valorFleteDevuelto: "2000.00",
  valorFleteDevueltoGam: "1800.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

interface Medicion {
  tiendaA: string;
  tiendaB: string;
  /** las guias que este test sembro para la tienda A, para poder afirmar el conjunto literal */
  guiaLiquidada: string;
  guiaPendiente: string;
  guiaRechazada: string;
  guiaDosCierres: string;
  guiaAnulada: string;
  guiaAcompanada: string;
  global: readonly FilaDineroCruda[];
  soloA: readonly FilaDineroCruda[];
  soloB: readonly FilaDineroCruda[];
  /** el detalle de `(tienda A, base c)` tal como lo sirve el servicio */
  detalleA: Awaited<ReturnType<DetalleDineroProductoService["consultar"]>>;
  /** las MISMAS cifras, derivadas por un SQL escrito a mano, y su variante no-tautologica */
  cuadreSql: { aMano: CifrasSql; variante: CifrasSql };
}

interface CifrasSql {
  readonly recaudado: string;
  readonly ordenex: string;
  readonly tienda: string;
}

describeSiHayBase("347 / B3.3 — DineroProductosRepository contra Postgres real", () => {
  let prisma: PrismaClient;
  let m: Medicion;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    m = await enTransaccionRevertida(prisma, medir);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  function consultaDe(rol: string, usuarioId: string, raw: object = {}): ConsultaProductos {
    // La consulta se PREPARA de verdad —no se forja— para que el alcance que viaja al `WHERE`
    // sea el que el resolutor concede y no uno escrito a mano por el test.
    const preparada = prepararConsultaProductos(raw, { usuarioId, rol } as never, AHORA);
    if (preparada.status !== "ok") {
      throw new Error(`la consulta de prueba salio ${preparada.status}`);
    }
    return preparada.consulta;
  }

  async function medir(tx: Tx): Promise<Medicion> {
    // PRIMERA sentencia: este test escribe usuarios y ordenes REALES en `public`, igual que
    // otros que corren en paralelo. Sin serializar, los locks de FK se toman en distinto orden
    // y Postgres mata a uno con `40P01`.
    await serializarEscriturasReales(tx);

    const tiendaA = await crearUsuario(tx, "Tienda A del test 347");
    const tiendaB = await crearUsuario(tx, "Tienda B del test 347");
    const mensajero = await crearUsuario(tx, "Mensajero del test 347");
    const tarifaId = await crearTarifa(tx);

    const cierreAprobado = await crearCierre(tx, mensajero, "aprobado");
    const cierreAprobado2 = await crearCierre(tx, mensajero, "aprobado");
    const cierreSolicitado = await crearCierre(tx, mensajero, "solicitado");

    // (1) LIQUIDADA: entrega de 10.000 dentro de un cierre APROBADO con tarifa congelada.
    const liquidada = await crearOrden(tx, tiendaA, TEXTO_COMPARTIDO);
    await congelar(tx, cierreAprobado, liquidada, tarifaId, "10000.00");
    await crearGestion(tx, liquidada, mensajero, "entregada", "10000.00", cierreAprobado);

    // (2) PENDIENTE: entrega de 7.000 SIN cierre. Su recaudo es un hecho; su reparto, no.
    const pendiente = await crearOrden(tx, tiendaA, TEXTO_COMPARTIDO);
    await crearGestion(tx, pendiente, mensajero, "entregada", "7000.00", null);

    // (3) RECHAZADA liquidada: no recauda, y su retorno va FUERA del reparto (R19).
    const rechazada = await crearOrden(tx, tiendaA, TEXTO_COMPARTIDO);
    await congelar(tx, cierreAprobado, rechazada, tarifaId, "0.00");
    await crearGestion(tx, rechazada, mensajero, "rechazada", null, cierreAprobado);

    // (4) LA MISMA ORDEN EN DOS CIERRES (R18): dos gestiones, dos snapshots, dos derivaciones
    //     que se SUMAN, y UNA sola orden en los cardinales.
    const dosCierres = await crearOrden(tx, tiendaA, TEXTO_COMPARTIDO);
    await congelar(tx, cierreAprobado, dosCierres, tarifaId, "10000.00");
    await congelar(tx, cierreAprobado2, dosCierres, tarifaId, "4000.00");
    await crearGestion(tx, dosCierres, mensajero, "entregada", "10000.00", cierreAprobado);
    await crearGestion(tx, dosCierres, mensajero, "entregada", "4000.00", cierreAprobado2);

    // (5) ANULADA con recaudo: ⟨Q3⟩ — se EXCLUYE. Es la que el humano midio en produccion
    //     (2 gestiones, ₡33.564, ninguna dentro de un cierre ni de un snapshot).
    const anulada = await crearOrden(tx, tiendaA, TEXTO_COMPARTIDO);
    await crearGestion(tx, anulada, mensajero, "entregada", "33564.00", null, { anulada: true });

    // (6) MULTIPRODUCTO: su importe ENTERO cuenta en `base c` y en `dr melaxin` (R12).
    const acompanada = await crearOrden(tx, tiendaA, TEXTO_ACOMPANADO);
    await congelar(tx, cierreAprobado, acompanada, tarifaId, "4000.00");
    await crearGestion(tx, acompanada, mensajero, "entregada", "4000.00", cierreAprobado);

    // (7) CIERRE SOLICITADO (⟨Q2⟩): snapshot congelado, dinero SIN salir -> PENDIENTE.
    const solicitada = await crearOrden(tx, tiendaA, "1 * Producto Solicitado");
    await congelar(tx, cierreSolicitado, solicitada, tarifaId, "5000.00");
    await crearGestion(tx, solicitada, mensajero, "entregada", "5000.00", cierreSolicitado);

    // (8) SIN TARIFA CONGELADA (R23): cierre aprobado, `tarifa_id` NULL -> no deriva nada.
    const sinTarifa = await crearOrden(tx, tiendaA, "1 * Producto Sin Tarifa");
    await congelar(tx, cierreAprobado, sinTarifa, null, "6000.00");
    await crearGestion(tx, sinTarifa, mensajero, "entregada", "6000.00", cierreAprobado);

    // (9) BORRADA (R74): no cuenta en ningun bucket, aunque tenga dinero.
    const borrada = await crearOrden(tx, tiendaA, "1 * Producto Borrado");
    await crearGestion(tx, borrada, mensajero, "entregada", "99999.00", null);
    await tx.orden.update({ where: { id: borrada }, data: { deletedAt: new Date() } });

    // (10) LA OTRA TIENDA, con el MISMO producto y dinero propio: lo que el aislamiento protege.
    const deB = await crearOrden(tx, tiendaB, TEXTO_COMPARTIDO);
    await congelar(tx, cierreAprobado, deB, tarifaId, "10000.00", tiendaB);
    await crearGestion(tx, deB, mensajero, "entregada", "10000.00", cierreAprobado);

    const repo = new DineroProductosRepository(tx as unknown as PrismaClient);
    const servicioDetalle = new DetalleDineroProductoService(repo);

    return {
      tiendaA,
      tiendaB,
      guiaLiquidada: await guiaDe(tx, liquidada),
      guiaPendiente: await guiaDe(tx, pendiente),
      guiaRechazada: await guiaDe(tx, rechazada),
      guiaDosCierres: await guiaDe(tx, dosCierres),
      guiaAnulada: await guiaDe(tx, anulada),
      guiaAcompanada: await guiaDe(tx, acompanada),
      global: filasDe(await repo.leerDineroPorOrden(consultaDe("maestro", "quien-sea"))),
      soloA: filasDe(await repo.leerDineroPorOrden(consultaDe("adminTienda", tiendaA))),
      soloB: filasDe(await repo.leerDineroPorOrden(consultaDe("adminTienda", tiendaB))),
      detalleA: await servicioDetalle.consultar(
        consultaDe("adminTienda", tiendaA, { tienda_id: [tiendaA] }),
        { productoClave: CLAVE_BASE_C, page: 1, pageSize: 25 },
      ),
      cuadreSql: {
        aMano: await cifrasEnSql(tx, tiendaA, true),
        variante: await cifrasEnSql(tx, tiendaA, false),
      },
    };
  }

  /**
   * LA FORMULA, ESCRITA A MANO EN SQL. No llama a `derivarIngresoOrden`, ni a
   * `pagoTiendaOrdenex`, ni a `repartoDeOrden`: reconstruye el reparto desde las columnas
   * CONGELADAS de `cierre_detail`, que es lo unico que las dos mitades comparten.
   *
   * `soloEntregas = false` es la VARIANTE que demuestra que la comparacion no es tautologica:
   * afloja el filtro de resultado y deja entrar la RECHAZADA, que suma su flete de ENTREGA a
   * `ordenex` y da otro numero.
   */
  async function cifrasEnSql(tx: Tx, tiendaId: string, soloEntregas: boolean): Promise<CifrasSql> {
    const filtroResultado = soloEntregas
      ? Prisma.sql`AND g."resultado" = 'entregada'`
      : Prisma.sql`AND g."resultado" IN ('entregada', 'rechazada')`;
    const filas = await tx.$queryRaw<{ recaudado: string; ordenex: string; tienda: string }[]>`
      WITH calc AS (
        SELECT COALESCE(g."monto_recibido", 0) AS recaudado,
               ROUND(CASE WHEN d."es_central" THEN d."tarifa_valor_flete_gam"
                          ELSE d."tarifa_valor_flete" END, 2) AS flete,
               ROUND(CASE WHEN d."es_central" THEN d."tarifa_valor_flete_gam"
                          ELSE d."tarifa_valor_flete" END * d."tarifa_iva_flete" / 100, 2) AS iva_flete,
               CASE WHEN d."cobra_comision"
                    THEN ROUND(COALESCE(d."monto_cobrar", 0) * d."tarifa_comision_cod" / 100, 2)
                    ELSE 0 END AS comision,
               CASE WHEN d."cobra_comision"
                    THEN ROUND(ROUND(COALESCE(d."monto_cobrar", 0) * d."tarifa_comision_cod" / 100, 2)
                               * d."tarifa_iva_comision_cod" / 100, 2)
                    ELSE 0 END AS iva_comision
        FROM "orden" o
        JOIN "gestion_orden" g ON g."orden_id" = o."id"
        JOIN "cierre_dia"    c ON c."id" = g."cierre_id"
        JOIN "cierre_detail" d ON d."cierre_id" = g."cierre_id" AND d."orden_id" = o."id"
        WHERE o."deleted_at" IS NULL
          AND o."tienda_id" = ${tiendaId}
          AND o."producto" IN (${TEXTO_COMPARTIDO}, ${TEXTO_ACOMPANADO})
          AND g."anulada_at" IS NULL
          AND c."estado" = 'aprobado'
          AND d."tarifa_id" IS NOT NULL
          ${filtroResultado}
      )
      SELECT TO_CHAR(SUM(CASE WHEN TRUE THEN recaudado END), 'FM999999999990.00') AS recaudado,
             TO_CHAR(SUM(flete + iva_flete + comision + iva_comision), 'FM999999999990.00') AS ordenex,
             TO_CHAR(SUM(recaudado) - SUM(flete + iva_flete + comision + iva_comision),
                     'FM999999999990.00') AS tienda
      FROM calc`;
    const f = filas[0];
    if (f === undefined || f.ordenex === null) {
      throw new Error("el SQL a mano no devolvio cifras: el test FALLA, no se abstiene");
    }
    return { recaudado: f.recaudado, ordenex: f.ordenex, tienda: f.tienda };
  }

  /** Solo las filas que este test sembro: la base local puede traer otras ordenes. */
  function delTest(filas: readonly FilaDineroCruda[], tienda: string): FilaDineroCruda[] {
    return filas.filter((f) => f.tiendaId === tienda);
  }

  /** Las cifras de `(tienda, producto)` sobre un conjunto de filas crudas. */
  function cifras(filas: readonly FilaDineroCruda[], tienda: string, clave: string) {
    const dto = fundirDinero(filas).get(claveDeGrupoProducto(tienda, clave));
    if (dto === undefined) {
      throw new Error(
        `la siembra NO produjo el grupo (${tienda}, ${clave}): el test FALLA en vez de abstenerse`,
      );
    }
    return dto;
  }

  // ==========================================================================================

  it("(a) R7/R43 · un adminTienda NO ve NI UNA fila de dinero de la otra tienda", () => {
    // ⚠ ESTA es la asercion que mata la mutacion M2 (sacar `tiendaId` del recorte). Es la
    // frontera multi-tenant medida donde vive: en el `WHERE` que Postgres ejecuta.
    expect(m.soloA.length).toBeGreaterThan(0);
    expect(m.soloB.length).toBeGreaterThan(0);

    expect(m.soloA.filter((f) => f.tiendaId !== m.tiendaA)).toEqual([]);
    expect(m.soloB.filter((f) => f.tiendaId !== m.tiendaB)).toEqual([]);
    expect(m.soloA.map((f) => f.tiendaId)).not.toContain(m.tiendaB);
    expect(m.soloB.map((f) => f.tiendaId)).not.toContain(m.tiendaA);

    // Y no es que la consulta venga vacia: el maestro SI ve las dos, asi que el recorte esta
    // quitando filas que EXISTEN. Sin este contrapeso, un `WHERE FALSE` pasaria el caso.
    expect(delTest(m.global, m.tiendaA).length).toBeGreaterThan(0);
    expect(delTest(m.global, m.tiendaB).length).toBeGreaterThan(0);
  });

  it("(a bis) el adminTienda ve TODO lo suyo: el recorte no se pasa de frenada", () => {
    const suyasSegunElMaestro = delTest(m.global, m.tiendaA).map((f) => f.gestionId).sort();
    const suyasSegunElla = m.soloA.map((f) => f.gestionId).sort();
    expect(suyasSegunElla).toEqual(suyasSegunElMaestro);
  });

  it("(a ter) y su DINERO tampoco se mezcla: las cifras de A no contienen las de B", () => {
    // Las dos tiendas venden el MISMO producto: si el recorte fallara, las cifras de A
    // incluirian los 10.000 de B. Se compara la cifra vista por A con la vista por el maestro
    // SOBRE EL GRUPO DE A: tienen que ser identicas, y distintas de las de B.
    const deA = cifras(m.soloA, m.tiendaA, CLAVE_BASE_C);
    const deAsegunMaestro = cifras(m.global, m.tiendaA, CLAVE_BASE_C);
    const deB = cifras(m.soloB, m.tiendaB, CLAVE_BASE_C);

    expect(deA).toEqual(deAsegunMaestro);
    expect(deB.recaudado).toBe("10000.00");
    expect(deA.recaudado).not.toBe(deB.recaudado);
    // Y el grupo de B NO existe en la lectura de A.
    expect(fundirDinero(m.soloA).get(claveDeGrupoProducto(m.tiendaB, CLAVE_BASE_C))).toBeUndefined();
  });

  it("(b) ⟨Q3⟩ · las gestiones ANULADAS quedan fuera, aunque hayan recaudado", () => {
    // MEDIDO en produccion: 2 gestiones anuladas con recaudo (₡33.564), las DOS fuera de todo
    // cierre y de todo snapshot. Ese dinero nunca entro en la contabilidad: mostrarlo seria
    // inventar ingreso. Aqui se siembra una anulada con ESE importe exacto.
    expect(m.soloA.some((f) => f.guia === m.guiaAnulada)).toBe(false);
    expect(m.soloA.map((f) => f.montoRecibido)).not.toContain("33564.00");
    // Y el importe no se cuela por ninguna via en las cifras del grupo.
    expect(JSON.stringify(cifras(m.soloA, m.tiendaA, CLAVE_BASE_C))).not.toContain("33564");
  });

  it("(c) R74 · una orden BORRADA no aporta, aunque su gestion recaudara", () => {
    expect(m.global.map((f) => f.montoRecibido)).not.toContain("99999.00");
    expect(m.soloA.map((f) => f.producto)).not.toContain("1 * Producto Borrado");
  });

  it("(d) R18 · la orden en DOS cierres trae DOS filas, cada una con SU snapshot", () => {
    const suyas = m.soloA.filter((f) => f.guia === m.guiaDosCierres);
    expect(suyas).toHaveLength(2);
    // Grano `(orden, gestion)`: dos gestiones, dos ids distintos.
    expect(new Set(suyas.map((f) => f.gestionId)).size).toBe(2);
    // Y cada una con las entradas congeladas de SU cierre: los `monto_cobrar` difieren.
    expect(suyas.map((f) => f.congelada?.montoCobrar).sort()).toEqual(["10000.00", "4000.00"].sort());
  });

  it("(e) R26 · un cierre SOLICITADO no liquida: su snapshot existe y su dinero es PENDIENTE", () => {
    const c = cifras(m.soloA, m.tiendaA, "producto solicitado");
    expect(c.recaudado).toBe("5000.00");
    expect(c.pendiente.recaudado).toBe("5000.00");
    expect(c.liquidado.recaudado).toBe("0.00");
    // ⚠ R30 — el reparto NO se emite en cero: se emite AUSENTE.
    expect(c.liquidado.ordenex).toBeNull();
    expect(c.liquidado.tienda).toBeNull();
    expect(c.liquidado.ordenes).toBe(0);
    expect(c.pendiente.ordenes).toBe(1);
  });

  it("(f) R23 · con cierre aprobado y SIN tarifa congelada tampoco se deriva nada", () => {
    const c = cifras(m.soloA, m.tiendaA, "producto sin tarifa");
    expect(c.recaudado).toBe("6000.00");
    expect(c.pendiente.recaudado).toBe("6000.00");
    expect(c.liquidado.ordenex).toBeNull();
  });

  it("(g) R12 · el importe COMPLETO de una orden multiproducto cuenta en CADA producto", () => {
    const enMelaxin = cifras(m.soloA, m.tiendaA, CLAVE_MELAXIN);
    // La orden acompanada recaudo 4.000 y es el UNICO aporte de `dr melaxin`.
    expect(enMelaxin.recaudado).toBe("4000.00");
    expect(enMelaxin.liquidado.ordenex).toBe("3616.00"); // 3000 + 390 + 200 + 26
    expect(enMelaxin.liquidado.tienda).toBe("384.00"); // 4000 - 3390 - 226

    // Y esos MISMOS 4.000 estan tambien dentro de `base c`: no se reparten, se repiten.
    const enBaseC = cifras(m.soloA, m.tiendaA, CLAVE_BASE_C);
    expect(new Prisma.Decimal(enBaseC.recaudado).gte("4000.00")).toBe(true);
  });

  it("(h) R11/R14/R15/R19/R20/R21 · las cifras del grupo, CALCULADAS A MANO", () => {
    const c = cifras(m.soloA, m.tiendaA, CLAVE_BASE_C);

    // Recaudado = 10.000 (liquidada) + 7.000 (pendiente) + 14.000 (dos cierres) + 4.000
    // (acompanada) = 35.000. La rechazada no recauda; la anulada no entra.
    expect(c.recaudado).toBe("35000.00");
    // Liquidado = 10.000 + 10.000 + 4.000 + 4.000 = 28.000.
    expect(c.liquidado.recaudado).toBe("28000.00");
    expect(c.pendiente.recaudado).toBe("7000.00");
    // Ordenex = 3.955 (liquidada) + 3.955 + 3.616 (dos cierres) + 3.616 (acompanada) = 15.142.
    // La rechazada NO aporta a `ordenex`: su cobro va en `retorno` (R19).
    expect(c.liquidado.ordenex).toBe("15142.00");
    expect(c.liquidado.tienda).toBe("12858.00"); // 28.000 - 15.142
    expect(c.retorno).toBe("2260.00"); // 2.000 + 13 %

    // R20, EXACTA y sin margen de redondeo.
    expect(new Prisma.Decimal(c.liquidado.ordenex!).plus(c.liquidado.tienda!).toFixed(2)).toBe(
      c.liquidado.recaudado,
    );
    // R21, EXACTA.
    expect(
      new Prisma.Decimal(c.liquidado.recaudado).plus(c.pendiente.recaudado).toFixed(2),
    ).toBe(c.recaudado);
    // ⚠ Y `retorno` NO esta dentro del reparto: si lo estuviera (mutacion M3), `ordenex` valdria
    // 17.402,00 y la igualdad de arriba se rompe.
    expect(c.liquidado.ordenex).not.toBe("17402.00");
  });

  it("(i) R18 · en los CARDINALES la orden de dos cierres cuenta UNA sola vez", () => {
    const c = cifras(m.soloA, m.tiendaA, CLAVE_BASE_C);
    // Liquidadas: la (1), la (4) —una vez, no dos— y la (6). Pendientes: la (2).
    expect(c.liquidado.ordenes).toBe(4); // incluye la rechazada, que tambien esta liquidada
    expect(c.pendiente.ordenes).toBe(1);
  });

  it("(j) R38/R40 · EL CUADRE — las CINCO aserciones sobre el detalle real", () => {
    if (m.detalleA.status !== "ok") {
      throw new Error(
        `el detalle salio ${m.detalleA.status}: la siembra no produjo el caso y el test FALLA ` +
          "en vez de abstenerse",
      );
    }
    const detalle = m.detalleA.datos;
    const fila = cifras(m.soloA, m.tiendaA, CLAVE_BASE_C);

    // 1. NO VACIA. Con una sola orden, «la suma cuadra» no dice nada.
    expect(detalle.ordenes.length).toBeGreaterThan(0);
    expect(detalle.total).toBeGreaterThan(1);

    // 2. NO CERO. Un cuadre entre ceros es cierto y vacio.
    expect(fila.liquidado.ordenex).not.toBe("0.00");
    expect(fila.liquidado.tienda).not.toBe("0.00");
    expect(fila.recaudado).not.toBe("0.00");

    // 3. SUMA IGUAL, LAS TRES, comparadas como STRING y sin convertir a numero.
    const suma = (f: (o: (typeof detalle.ordenes)[number]) => string | null): string => {
      let acc = new Prisma.Decimal(0);
      for (const o of detalle.ordenes) acc = acc.plus(new Prisma.Decimal(f(o) ?? "0"));
      return acc.toFixed(2);
    };
    // La pagina tiene que ser el conjunto ENTERO para que la suma valga: se afirma.
    expect(detalle.ordenes.length).toBe(detalle.total);
    expect(suma((o) => o.recaudado)).toBe(fila.recaudado);
    expect(suma((o) => o.ordenex)).toBe(fila.liquidado.ordenex);
    expect(suma((o) => o.tienda)).toBe(fila.liquidado.tienda);
    expect(suma((o) => o.retorno)).toBe(fila.retorno);

    // 4. CARDINAL IGUAL. Esta es la que hace que aflojar el `WHERE` duela: una orden de mas sube
    //    el cardinal aunque su aporte sea cero.
    expect(detalle.total).toBe(fila.liquidado.ordenes + fila.pendiente.ordenes);

    // 5. CONJUNTO LITERAL, escrito a mano. NO «la suma de lo que devuelve la funcion es lo que
    //    devuelve la funcion»: las guias exactas y los importes exactos que este test sembro.
    expect([...detalle.ordenes.map((o) => o.guia)].sort()).toEqual(
      [m.guiaLiquidada, m.guiaPendiente, m.guiaRechazada, m.guiaDosCierres, m.guiaAcompanada].sort(),
    );
    const porGuia = new Map(detalle.ordenes.map((o) => [o.guia, o]));
    expect(porGuia.get(m.guiaLiquidada)).toMatchObject({
      estado: "liquidada",
      recaudado: "10000.00",
      ordenex: "3955.00",
      tienda: "6045.00",
      retorno: "0.00",
    });
    expect(porGuia.get(m.guiaPendiente)).toMatchObject({
      estado: "pendiente",
      recaudado: "7000.00",
      ordenex: null,
      tienda: null,
      retorno: null,
    });
    expect(porGuia.get(m.guiaRechazada)).toMatchObject({
      estado: "liquidada",
      recaudado: "0.00",
      ordenex: "0.00",
      tienda: "0.00",
      retorno: "2260.00",
    });
    expect(porGuia.get(m.guiaDosCierres)).toMatchObject({
      estado: "liquidada",
      recaudado: "14000.00", // 10.000 + 4.000, sus DOS cierres sumados
      ordenex: "7571.00", // 3.955 + 3.616
      tienda: "6429.00", // 14.000 - 7.571
    });
    // Y aparece UNA sola vez, con dos resultados (R35).
    expect(detalle.ordenes.filter((o) => o.guia === m.guiaDosCierres)).toHaveLength(1);
    expect(porGuia.get(m.guiaDosCierres)?.resultados).toEqual(["entregada", "entregada"]);

    // 6 (R39). NINGUNA fila del detalle aporta cero en las CUATRO cifras.
    for (const o of detalle.ordenes) {
      const todasCero = [o.recaudado, o.ordenex, o.tienda, o.retorno].every(
        (v) => v === null || new Prisma.Decimal(v).isZero(),
      );
      expect(todasCero, `la orden ${o.guia} aporta cero en las cuatro cifras`).toBe(false);
    }

    // 7 (R38). Los `totales` de la cabecera son EXACTAMENTE la fila.
    expect(detalle.totales).toEqual(fila);
    // Y la anulada no esta en el detalle (⟨Q3⟩).
    expect(detalle.ordenes.map((o) => o.guia)).not.toContain(m.guiaAnulada);
  });

  it("(v4) EL CUADRE CONTRA LA BASE, con un SQL escrito A MANO y fuera del codigo de la ficha", () => {
    // ⚠ POR QUE ESTE CASO EXISTE. La leccion de la 344: un cuadre calculado por la MISMA funcion
    // que se prueba esta siempre verde. Aqui la formula se vuelve a escribir en SQL —flete +
    // IVA + comision + IVA, con las columnas CONGELADAS y sin llamar a `derivarIngresoOrden`— y
    // se compara con lo que produce el codigo sobre EXACTAMENTE las mismas filas.
    //
    // Y NO ES TAUTOLOGICO: la variante de abajo afloja UNA condicion del SQL y da otro numero.
    const { aMano, variante } = m.cuadreSql;
    const fila = cifras(m.soloA, m.tiendaA, CLAVE_BASE_C);

    // Las tres cifras del reparto, calculadas por dos caminos independientes.
    expect(aMano.recaudado).toBe(fila.liquidado.recaudado);
    expect(aMano.ordenex).toBe(fila.liquidado.ordenex);
    expect(aMano.tienda).toBe(fila.liquidado.tienda);
    // Y no es un cuadre entre ceros.
    expect(aMano.ordenex).not.toBe("0.00");
    expect(aMano.recaudado).not.toBe("0.00");

    // LA DEMOSTRACION DE QUE NO ES TAUTOLOGICO: quitar el filtro de `resultado = 'entregada'`
    // mete el flete de entrega de la RECHAZADA y sube `ordenex`. Si las dos consultas dieran lo
    // mismo, esta comparacion no estaria midiendo nada.
    expect(variante.ordenex).not.toBe(aMano.ordenex);
    expect(new Prisma.Decimal(variante.ordenex).gt(aMano.ordenex)).toBe(true);
  });

  it("(k) R22 · todo importe que sale del repositorio es STRING escala 2", () => {
    for (const f of m.global) {
      if (f.montoRecibido !== null) expect(f.montoRecibido).toMatch(/^-?\d+\.\d{2}$/);
      const tarifa = f.congelada?.tarifa;
      if (tarifa) {
        for (const [k, v] of Object.entries(tarifa)) {
          if (v !== null) expect(v as string, k).toMatch(/^-?\d+\.\d{2}$/);
        }
      }
    }
  });

  // ------------------------------------------------------------------------------------------
  // Sembradores. Ninguno se abstiene: si falta un catalogo, LANZA.
  // ------------------------------------------------------------------------------------------

  async function crearUsuario(tx: Tx, nombre: string): Promise<string> {
    const rol = await tx.rol.findFirst({ select: { id: true } });
    const tipo = await tx.tipoIdentificacion.findFirst({ select: { id: true } });
    if (!rol || !tipo) {
      throw new Error(
        "La base de pruebas no tiene catalogos `rol`/`tipo_identificacion` sembrados: corre " +
          "`pnpm db:seed`. Este test NO se salta en ese caso a proposito.",
      );
    }
    const sufijo = randomUUID().slice(0, 8);
    const { id } = await tx.usuario.create({
      data: {
        nombre: `${nombre} ${sufijo}`,
        email: `t347-${sufijo}@example.test`,
        telefono: "00000000",
        passwordHash: "x",
        cedula: `t347${sufijo}`,
        tipoIdentificacionId: tipo.id,
        rolId: rol.id,
      },
      select: { id: true },
    });
    return id;
  }

  async function crearTarifa(tx: Tx): Promise<string> {
    const { id } = await tx.tarifa.create({ data: { ...TARIFA }, select: { id: true } });
    return id;
  }

  async function crearCierre(tx: Tx, mensajeroId: string, estado: string): Promise<string> {
    const zona = await tx.zona.findFirst({ select: { id: true } });
    if (!zona) throw new Error("sin `zona` sembrada no se puede crear el cierre del test");
    const { id } = await tx.cierreDia.create({
      data: {
        mensajeroId,
        estado: estado as never,
        destinoTipo: "bodega_central",
        destinoZonaId: zona.id,
      },
      select: { id: true },
    });
    return id;
  }

  async function crearOrden(tx: Tx, tiendaId: string, producto: string): Promise<string> {
    const canton = await tx.canton.findFirst({ select: { id: true, provinciaId: true } });
    const zona = await tx.zona.findFirst({ select: { id: true } });
    const estatus = await tx.orderStatus.findFirst({ select: { id: true } });
    if (!canton || !zona || !estatus) {
      throw new Error(
        "La base de pruebas no tiene catalogos de geografia/estatus sembrados: corre " +
          "`pnpm db:seed`. Este test NO se salta en ese caso a proposito.",
      );
    }
    const sufijo = randomUUID().slice(0, 12);
    const { id } = await tx.orden.create({
      data: {
        numRemision: `t347-${sufijo}`,
        estatusId: estatus.id,
        destinatario: "Destinatario de prueba",
        telefonoDest: "00000000",
        tiendaId,
        zonaId: zona.id,
        provinciaId: canton.provinciaId,
        cantonId: canton.id,
        producto,
      },
      select: { id: true },
    });
    return id;
  }

  /** El numero VISIBLE de la orden, con la MISMA regla que el repositorio (guia, si no remision). */
  async function guiaDe(tx: Tx, ordenId: string): Promise<string> {
    const o = await tx.orden.findUniqueOrThrow({
      where: { id: ordenId },
      select: { numGuia: true, numRemision: true },
    });
    return o.numGuia === null ? o.numRemision : String(o.numGuia);
  }

  /** La fila de `cierre_detail`: las ENTRADAS congeladas de esa orden en ese cierre. */
  async function congelar(
    tx: Tx,
    cierreId: string,
    ordenId: string,
    tarifaId: string | null,
    montoCobrar: string,
    tiendaId?: string,
  ): Promise<void> {
    const orden = await tx.orden.findUniqueOrThrow({
      where: { id: ordenId },
      select: {
        tiendaId: true,
        zonaId: true,
        numRemision: true,
        destinatario: true,
        producto: true,
      },
    });
    await tx.cierreDetail.create({
      data: {
        cierreId,
        ordenId,
        montoCobrar,
        cobraComision: true,
        zonaId: orden.zonaId,
        tiendaId: tiendaId ?? orden.tiendaId,
        esCentral: false,
        esZonaEspecial: false,
        tarifaId,
        // Las columnas de tarifa se congelan TODAS o NINGUNA (R8 de la feature 69).
        ...(tarifaId === null
          ? {}
          : {
              tarifaValorFlete: TARIFA.valorFlete,
              tarifaValorFleteGam: TARIFA.valorFleteGam,
              tarifaValorFleteDevuelto: TARIFA.valorFleteDevuelto,
              tarifaValorFleteDevueltoGam: TARIFA.valorFleteDevueltoGam,
              tarifaComisionCod: TARIFA.comisionCod,
              tarifaIvaFlete: TARIFA.ivaFlete,
              tarifaIvaComisionCod: TARIFA.ivaComisionCod,
            }),
        numRemision: orden.numRemision,
        destinatario: orden.destinatario,
        producto: orden.producto,
        tiendaNombre: "Tienda congelada",
        zonaNombre: "Zona congelada",
        provinciaNombre: "Provincia congelada",
        cantonNombre: "Canton congelado",
      },
    });
  }

  async function crearGestion(
    tx: Tx,
    ordenId: string,
    mensajeroId: string,
    resultado: "entregada" | "rechazada",
    montoRecibido: string | null,
    cierreId: string | null,
    opts: { anulada?: boolean } = {},
  ): Promise<void> {
    await tx.gestionOrden.create({
      data: {
        ordenId,
        mensajeroId,
        resultado,
        montoRecibido,
        cierreId,
        anuladaAt: opts.anulada === true ? new Date() : null,
      },
    });
  }
});

/** Las filas de una lectura que TIENE que haber salido `ok`. Si no, el test falla. */
function filasDe(
  lectura: Awaited<ReturnType<DineroProductosRepository["leerDineroPorOrden"]>>,
): readonly FilaDineroCruda[] {
  if (lectura.estado !== "ok") {
    throw new Error(`la lectura de dinero salio ${lectura.estado}: el test FALLA, no se abstiene`);
  }
  return lectura.filas;
}
