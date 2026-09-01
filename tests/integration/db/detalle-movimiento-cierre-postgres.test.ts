import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient, type GestionResultado } from "@prisma/client";

import { CierreAporteRepository } from "@/lib/repositories/CierreAporteRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import { DetalleMovimientoService } from "@/lib/services/DetalleMovimientoService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";
import type { WalletMovimientoCategoria } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * Ficha 344 (T5.1, design §6) — EL DETALLE DE UNA FILA DEL LIBRO, CONTRA POSTGRES DE VERDAD.
 * Cubre **R16, R17, R19, R20, R23, R24, R28, R30, R40 y R41**.
 *
 * ── Por que un doble no sirve para esto ───────────────────────────────────────────────────
 *
 * En este repo esta medido CUATRO veces que una mutacion del `WHERE` pasa en verde por delante
 * de un doble: el doble devuelve lo que se le programo, no lo que el motor selecciona. Todo lo
 * que esta ficha promete es una propiedad del `WHERE`:
 *
 *  1. el detalle trae EXACTAMENTE las ordenes que aportan a ese concepto — ni una de mas;
 *  2. la Σ de TODAS las paginas es, centimo a centimo, el importe de la fila;
 *  3. el `total` sale de un `count` del conjunto, no del largo del `take`;
 *  4. una tienda no ve ni una fila de otra, en el MISMO cierre;
 *  5. el movimiento de otra tienda responde «no encontrado»;
 *  6. paginar no repite ni omite una orden.
 *
 * ── Por que el importe de la fila NO se escribe a mano ────────────────────────────────────
 *
 * Los movimientos de la semilla los produce **el feed REAL** (`WalletFeedService` y
 * `WalletTiendaFeedService`), el mismo que corre dentro de la transaccion de aprobacion en
 * produccion. Si el importe se escribiera a mano, el cuadre compararia el detalle contra un
 * numero inventado por el test —una asercion contra su propia fuente— y no probaria nada.
 *
 * ── Aislamiento y no-vacuidad ─────────────────────────────────────────────────────────────
 *
 * Todo corre dentro de una transaccion que SIEMPRE se revierte: pase, falle o muera el runner,
 * no queda ni una fila de dinero inventada. Las tiendas, el mensajero, las ordenes y el cierre
 * son NUEVOS en cada caso, asi que ningun dato ajeno entra. **No hay ni un `return` mudo**: si
 * falta un dato previo (una zona, una tarifa, un estado), el caso FALLA con su motivo.
 *
 * Sin base alcanzable la suite se SALTA (no falla), como el resto de `tests/integration/db`.
 *
 * ── Las CUATRO mutaciones exigidas ────────────────────────────────────────────────────────
 *
 * Ejecutadas, revertidas y anotadas con su salida REAL en `progress/impl_344.md`: quitar la
 * restriccion de `resultado` del `WHERE`, quitar el `tiendaId` de cada una de las dos lecturas
 * y devolver `items.length` como `total`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const MAESTRO: Actor = { usuarioId: "u-maestro-344", rol: "maestro" };

/** La tarifa CONGELADA de las ordenes que la tienen. Porcentajes con decimales de verdad. */
const TARIFA_CONGELADA = {
  tarifaValorFleteGam: "1500.00",
  tarifaValorFleteDevuelto: "400.00",
  tarifaValorFleteDevueltoGam: "600.00",
  tarifaComisionCod: "5.00",
  tarifaIvaFlete: "13.00",
  tarifaIvaComisionCod: "13.00",
};

interface Semilla {
  clave: string;
  tienda: "A" | "B";
  /** El `num_guia` CONGELADO en `cierre_detail` (copia, SIN unique): admite duplicado y NULL. */
  numGuia: number | null;
  /** `null` = la tienda no tenia tarifa vigente al solicitar (gap R9). */
  valorFlete: string | null;
  montoCobrar: string | null;
  cobraComision: boolean;
  gestiones: Array<{ resultado: GestionResultado; montoRecibido: string | null }>;
}

/**
 * El cierre sembrado: NUEVE ordenes, una por caso que importa, y con importes DISTINTOS para que
 * un intruso se pueda nombrar por su cifra en vez de por un total ambiguo.
 */
