import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⏳ 2026-09-10 — FEATURE 415 (T9): LA GUARDIA DE LA FORMA UNICA Y DE LA LISTA BLANCA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Molde: `mensajero-forma-unica.guardia.test.ts` (404) y
// `gestiones-detalle-lista-blanca.guardia.test.ts` (405). Mide CUATRO cosas, y ninguna sustituye a
// las otras:
//
//   1. ESTRUCTURA — `ApiZonaDTO` y `ApiOrdenCostoDTO` se declaran UNA sola vez cada uno en todo
//      `lib/`. El grafo de imports NO puede detectar «cuantas declaraciones hay», que es la razon
//      por la que esto vive en una guardia y no en un test normal.
//   2. LISTA BLANCA — el conjunto EXACTO de claves publicadas: TRECE en el item, DOS en `zona` y
//      CINCO en el objeto de costo. Una clave colada por un spread cae aqui.
//   3. COMPORTAMIENTO — listado y detalle, sobre la MISMA orden, producen el MISMO fragmento
//      serializado para los tres campos (R14). Un mapeo que divergiera en uno de los dos caminos
//      se pone rojo aunque compile.
//   4. AUTO-PRUEBA DEL DETECTOR — el mismo escaneo sobre un texto MUTADO en memoria TIENE que
//      encontrar la violacion. Sin esto, un detector roto queda verde para siempre.
//
// ⚠️ SOBRE LA GUARDIA DE LA 404, REVISADA Y NO TOCADA: `mensajero-forma-unica.guardia.test.ts`
// vigila que `ApiMensajeroDTO` se declare una sola vez, y su detector casa por NOMBRE
// (`/Api\w*Mensajero\w*DTO/`), no por forma. `ApiZonaDTO` tiene la MISMA forma `{id, nombre}` pero
// otro nombre, asi que aquella guardia no cae en falso y su alcance queda intacto: se comprobo
// corriendola, no razonandolo. Si algun dia contara por forma, habria que acotarla con su motivo
// escrito al lado (design §12).
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");
const OWNER = "store-1";
const ORDEN_ID = "orden-1";
const ZONA_ID = "018f2c31-0000-4000-8000-00000000za01";
const ACTOR: Actor = { usuarioId: OWNER, rol: "apiKey" };

// -----------------------------------------------------------------------------------------------
// 1. ESTRUCTURA — un solo sitio donde se declara cada tipo
// -----------------------------------------------------------------------------------------------

/** Archivos `.ts`/`.tsx` de un directorio, recursivamente. */
function archivosDe(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) {
      salida.push(...archivosDe(completo));
    } else if (/\.tsx?$/.test(entrada)) {
      salida.push(completo);
    }
  }
  return salida;
}

/**
 * Declaraciones de los dos tipos publicos de esta ficha en un texto ya SIN COMENTARIOS: la prosa
 * que los explica los nombra muchas veces y una mencion no es una declaracion.
 */
function declaracionesDeTipo415(codigo: string): string[] {
  const re = /(?:export\s+)?(?:interface|type)\s+(ApiZonaDTO|Api\w*Costo\w*DTO)\b/g;
  return [...codigo.matchAll(re)].map((m) => m[1]);
}

describe("415/T9 (1) — ESTRUCTURA: cada tipo se declara UNA sola vez en `lib/`", () => {
  const declaraciones = archivosDe(path.join(RAIZ, "lib")).flatMap((archivo) => {
    const codigo = quitarComentarios(readFileSync(archivo, "utf8"));
    return declaracionesDeTipo415(codigo).map((nombre) => ({
      nombre,
      archivo: path.relative(RAIZ, archivo).replace(/\\/g, "/"),
    }));
  });

  it("`ApiZonaDTO` y `ApiOrdenCostoDTO` viven SOLO en `lib/types/api-orden.ts`", () => {
    expect(declaraciones).toEqual([
      { nombre: "ApiZonaDTO", archivo: "lib/types/api-orden.ts" },
      { nombre: "ApiOrdenCostoDTO", archivo: "lib/types/api-orden.ts" },
    ]);
  });

  it("no existe ningun SEGUNDO tipo de costo publico con otro nombre", () => {
    // Un `ApiOrdenCostoRealDTO` o similar seria una segunda forma de la misma cosa, y el candado
    // del compilador que sostiene R14 dejaria de aplicar en silencio.
    expect(declaraciones.map((d) => d.nombre)).toEqual(["ApiZonaDTO", "ApiOrdenCostoDTO"]);
  });
});

// -----------------------------------------------------------------------------------------------
// 2 y 3. LISTA BLANCA y COMPORTAMIENTO — sobre la CADENA REAL
// -----------------------------------------------------------------------------------------------

