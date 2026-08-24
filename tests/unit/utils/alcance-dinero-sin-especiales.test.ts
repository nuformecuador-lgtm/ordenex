import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  derivarIngresoOrden,
  costoEnvioDeTarifa,
  costosListadoOrden,
} from "@/lib/utils/ingreso-ordenex";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar } from "@/lib/utils/cascada-tarifa";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

/**
 * FEATURE 274 (R40) — ALCANCE DECLARADO: `tarifas.tarifa_especial` y `distrito.zona_especial`
 * SIGUEN FUERA DE LA ARITMETICA DE DINERO.
 *
 * Las dos columnas EXISTEN en la base (`db/schema.prisma:466` y `:1169`, migraciones
 * `20260824180000_distrito_zona_especial` y `tarifa_especial`) y las dos SUENAN a que deberian
 * afectar al precio. Ninguna lo hace hoy, y esta feature —que es la que reescribe QUE FILA de
 * `tarifas` se elige— no las mete en el camino. R40 lo declara para que el siguiente que pase
 * por aqui no las conecte «ya que estamos»: conectar `tarifa_especial` cambia lo que se
 * factura, y eso es una decision de producto con su propia ficha, no un efecto colateral de
 * una feature de resolucion.
 *
 * DONDE SI SE LEE `tarifaEspecial`, y por que no lo contradice: el LISTADO la proyecta dentro
 * de `TarifaDTO` (`relaciones.tienda.tarifa.tarifaEspecial`) porque la pantalla de
 * configuracion de tarifas la muestra y la edita. Leerla para MOSTRARLA no es leerla para
 * COBRAR. Por eso el test central de este archivo no es un grep: es la comprobacion de que el
 * importe NO CAMBIA cuando la columna cambia.
 */

const TARIFA: TarifaVigente = {
  valorFlete: "1000.00",
  valorFleteGam: "800.00",
  valorFleteDevuelto: "500.00",
  valorFleteDevueltoGam: "400.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

/** La MISMA tarifa, contaminada con las dos columnas fuera de alcance y valores absurdos. */
const TARIFA_CONTAMINADA = {
  ...TARIFA,
  tarifaEspecial: "999999.00",
  zonaEspecial: true,
  esEspecial: true,
} as unknown as TarifaVigente;

const ORDEN = {
  resultado: "entregada" as const,
  esCentral: false,
  montoCobrar: "25000.00",
  cobraComision: true,
};

describe("274/R40 — la aritmetica de dinero IGNORA tarifa_especial y zona_especial", () => {
  it("derivarIngresoOrden da el MISMO resultado con y sin las dos columnas de mas", () => {
    const limpio = derivarIngresoOrden(ORDEN, TARIFA);
    const contaminado = derivarIngresoOrden(ORDEN, TARIFA_CONTAMINADA);

    // Assert de EJECUCION, no de texto: si alguien enchufara `tarifaEspecial` a la formula,
    // 999999.00 no pasaria desapercibido.
    expect(contaminado).toEqual(limpio);
    // Y el valor no es trivial (un `{}` por los dos lados tambien seria "igual").
    expect(limpio.ingreso_flete?.toFixed(2)).toBe("1000.00");
    expect(limpio.ingreso_iva_flete?.toFixed(2)).toBe("130.00");
  });

  it("costoEnvioDeTarifa (carga y cotizacion por API) tampoco cambia", () => {
    for (const esCentral of [true, false]) {
      expect(costoEnvioDeTarifa(TARIFA_CONTAMINADA, esCentral)).toBe(
        costoEnvioDeTarifa(TARIFA, esCentral),
      );
    }
    expect(costoEnvioDeTarifa(TARIFA, false)).toBe("1130.00");
  });

  it("costosListadoOrden (las dos columnas derivadas del listado) tampoco cambia", () => {
    const limpio = costosListadoOrden(TARIFA, ORDEN);
    expect(costosListadoOrden(TARIFA_CONTAMINADA, ORDEN)).toEqual(limpio);
    expect(limpio).toEqual({ fleteConIva: "1130.00", comisionConIva: "1412.50" });
  });

  it("el TIPO que ve la aritmetica tiene 7 claves y ninguna es especial", () => {
    // Mas fuerte que un grep sobre el fuente: mientras `TarifaVigente` no tenga la clave, la
    // formula no puede leerla ni queriendo (`derivarIngresoOrden` no recibe otra cosa).
    const claves = Object.keys(TARIFA).sort();
    expect(claves).toEqual([
      "comisionCod",
      "ivaComisionCod",
      "ivaFlete",
      "valorFlete",
      "valorFleteDevuelto",
      "valorFleteDevueltoGam",
      "valorFleteGam",
    ]);
    expect(claves.some((k) => /especial/i.test(k))).toBe(false);
  });

  it("el fuente de `ingreso-ordenex.ts` no nombra ninguna de las dos columnas", () => {
    // Complemento estructural del assert de ejecucion: cubre tambien las funciones de
    // agregacion del modulo (wallet, totales del cierre), que no se invocan arriba.
    const fuente = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "lib", "utils", "ingreso-ordenex.ts"),
      "utf8",
    );
    expect(fuente).not.toMatch(/tarifaEspecial|tarifa_especial/);
    expect(fuente).not.toMatch(/zonaEspecial|zona_especial/);
  });
});