const SEMILLA: Semilla[] = [
  {
    clave: "entregada-con-cod",
    tienda: "A",
    numGuia: 501,
    valorFlete: "1000.00",
    montoCobrar: "14900.00",
    cobraComision: true,
    gestiones: [{ resultado: "entregada", montoRecibido: "14900.00" }],
  },
  {
    // Cobra comision y NO tenia COD: su aporte a la comision es 0,00 y NO se muestra (Q2).
    clave: "entregada-sin-cod",
    tienda: "A",
    numGuia: 502,
    valorFlete: "2000.00",
    montoCobrar: null,
    cobraComision: true,
    gestiones: [{ resultado: "entregada", montoRecibido: null }],
  },
  {
    clave: "rechazada",
    tienda: "A",
    numGuia: 503,
    valorFlete: "3000.00",
    montoCobrar: "9000.00",
    cobraComision: true,
    gestiones: [{ resultado: "rechazada", montoRecibido: null }],
  },
  {
    clave: "devuelta",
    tienda: "A",
    numGuia: 504,
    valorFlete: "4000.00",
    montoCobrar: "1000.00",
    cobraComision: true,
    gestiones: [{ resultado: "devuelta", montoRecibido: null }],
  },
  {
    clave: "reprogramada",
    tienda: "A",
    numGuia: 505,
    valorFlete: "4500.00",
    montoCobrar: "1000.00",
    cobraComision: true,
    gestiones: [{ resultado: "reprogramada", montoRecibido: "250.00" }],
  },
  {
    clave: "incidente",
    tienda: "A",
    numGuia: 506,
    valorFlete: "4600.00",
    montoCobrar: "1000.00",
    cobraComision: true,
    gestiones: [{ resultado: "incidente", montoRecibido: null }],
  },
  {
    // R23: entregada, pero SIN tarifa congelada. No aporta a ningun concepto derivado.
    clave: "sin-tarifa",
    tienda: "A",
    numGuia: 507,
    valorFlete: null,
    montoCobrar: "20000.00",
    cobraComision: true,
    gestiones: [{ resultado: "entregada", montoRecibido: "20000.00" }],
  },
  {
    // R20: DOS gestiones de la MISMA orden en el MISMO cierre. Y su guia congelada REPITE la de
    // «entregada-sin-cod» (502): es lo que fuerza el desempate del orden total (R30).
    clave: "dos-gestiones",
    tienda: "A",
    numGuia: 502,
    valorFlete: "5000.00",
    montoCobrar: "8000.00",
    cobraComision: true,
    gestiones: [
      { resultado: "entregada", montoRecibido: "3000.00" },
      { resultado: "entregada", montoRecibido: "5000.00" },
    ],
  },
  {
    // R40: OTRA TIENDA en el MISMO cierre. Guia congelada NULA: comprueba el `nulls last`.
    clave: "de-la-tienda-b",
    tienda: "B",
    numGuia: null,
    valorFlete: "777.00",
    montoCobrar: "1000.00",
    cobraComision: false,
    gestiones: [{ resultado: "entregada", montoRecibido: "1000.00" }],
  },
];

interface Sembrado {
  cierreId: string;
  tiendaA: string;
  tiendaB: string;
  ordenPorClave: Map<string, string>;
  servicio: DetalleMovimientoService;
  /** El id del movimiento de la CAJA de esa categoria, o `null` si el feed no lo emitio. */
  movimientoCaja(categoria: WalletMovimientoCategoria): Promise<string | null>;
  movimientoTienda(
    tiendaId: string,
    categoria: WalletTiendaMovimientoCategoria,
  ): Promise<string | null>;
  montoCaja(categoria: WalletMovimientoCategoria): Promise<string>;
  montoTienda(tiendaId: string, categoria: WalletTiendaMovimientoCategoria): Promise<string>;
}

/** Un usuario nuevo, con los FK que la tabla exige tomados de una fila existente. */
async function crearUsuario(
  tx: Tx,
  base: { rolId: string; tipoIdentificacionId: string },
  nombre: string,
): Promise<string> {
  const id = randomUUID();
  await tx.usuario.create({
    data: {
      id,
      nombre,
      email: `ficha344-${id}@test.local`,
      telefono: "00000000",
      passwordHash: "x",
      cedula: `344-${id}`,
      tipoIdentificacionId: base.tipoIdentificacionId,
      rolId: base.rolId,
    },
  });
  return id;
}