/** Las trece claves EXACTAS del item publicado tras esta ficha (R9/R34). */
const CLAVES_DEL_ITEM = [
  "costoEstimado",
  "costoReal",
  "createdAt",
  "destinatario",
  "direccion",
  "estado",
  "mensajero",
  "montoCobrar",
  "numGuia",
  "numRemision",
  "producto",
  "telefonoDest",
  "zona",
];

const CLAVES_DE_ZONA = ["id", "nombre"];
const CLAVES_DE_COSTO = ["comision", "flete", "fulfillment", "iva", "ivaComision"];

const TARIFA = {
  id: "tarifa-1",
  tiendaId: OWNER,
  zonaId: ZONA_ID,
  fulfillment: new Prisma.Decimal("696.00"),
  valorFlete: new Prisma.Decimal("3000.00"),
  valorFleteGam: new Prisma.Decimal("2500.00"),
  valorFleteDevuelto: new Prisma.Decimal("1500.00"),
  valorFleteDevueltoGam: new Prisma.Decimal("1200.00"),
  comisionCod: new Prisma.Decimal("3.50"),
  ivaFlete: new Prisma.Decimal("13.00"),
  ivaComisionCod: new Prisma.Decimal("13.00"),
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

const CONGELADO = {
  montoCobrar: new Prisma.Decimal("25900.00"),
  cobraComision: true,
  esCentral: true,
  esZonaEspecial: false,
  tarifaId: "tarifa-congelada-1",
  tarifaValorFlete: new Prisma.Decimal("3000.00"),
  tarifaValorFleteGam: new Prisma.Decimal("2500.00"),
  tarifaValorFleteDevuelto: new Prisma.Decimal("1500.00"),
  tarifaValorFleteDevueltoGam: new Prisma.Decimal("1200.00"),
  tarifaComisionCod: new Prisma.Decimal("3.50"),
  tarifaIvaFlete: new Prisma.Decimal("13.00"),
  tarifaIvaComisionCod: new Prisma.Decimal("13.00"),
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
  tarifaFulfillment: new Prisma.Decimal("692.00"),
};

/** La MISMA fila para los dos caminos: si divergen, es el mapeo, no los datos. */
function filaOrden() {
  return {
    numGuia: 100234,
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: new Prisma.Decimal("25900.00"),
    createdAt: new Date("2026-09-10T10:00:00.000Z"),
    estatus: { value: "en_reparto" },
    mensajeroAsignado: null,
    zonaId: ZONA_ID,
    cobraComision: true,
    zona: { id: ZONA_ID, nombre: "GAM", esCentral: true },
    distrito: { zonaEspecial: false },
    cierreDetalles: [CONGELADO],
    gestiones: [],
    historialEstados: [],
    incidentesAdmin: [],
  };
}

const signedUrlsNoOp: ISignedUrlProvider = {
  createSignedUrl: vi.fn(async () => "https://signed/one"),
  createSignedUrls: vi.fn(async () => ({})),
};

/** Listado y detalle por la cadena REAL, sobre la MISMA fila y el MISMO Prisma. */
async function listadoYDetalle() {
  const fila = filaOrden();
  const prisma = {
    orden: {
      findMany: vi.fn(async () => [fila]),
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => fila),
    },
    tarifa: { findMany: vi.fn(async () => [TARIFA]) },
  };
  const svc = new ApiOrdenLecturaService(
    new OrdenRepository(prisma as unknown as PrismaClient),
    signedUrlsNoOp,
    new TarifaVigenteRepository(prisma as unknown as PrismaClient),
  );
  const listado = await svc.listar(ACTOR, { limit: 50, offset: 0 });
  const detalle = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);
  return { item: listado.items[0], detalle: detalle! };
}

describe("415/T9 (2) — LISTA BLANCA: el conjunto EXACTO de claves publicadas", () => {
  it("el item tiene TRECE claves, `zona` DOS y cada costo CINCO — en los dos caminos", async () => {
    const { item, detalle } = await listadoYDetalle();

    expect(Object.keys(item).sort()).toEqual(CLAVES_DEL_ITEM);
    // El detalle son las trece + sus DOS arrays, y ni una mas.
    expect(Object.keys(detalle).sort()).toEqual(
      [...CLAVES_DEL_ITEM, "evidencias", "gestiones"].sort(),
    );

    for (const fuente of [item, detalle]) {
      expect(Object.keys(fuente.zona).sort()).toEqual(CLAVES_DE_ZONA);
      expect(Object.keys(fuente.costoEstimado!).sort()).toEqual(CLAVES_DE_COSTO);
      expect(Object.keys(fuente.costoReal!).sort()).toEqual(CLAVES_DE_COSTO);
    }
  });

  it("R11: ninguna clave publicada suma los cinco conceptos, con ningun nombre", async () => {
    const { item } = await listadoYDetalle();

    // Suma A MANO: 2500.00 + 325.00 + 906.50 + 117.85 + 696.00 = 4545.35 (vigente)
    //              2500.00 + 325.00 + 906.50 + 117.85 + 692.00 = 4541.35 (congelado)
    const texto = JSON.stringify(item);
    expect(texto).not.toContain("4545.35");
    expect(texto).not.toContain("4541.35");
    expect(item.costoEstimado).not.toHaveProperty("total");
    expect(item.costoReal).not.toHaveProperty("total");
  });

  it("R18/R35: el bundle de costeo NO cruza al DTO por ninguno de los dos caminos", async () => {
    const { item, detalle } = await listadoYDetalle();

    for (const fuente of [item, detalle]) {
      expect(fuente).not.toHaveProperty("costeo");
      const texto = JSON.stringify(fuente);
      for (const fuga of ["costeo", "zonaId", "esCentral", "esZonaEspecial", "tarifaId"]) {
        expect(texto, `se filtro \`${fuga}\``).not.toContain(fuga);
      }
    }
  });
});