describe("274/R40 — el resolver del DINERO no proyecta las columnas fuera de alcance", () => {
  const filaCompleta = {
    id: "ta-1",
    tiendaId: "t1",
    zonaId: "z1",
    valorFlete: new Prisma.Decimal("1000.00"),
    valorFleteGam: new Prisma.Decimal("800.00"),
    valorFleteDevuelto: new Prisma.Decimal("500.00"),
    valorFleteDevueltoGam: new Prisma.Decimal("400.00"),
    fulfillment: new Prisma.Decimal("1.00"),
    comisionCod: new Prisma.Decimal("5.00"),
    ivaFlete: new Prisma.Decimal("13.00"),
    ivaComisionCod: new Prisma.Decimal("13.00"),
    // La base la tiene; el resolver del dinero NO debe pedirla ni propagarla.
    tarifaEspecial: new Prisma.Decimal("999999.00"),
    isDefault: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };

  it("`resolveTarifas` no pide `tarifaEspecial` en el select ni la devuelve en la fila resuelta", async () => {
    const findMany = vi.fn(async () => [filaCompleta]);
    const repo = new TarifaVigenteRepository(
      { tarifa: { findMany } } as unknown as PrismaClient,
    );

    const par = { tiendaId: "t1", zonaId: "z1" };
    const resueltas = await repo.resolveTarifas([par]);
    const resuelta = resueltas.get(clavePar(par));

    // El SELECT: las 11 columnas exactas que el camino del dinero necesita (los 7 de la
    // formula + `id`/`fulfillment` del snapshot + `tiendaId`/`zonaId` que la regla clasifica),
    // ninguna especial.
    const select = (findMany.mock.calls[0] as unknown as [{ select: Record<string, boolean> }])[0]
      .select;
    expect(Object.keys(select).sort()).toEqual([
      "comisionCod",
      "fulfillment",
      "id",
      "ivaComisionCod",
      "ivaFlete",
      "tiendaId",
      "valorFlete",
      "valorFleteDevuelto",
      "valorFleteDevueltoGam",
      "valorFleteGam",
      "zonaId",
    ]);
    expect(Object.keys(select).some((k) => /especial/i.test(k))).toBe(false);

    // Y la SALIDA: aunque el doble la haya colado en la fila (como haria una base que
    // devolviera de mas), no se propaga al camino del dinero ni del snapshot.
    expect(resuelta).not.toBeNull();
    expect(Object.keys(resuelta as object).some((k) => /especial/i.test(k))).toBe(false);
  });
});