/**
 * Siembra un cierre APROBADO completo —ordenes, snapshot congelado, gestiones— y emite sus
 * movimientos con LOS FEEDS REALES. Devuelve todo lo necesario para interrogar el detalle.
 *
 * Si falta un dato previo en la base (una orden de la que tomar los FK, un usuario del que tomar
 * el rol, o una tarifa a la que apuntar), FALLA con su motivo: un `return` mudo reportaria
 * `passed` sin haber comprobado una linea.
 */
async function sembrar(tx: Tx, semilla: Semilla[] = SEMILLA): Promise<Sembrado> {
  await serializarEscriturasReales(tx);

  const fk = await tx.orden.findFirst({
    select: { estatusId: true, zonaId: true, provinciaId: true, cantonId: true },
  });
  expect(
    fk,
    "la base no tiene ni una orden de la que tomar los FK (estatus/zona/provincia/canton): el caso no puede sembrar",
  ).not.toBeNull();
  const base = await tx.usuario.findFirst({
    select: { rolId: true, tipoIdentificacionId: true },
  });
  expect(base, "la base no tiene ni un usuario del que tomar rol y tipo de identificacion").not.toBeNull();
  const tarifa = await tx.tarifa.findFirst({ select: { id: true } });
  expect(tarifa, "la base no tiene ni una tarifa a la que apuntar `cierre_detail.tarifa_id`").not.toBeNull();

  const fks = fk!;
  const usuarioBase = base!;
  const tarifaId = tarifa!.id;

  const mensajeroId = await crearUsuario(tx, usuarioBase, "Mensajero 344");
  const tiendaA = await crearUsuario(tx, usuarioBase, "Tienda A 344");
  const tiendaB = await crearUsuario(tx, usuarioBase, "Tienda B 344");
  const idDeTienda = { A: tiendaA, B: tiendaB };
  const nombreDeTienda = { A: "Tienda A 344", B: "Tienda B 344" };

  const cierreId = randomUUID();
  await tx.cierreDia.create({
    data: {
      id: cierreId,
      mensajeroId,
      estado: "aprobado",
      destinoTipo: "bodega_central",
      destinoZonaId: fks.zonaId,
      solicitadoAt: new Date("2026-08-20T18:30:00.000Z"),
    },
  });

  const ordenPorClave = new Map<string, string>();
  for (const fila of semilla) {
    const ordenId = randomUUID();
    ordenPorClave.set(fila.clave, ordenId);
    await tx.orden.create({
      data: {
        id: ordenId,
        // `num_guia` de la ORDEN se deja NULL: es UNIQUE global y esta suite no compite por el.
        // El numero que el detalle ensena es el CONGELADO de `cierre_detail`, mas abajo.
        numRemision: `REM-344-${fila.clave}`,
        estatusId: fks.estatusId,
        destinatario: `Destinatario ${fila.clave}`,
        telefonoDest: "00000000",
        tiendaId: idDeTienda[fila.tienda],
        zonaId: fks.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
        producto: "Caja",
        montoCobrar: fila.montoCobrar === null ? null : new Prisma.Decimal(fila.montoCobrar),
        cobraComision: fila.cobraComision,
      },
    });
    await tx.cierreDetail.create({
      data: {
        cierreId,
        ordenId,
        montoCobrar: fila.montoCobrar === null ? null : new Prisma.Decimal(fila.montoCobrar),
        cobraComision: fila.cobraComision,
        zonaId: fks.zonaId,
        tiendaId: idDeTienda[fila.tienda],
        esCentral: false,
        esZonaEspecial: false,
        ...(fila.valorFlete === null
          ? {}
          : {
              tarifaId,
              tarifaValorFlete: new Prisma.Decimal(fila.valorFlete),
              tarifaValorFleteGam: new Prisma.Decimal(TARIFA_CONGELADA.tarifaValorFleteGam),
              tarifaValorFleteDevuelto: new Prisma.Decimal(
                TARIFA_CONGELADA.tarifaValorFleteDevuelto,
              ),
              tarifaValorFleteDevueltoGam: new Prisma.Decimal(
                TARIFA_CONGELADA.tarifaValorFleteDevueltoGam,
              ),
              tarifaComisionCod: new Prisma.Decimal(TARIFA_CONGELADA.tarifaComisionCod),
              tarifaIvaFlete: new Prisma.Decimal(TARIFA_CONGELADA.tarifaIvaFlete),
              tarifaIvaComisionCod: new Prisma.Decimal(TARIFA_CONGELADA.tarifaIvaComisionCod),
            }),
        numGuia: fila.numGuia,
        numRemision: `REM-344-${fila.clave}`,
        destinatario: `Destinatario ${fila.clave}`,
        producto: "Caja",
        tiendaNombre: nombreDeTienda[fila.tienda],
        zonaNombre: "Zona 344",
        provinciaNombre: "Provincia 344",
        cantonNombre: "Canton 344",
      },
    });
    for (const g of fila.gestiones) {
      await tx.gestionOrden.create({
        data: {
          ordenId,
          mensajeroId,
          resultado: g.resultado,
          montoRecibido: g.montoRecibido === null ? null : new Prisma.Decimal(g.montoRecibido),
          cierreId,
        },
      });
    }
  }

  // Los movimientos los emiten LOS FEEDS REALES, no el test.
  const cliente = tx as unknown as PrismaClient;
  const movsCaja = await new WalletFeedService().construirMovimientosDeIngreso(cierreId, tx);
  expect(movsCaja.length, "el feed de la caja no emitio ni un movimiento: la semilla no factura").toBeGreaterThan(0);
  expect(await new WalletMovimientoRepository(cliente).crearMovimientos(cliente, movsCaja)).toBe(
    movsCaja.length,
  );
  const movsTienda = await new WalletTiendaFeedService().construirMovimientosPorTienda(cierreId, tx);
  expect(movsTienda.length, "el feed del ledger por tienda no emitio ni un movimiento").toBeGreaterThan(0);
  expect(
    await new WalletTiendaMovimientoRepository(cliente).crearMovimientos(cliente, movsTienda),
  ).toBe(movsTienda.length);

  const servicio = new DetalleMovimientoService(
    new WalletMovimientoRepository(cliente),
    new WalletTiendaMovimientoRepository(cliente),
    new CierreAporteRepository(cliente),
  );

  const filaCaja = (categoria: WalletMovimientoCategoria) =>
    tx.walletMovimiento.findFirst({
      where: { origenTipo: "cierre_dia", origenId: cierreId, categoria },
      select: { id: true, monto: true },
    });
  const filaTienda = (tiendaId: string, categoria: WalletTiendaMovimientoCategoria) =>
    tx.walletTiendaMovimiento.findFirst({
      where: { origenTipo: "cierre_dia", origenId: cierreId, tiendaId, categoria },
      select: { id: true, monto: true },
    });

  return {
    cierreId,
    tiendaA,
    tiendaB,
    ordenPorClave,
    servicio,
    movimientoCaja: async (categoria) => (await filaCaja(categoria))?.id ?? null,
    movimientoTienda: async (tiendaId, categoria) =>
      (await filaTienda(tiendaId, categoria))?.id ?? null,
    montoCaja: async (categoria) => {
      const f = await filaCaja(categoria);
      expect(f, `el feed no emitio el movimiento de caja ${categoria}`).not.toBeNull();
      return f!.monto.toFixed(2);
    },
    montoTienda: async (tiendaId, categoria) => {
      const f = await filaTienda(tiendaId, categoria);
      expect(f, `el feed no emitio el movimiento de tienda ${categoria}`).not.toBeNull();
      return f!.monto.toFixed(2);
    },
  };
}