describe("415/T9 (3) — COMPORTAMIENTO: listado y detalle dan el MISMO fragmento", () => {
  it("R14: los tres campos serializan IDENTICOS en las dos superficies", async () => {
    const { item, detalle } = await listadoYDetalle();

    // Objeto a objeto...
    expect(detalle.zona).toEqual(item.zona);
    expect(detalle.costoEstimado).toEqual(item.costoEstimado);
    expect(detalle.costoReal).toEqual(item.costoReal);

    // ...y el TEXTO serializado, que es lo que el integrador recibe: mismo orden de claves y
    // mismas cadenas, byte a byte.
    const fragmento = (o: Record<string, unknown>) =>
      JSON.stringify({ zona: o.zona, costoEstimado: o.costoEstimado, costoReal: o.costoReal });
    expect(fragmento(detalle as never)).toBe(fragmento(item as never));
  });

  it("R25/R29: los importes son los esperados, escritos A MANO (no derivados aqui)", async () => {
    const { item } = await listadoYDetalle();

    // flete 2500.00 (GAM) · iva 2500.00 x 13 % = 325.00 · comision 25900.00 x 3.50 % = 906.50
    // ivaComision 906.50 x 13 % = 117.845 -> HALF_UP -> 117.85 · fulfillment 696.00 / 692.00
    expect(item.costoEstimado).toEqual({
      flete: "2500.00",
      iva: "325.00",
      comision: "906.50",
      ivaComision: "117.85",
      fulfillment: "696.00",
    });
    expect(item.costoReal).toEqual({
      flete: "2500.00",
      iva: "325.00",
      comision: "906.50",
      ivaComision: "117.85",
      fulfillment: "692.00",
    });
  });
});

// -----------------------------------------------------------------------------------------------
// 4. AUTO-PRUEBA DEL DETECTOR
// -----------------------------------------------------------------------------------------------

describe("415/T9 (4) — AUTO-PRUEBA: el detector encuentra la violacion cuando la hay", () => {
  it("sobre un texto MUTADO en memoria, ve el segundo tipo de zona", () => {
    const mutado = `
      export interface ApiZonaDTO { id: string; nombre: string }
      export interface ApiZonaDTO { id: string }
    `;
    expect(declaracionesDeTipo415(quitarComentarios(mutado))).toEqual([
      "ApiZonaDTO",
      "ApiZonaDTO",
    ]);
  });

  it("sobre un texto MUTADO en memoria, ve un SEGUNDO tipo de costo con otro nombre", () => {
    const mutado = `
      export interface ApiOrdenCostoDTO { flete: string }
      export type ApiOrdenCostoRealDTO = { flete: string }
    `;
    expect(declaracionesDeTipo415(quitarComentarios(mutado))).toEqual([
      "ApiOrdenCostoDTO",
      "ApiOrdenCostoRealDTO",
    ]);
  });

  it("y NO confunde una mencion ni un comentario con una declaracion", () => {
    expect(
      declaracionesDeTipo415(
        quitarComentarios(
          "const x: ApiZonaDTO | null = null; // interface ApiOrdenCostoDTO {}\n" +
            "/* export interface ApiZonaDTO { id: string } */\n",
        ),
      ),
    ).toEqual([]);
  });

  it("el escaneo de `lib/` se ejecuto de verdad: encontro archivos y encontro los dos tipos", () => {
    // Una lista vacia significaria que el recorrido no leyo nada y que los bloques de arriba
    // estan pasando por vacio. Este aserto es el que lo impide.
    const archivos = archivosDe(path.join(RAIZ, "lib"));
    expect(archivos.length).toBeGreaterThan(100);
    const encontrados = archivos.flatMap((a) =>
      declaracionesDeTipo415(quitarComentarios(readFileSync(a, "utf8"))),
    );
    expect(encontrados.sort()).toEqual(["ApiOrdenCostoDTO", "ApiZonaDTO"]);
  });
});