describe("274/R40 — el listado la MUESTRA pero no la COBRA", () => {
  function ordenListRow() {
    return {
      id: "ord-1",
      numGuia: 10,
      numRemision: "REM-1",
      estatusId: idEstado("en_bodega_central"),
      destinatario: "Ana",
      telefonoDest: "0991234567",
      tiendaId: "t1",
      zonaId: "z1",
      provinciaId: "p1",
      cantonId: "c1",
      distritoId: null,
      producto: "Caja",
      peso: new Prisma.Decimal("1.500"),
      notas: null,
      deletedAt: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      mensajeroAsignadoId: null,
      prioridad: false,
      estatus: { id: idEstado("en_bodega_central"), value: "en_bodega_central" },
      tienda: { id: "t1", nombre: "Tienda X", email: "t@x.co", telefono: "0990000001" },
      zona: { id: "z1", nombre: "Limón", esCentral: false },
      provincia: { id: "p1", nombre: "Limón" },
      canton: { id: "c1", nombre: "Central" },
      distrito: null,
      mensajeroAsignado: null,
      gestiones: [],
      montoCobrar: new Prisma.Decimal("25000.00"),
      cobraComision: true,
    };
  }

  async function listar(tarifaEspecial: Prisma.Decimal | null) {
    const prisma = {
      orden: { findMany: vi.fn(async () => [ordenListRow()]), count: vi.fn(async () => 1) },
      tarifa: {
        findMany: vi.fn(async () => [
          {
            id: "ta-1",
            tiendaId: "t1",
            zonaId: "z1",
            valorFlete: new Prisma.Decimal("1000.00"),
            valorFleteGam: new Prisma.Decimal("800.00"),
            valorFleteDevuelto: new Prisma.Decimal("500.00"),
            valorFleteDevueltoGam: new Prisma.Decimal("400.00"),
            fulfillment: new Prisma.Decimal("1.00"),
            comisionCod: new Prisma.Decimal("5.00"),
            ivaFlete: new Prisma.Decimal("13.00"),
            ivaComisionCod: new Prisma.Decimal("13.00"),
            tarifaEspecial,
            isDefault: false,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
          },
        ]),
      },
    };
    const res = await new OrdenRepository(prisma as unknown as PrismaClient).list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 50,
    });
    return res.items[0];
  }

  it("cambiar `tarifa_especial` NO mueve ni un centimo de las columnas de dinero", async () => {
    await sembrarCatalogoEstados();

    const sin = await listar(null);
    const con = await listar(new Prisma.Decimal("999999.00"));

    // Lo que SI cambia: el campo de configuracion que la pantalla edita.
    expect(sin.relaciones?.tienda?.tarifa?.tarifaEspecial).toBeNull();
    expect(con.relaciones?.tienda?.tarifa?.tarifaEspecial).toBe(999999);
    // Lo que NO cambia: el dinero. Este es el assert de R40.
    expect(con.fleteConIva).toBe(sin.fleteConIva);
    expect(con.comisionConIva).toBe(sin.comisionConIva);
    expect(sin.fleteConIva).toBe("1130.00");
  });
});

describe("274/R40 — `distrito.zona_especial` no entra en ningun camino de dinero", () => {
  const RAIZ = path.join(__dirname, "..", "..", "..");
  const MODULOS_DEL_DINERO = [
    "lib/utils/ingreso-ordenex.ts",
    "lib/utils/cascada-tarifa.ts",
    "lib/utils/cierre-detalle.ts",
    "lib/repositories/TarifaVigenteRepository.ts",
    "lib/repositories/CierreDiaRepository.ts",
    "lib/services/BulkOrdenService.ts",
    "lib/services/CotizacionOrdenService.ts",
  ];

  it("la columna EXISTE en el schema (no es que el test mire un sitio vacio)", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "db", "schema.prisma"), "utf8");
    expect(schema).toContain('@map("zona_especial")');
    expect(schema).toContain('@map("tarifa_especial")');
  });

  it("y aun asi ningun modulo del camino del dinero la nombra", () => {
    const infractores = MODULOS_DEL_DINERO.filter((rel) => {
      const abs = path.join(RAIZ, rel);
      // Si un modulo se renombra, el test tiene que enterarse: no se salta en silencio.
      expect(fs.existsSync(abs), `${rel} no existe: actualiza la lista`).toBe(true);
      return /zonaEspecial|zona_especial/.test(fs.readFileSync(abs, "utf8"));
    });
    expect(infractores, "la marca de distrito especial sigue fuera de alcance (R40)").toEqual([]);
  });
});