/** El id del movimiento de caja de esa categoria; FALLA si el feed no lo emitio. */
async function exigirMovimientoCaja(
  s: Sembrado,
  categoria: WalletMovimientoCategoria,
): Promise<string> {
  const id = await s.movimientoCaja(categoria);
  expect(id, `el feed no emitio el movimiento de caja ${categoria}: no hay fila que abrir`).not.toBeNull();
  return id!;
}

/** Recorre TODAS las paginas del detalle de un movimiento y devuelve sus ordenes. */
async function todasLasPaginas(
  leer: (page: number) => Promise<{ ordenes: OrdenAporteDTO[]; total: number }>,
  pageSize: number,
): Promise<{ ordenes: OrdenAporteDTO[]; total: number; paginas: number }> {
  const ordenes: OrdenAporteDTO[] = [];
  let page = 1;
  let total = -1;
  do {
    const r = await leer(page);
    total = r.total;
    ordenes.push(...r.ordenes);
    page += 1;
  } while (ordenes.length < total && page <= total + 1);
  expect(ordenes.length, "no se recorrio el conjunto entero").toBe(total);
  return { ordenes, total, paginas: page - 1 };
}

/** Σ money-safe de una lista de importes STRING. */
function sumar(importes: readonly string[]): string {
  return importes.reduce((s, v) => s.plus(new Prisma.Decimal(v)), new Prisma.Decimal(0)).toFixed(2);
}

describeSiHayBase("ficha 344 — el detalle de un movimiento contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("el detalle trae solo las ordenes que aportan a ese concepto (R16/R19)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const movimientoId = await exigirMovimientoCaja(s, "ingreso_flete");

      const r = await s.servicio.verDetalleDeMovimiento(
        { movimientoId, page: 1, pageSize: 50 },
        MAESTRO,
      );
      if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);

      // Las CUATRO entregas con tarifa, y ninguna mas. Comparacion por conjunto de ids: un
      // conteo igual con filas distintas pasaria.
      const esperadas = ["entregada-con-cod", "entregada-sin-cod", "dos-gestiones", "de-la-tienda-b"];
      expect(new Set(r.data.ordenes.map((o) => o.ordenId))).toEqual(
        new Set(esperadas.map((c) => s.ordenPorClave.get(c))),
      );
      expect(r.data.total).toBe(4);
      // Y el «de M»: el cierre tiene NUEVE ordenes. Es la frase que el humano fue a buscar.
      expect(r.data.ordenesDelCierre).toBe(9);

      // Los intrusos, uno a uno y por su nombre: quitar la restriccion de `resultado` del
      // `WHERE` mete estos cinco y el caso cae nombrandolos.
      const vistos = new Set(r.data.ordenes.map((o) => o.ordenId));
      for (const intruso of ["rechazada", "devuelta", "reprogramada", "incidente", "sin-tarifa"]) {
        expect(vistos.has(s.ordenPorClave.get(intruso)!), `se colo la orden «${intruso}»`).toBe(false);
      }
    });
  });

  it("la suma de todas las paginas es el importe del movimiento, centimo a centimo (R17)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);

      // Los SEIS conceptos del feed, no solo el flete: si el criterio de uno divergiera, su
      // suma dejaria de cuadrar aunque las demas cuadren.
      const conceptos: WalletMovimientoCategoria[] = [
        "ingreso_flete",
        "ingreso_iva_flete",
        "ingreso_flete_devolucion",
        "ingreso_iva_flete_devolucion",
        "ingreso_comision_cod",
        "ingreso_iva_comision_cod",
      ];
      for (const categoria of conceptos) {
        const movimientoId = await exigirMovimientoCaja(s, categoria);
        const importe = await s.montoCaja(categoria);
        // Paginas de UNA orden: se recorre el conjunto entero a proposito, para que la Σ no
        // pueda cuadrar por caber toda en la primera pagina.
        const { ordenes, total } = await todasLasPaginas(async (page) => {
          const r = await s.servicio.verDetalleDeMovimiento(
            { movimientoId, page, pageSize: 1 },
            MAESTRO,
          );
          if (r.status !== "ok") throw new Error(`${categoria}: esperado ok, llego ${r.status}`);
          return r.data;
        }, 1);

        expect(sumar(ordenes.map((o) => o.aporte)), `${categoria}: la Σ del detalle no es el importe de la fila`).toBe(
          importe,
        );
        // Y NINGUNA fila aporta 0,00. No es cosmetica: sin esta linea, quitar la restriccion de
        // `resultado` del `WHERE` metería ordenes que no aportan, su aporte saldria 0,00 y la Σ
        // SEGUIRIA cuadrando —medido, no supuesto: la mutacion 1 dejaba este caso en verde—.
        for (const o of ordenes) {
          expect(
            new Prisma.Decimal(o.aporte).gt(0),
            `${categoria}: la orden ${o.guia} aporta 0,00 y no deberia estar en el detalle`,
          ).toBe(true);
        }
        // No-vacuidad: la fila TIENE dinero y TIENE ordenes. Un `0.00 === 0.00` sobre un
        // conjunto vacio pasaria sin probar nada.
        expect(total, `${categoria} no trajo ordenes`).toBeGreaterThan(0);
        expect(new Prisma.Decimal(importe).gt(0), `${categoria} vale 0.00`).toBe(true);
      }
    });
  });

  it("de las nueve ordenes del cierre solo aportan las que el criterio admite, y no se muestran los ceros", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const movimientoId = await exigirMovimientoCaja(s, "ingreso_comision_cod");
      const r = await s.servicio.verDetalleDeMovimiento(
        { movimientoId, page: 1, pageSize: 50 },
        MAESTRO,
      );
      if (r.status !== "ok") throw new Error("esperado ok");

      // «entregada-sin-cod» COBRA comision y esta ENTREGADA con tarifa: su concepto queda
      // DEFINIDO y vale 0,00. La decision del humano (Q2) es no mostrarlo, y el filtro va en el
      // `WHERE`, asi que el `total` tampoco la cuenta.
      expect(new Set(r.data.ordenes.map((o) => o.ordenId))).toEqual(
        new Set([
          s.ordenPorClave.get("entregada-con-cod"),
          s.ordenPorClave.get("dos-gestiones"),
        ]),
      );
      expect(r.data.total).toBe(2);
      expect(r.data.ordenes.map((o) => o.aporte).some((a) => a === "0.00")).toBe(false);
      // Y la Σ sigue siendo el importe de la fila: lo que aporta cero no cambia la suma.
      expect(sumar(r.data.ordenes.map((o) => o.aporte))).toBe(
        await s.montoCaja("ingreso_comision_cod"),
      );
    });
  });

  it("una orden con dos gestiones sale una vez con el aporte sumado (R20)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const movimientoId = await exigirMovimientoCaja(s, "ingreso_flete");
      const r = await s.servicio.verDetalleDeMovimiento(
        { movimientoId, page: 1, pageSize: 50 },
        MAESTRO,
      );
      if (r.status !== "ok") throw new Error("esperado ok");

      const dos = r.data.ordenes.filter(
        (o) => o.ordenId === s.ordenPorClave.get("dos-gestiones"),
      );
      expect(dos, "la orden con dos gestiones no salio exactamente una vez").toHaveLength(1);
      // 5 000,00 de flete por CADA una de sus dos gestiones entregadas.
      expect(dos[0].aporte).toBe("10000.00");
      expect(dos[0].resultados).toEqual(["entregada", "entregada"]);
      // Y la Σ del conjunto sigue cuadrando con esa fila dentro.
      expect(sumar(r.data.ordenes.map((o) => o.aporte))).toBe(await s.montoCaja("ingreso_flete"));
    });
  });

  it("la orden sin tarifa congelada no aparece y no altera la suma (R23)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const sinTarifa = s.ordenPorClave.get("sin-tarifa")!;

      for (const categoria of [
        "ingreso_flete",
        "ingreso_iva_flete",
        "ingreso_comision_cod",
      ] as const) {
        const movimientoId = await exigirMovimientoCaja(s, categoria);
        const r = await s.servicio.verDetalleDeMovimiento(
          { movimientoId, page: 1, pageSize: 50 },
          MAESTRO,
        );
        if (r.status !== "ok") throw new Error("esperado ok");
        expect(
          r.data.ordenes.map((o) => o.ordenId),
          `la orden sin tarifa aparecio en ${categoria}`,
        ).not.toContain(sinTarifa);
        expect(sumar(r.data.ordenes.map((o) => o.aporte))).toBe(await s.montoCaja(categoria));
      }

      // No-vacuidad: la orden EXISTE en el cierre (esta contada en el «de M») y ademas SI aporta
      // al credito COD de su tienda, que no depende de la tarifa.
      const credito = await s.movimientoTienda(s.tiendaA, "cod_recaudado");
      expect(credito).not.toBeNull();
      const cod = await s.servicio.verDetalleDeMiMovimiento(
        { movimientoId: credito!, page: 1, pageSize: 50 },
        { usuarioId: s.tiendaA, rol: "adminTienda" },
      );
      if (cod.status !== "ok") throw new Error("esperado ok");
      expect(cod.data.ordenes.map((o) => o.ordenId)).toContain(sinTarifa);
    });
  });

  it("el detalle devuelve una pagina y el total es el del conjunto, no el largo de la pagina (R24/R28)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const movimientoId = await exigirMovimientoCaja(s, "ingreso_flete");

      // Cuatro ordenes aportan: con `pageSize: 1` son `pageSize + 3`.
      const pageSize = 1;
      const paginas = [];
      for (const page of [1, 2, 3, 4]) {
        const r = await s.servicio.verDetalleDeMovimiento({ movimientoId, page, pageSize }, MAESTRO);
        if (r.status !== "ok") throw new Error("esperado ok");
        paginas.push(r.data);
      }

      // El `total` es 4 en las CUATRO paginas: lo cuenta la base, no el largo de la pagina. Un
      // `total = ordenes.length` daria 1, 1, 1 y 1, y este caso cae con los cuatro numeros.
      expect(paginas.map((p) => p.total)).toEqual([4, 4, 4, 4]);
      expect(paginas.map((p) => p.ordenes.length)).toEqual([1, 1, 1, 1]);
      expect(paginas[0].total).not.toBe(paginas[0].ordenes.length);
      expect(paginas.map((p) => p.page)).toEqual([1, 2, 3, 4]);
    });
  });

  it("recorrer las paginas devuelve cada orden exactamente una vez (R30)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const movimientoId = await exigirMovimientoCaja(s, "ingreso_flete");

      const { ordenes, total } = await todasLasPaginas(async (page) => {
        const r = await s.servicio.verDetalleDeMovimiento(
          { movimientoId, page, pageSize: 1 },
          MAESTRO,
        );
        if (r.status !== "ok") throw new Error("esperado ok");
        return r.data;
      }, 1);

      // Dos de las cuatro comparten `num_guia` congelada (502) y una la tiene NULA: sin el
      // desempate por `id` y el `nulls last`, aqui se repite u omite una fila.
      const ids = ordenes.map((o) => o.ordenId);
      expect(ids).toHaveLength(total);
      expect(new Set(ids).size, "una orden salio dos veces o falto").toBe(total);
      expect(new Set(ids)).toEqual(
        new Set(
          ["entregada-con-cod", "entregada-sin-cod", "dos-gestiones", "de-la-tienda-b"].map((c) =>
            s.ordenPorClave.get(c),
          ),
        ),
      );
      // Y el orden es el declarado: guia ascendente, nulos al final.
      expect(ordenes.map((o) => o.guia)).toEqual([
        "501",
        "502",
        "502",
        "REM-344-de-la-tienda-b", // sin guia congelada -> su remision, y va la ULTIMA
      ]);
    });
  });

  it("la tienda no ve ni una orden de otra tienda del mismo cierre (R40)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const actorA: Actor = { usuarioId: s.tiendaA, rol: "adminTienda" };
      const debitoA = await s.movimientoTienda(s.tiendaA, "flete");
      expect(debitoA, "el feed no emitio el debito de flete de la tienda A").not.toBeNull();

      const r = await s.servicio.verDetalleDeMiMovimiento(
        { movimientoId: debitoA!, page: 1, pageSize: 50 },
        actorA,
      );
      if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);

      // Ni una orden de la B, que ESTA en el mismo cierre y SI aporta al flete de la caja.
      const deLaB = s.ordenPorClave.get("de-la-tienda-b")!;
      expect(r.data.ordenes.map((o) => o.ordenId), "se colo la orden de la otra tienda").not.toContain(
        deLaB,
      );
      expect(new Set(r.data.ordenes.map((o) => o.tiendaNombre))).toEqual(new Set(["Tienda A 344"]));
      expect(r.data.total).toBe(3);
      // El «de M» tambien esta acotado: A tiene 8 de las 9 ordenes del cierre.
      expect(r.data.ordenesDelCierre).toBe(8);
      // Σ === el debito de A, y NO el de la caja (que incluye a la B).
      expect(sumar(r.data.ordenes.map((o) => o.aporte))).toBe(
        await s.montoTienda(s.tiendaA, "flete"),
      );
      expect(sumar(r.data.ordenes.map((o) => o.aporte))).not.toBe(
        await s.montoCaja("ingreso_flete"),
      );
      // R15: y sin el nombre del mensajero.
      expect(r.data.cierre.mensajeroNombre).toBeNull();

      // No-vacuidad: la orden de la B EXISTE y se ve desde el libro de la B, con su importe.
      const debitoB = await s.movimientoTienda(s.tiendaB, "flete");
      expect(debitoB).not.toBeNull();
      const rb = await s.servicio.verDetalleDeMiMovimiento(
        { movimientoId: debitoB!, page: 1, pageSize: 50 },
        { usuarioId: s.tiendaB, rol: "adminTienda" },
      );
      if (rb.status !== "ok") throw new Error("esperado ok");
      expect(rb.data.ordenes.map((o) => o.ordenId)).toEqual([deLaB]);
      expect(rb.data.ordenes[0].aporte).toBe("777.00");
      expect(rb.data.ordenesDelCierre).toBe(1);
    });
  });

  it("el movimiento de otra tienda responde no encontrado (R41)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const debitoB = await s.movimientoTienda(s.tiendaB, "flete");
      expect(debitoB, "el feed no emitio el debito de la tienda B").not.toBeNull();

      // La tienda A pide el detalle de un movimiento del libro de la B.
      const r = await s.servicio.verDetalleDeMiMovimiento(
        { movimientoId: debitoB!, page: 1, pageSize: 50 },
        { usuarioId: s.tiendaA, rol: "adminTienda" },
      );
      // Ni `ok` con filas ni `forbidden`: un `forbidden` confirmaria que ese movimiento existe.
      expect(r).toEqual({ status: "not_found" });

      // No-vacuidad: ese MISMO id, pedido por su dueña, si responde con datos.
      const propio = await s.servicio.verDetalleDeMiMovimiento(
        { movimientoId: debitoB!, page: 1, pageSize: 50 },
        { usuarioId: s.tiendaB, rol: "adminTienda" },
      );
      expect(propio.status).toBe("ok");
    });
  });

  it("el credito COD de la tienda cuadra con su importe (R17 en el otro libro)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const credito = await s.movimientoTienda(s.tiendaA, "cod_recaudado");
      expect(credito, "el feed no emitio el credito COD de la tienda A").not.toBeNull();

      const { ordenes, total } = await todasLasPaginas(async (page) => {
        const r = await s.servicio.verDetalleDeMiMovimiento(
          { movimientoId: credito!, page, pageSize: 2 },
          { usuarioId: s.tiendaA, rol: "adminTienda" },
        );
        if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);
        return r.data;
      }, 2);

      expect(sumar(ordenes.map((o) => o.aporte))).toBe(
        await s.montoTienda(s.tiendaA, "cod_recaudado"),
      );
      // Las cuatro ordenes de A que recaudaron algo; las que recaudaron 0 no se muestran (Q2).
      expect(new Set(ordenes.map((o) => o.ordenId))).toEqual(
        new Set(
          ["entregada-con-cod", "reprogramada", "sin-tarifa", "dos-gestiones"].map((c) =>
            s.ordenPorClave.get(c),
          ),
        ),
      );
      expect(total).toBe(4);
      // La `reprogramada` recaudo 250,00: un resultado que NO aporta a ningun concepto derivado
      // SI aporta al credito COD. Es la prueba de que este criterio es el suyo y no una copia.
      const reprogramada = ordenes.find(
        (o) => o.ordenId === s.ordenPorClave.get("reprogramada"),
      );
      expect(reprogramada?.aporte).toBe("250.00");
    });
  });

  it("los tres conceptos sin reparto abren su detalle y dicen de donde sale su importe (R48)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      // `ingreso_cod_recaudado` de la CAJA lo emite otro camino (la aprobacion del cierre), asi
      // que aqui se siembra a mano un movimiento de ese origen para poder abrirlo.
      const cliente = tx as unknown as PrismaClient;
      const id = randomUUID();
      await new WalletMovimientoRepository(cliente).crearMovimientos(cliente, [
        {
          id,
          tipo: "ingreso",
          categoria: "ingreso_cod_recaudado",
          monto: "43150.00",
          origenTipo: "cierre_dia",
          origenId: s.cierreId,
          descripcion: null,
          registradoPor: null,
        },
      ]);

      const r = await s.servicio.verDetalleDeMovimiento(
        { movimientoId: id, page: 1, pageSize: 25 },
        MAESTRO,
      );
      // La fila SE ABRE —no calla— y dice de que fuente sale su importe.
      expect(r).toEqual({ status: "sin_reparto", motivo: "suma_del_libro_por_tienda" });
    });
  });
});
