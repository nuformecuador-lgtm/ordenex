import { describe, expect, it } from "vitest";

import { ORIGEN_TIENDA_LABEL } from "@/app/(app)/mi-wallet/_components/mi-wallet-labels";
import { ORIGEN_LABEL } from "@/app/(app)/wallet/_components/wallet-labels";
import { ORIGEN_PAGO_LABEL } from "@/app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels";
import { WALLET_ORIGEN_TIPO_SEED } from "@/lib/types/wallet";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import { archivosBajo, archivosDeLaWallet, codigo } from "./_wallet-458-archivos";

// =================================================================================================
// GUARDIA — FICHA 458-A (TA.2, R94 + R9, R99) — NINGUN ORIGEN SIN NOMBRE
// =================================================================================================
//
// El gate falla si alguna superficie de la wallet puede pintar o descargar un origen sin nombre:
//
//  1. todo diccionario de origen (`ORIGEN_*LABEL`) de las carpetas de la wallet se declara
//     `Record<WalletOrigenTipo, …>` (total: un origen nuevo no compila sin nombre), nunca
//     `Record<string, …>` ni `Partial<…>`;
//  2. ningun archivo cae al valor tecnico con `?? <algo>.origenTipo` / `?? origenTipo`;
//  3. los DTO de los libros (`lib/types/wallet*.ts`) tipan `origenTipo` con el catalogo, no `string`;
//  4. los tres diccionarios, en ejecucion, tienen EXACTAMENTE las claves del catalogo y ningun
//     valor es el propio valor tecnico.
//
// Contraprueba: la fuente de antes (`ORIGEN_TIENDA_LABEL: Record<string, string>` + `origenLabel`
// con `?? origenTipo`) la pone roja. No-vacuidad: hay ≥ 3 declaraciones de diccionario de origen.

const DECLARACION_ORIGEN = /export const (ORIGEN_\w*LABEL)\s*:\s*([^=]+)=/g;
const TIPO_TOTAL = /^Record<\s*WalletOrigenTipo\s*,\s*string\s*>$/;
const CAIDA_AL_TECNICO = /\?\?\s*(?:[\w.]+\.)?origenTipo\b/;
const DTO_ORIGEN_STRING = /\borigenTipo\s*:\s*string\b/;

type Hallazgo = { archivo: string; motivo: string };

function hallazgosEn(archivo: string, fuente: string): Hallazgo[] {
  const salida: Hallazgo[] = [];
  for (const m of fuente.matchAll(DECLARACION_ORIGEN)) {
    const tipo = m[2].trim();
    if (!TIPO_TOTAL.test(tipo)) salida.push({ archivo, motivo: `${m[1]} tipado ${tipo}` });
  }
  if (CAIDA_AL_TECNICO.test(fuente)) salida.push({ archivo, motivo: "caida `?? origenTipo`" });
  return salida;
}

function declaracionesDeOrigen(): string[] {
  return archivosDeLaWallet().flatMap((r) => [...codigo(r).matchAll(DECLARACION_ORIGEN)].map((m) => m[1]));
}

describe("458-A R94 — ninguna superficie de la wallet pinta un origen sin nombre", () => {
  it("no-vacuidad: los tres diccionarios de origen están en el censo", () => {
    const decl = declaracionesDeOrigen();
    expect(decl).toEqual(expect.arrayContaining(["ORIGEN_LABEL", "ORIGEN_TIENDA_LABEL", "ORIGEN_PAGO_LABEL"]));
  });

  it("todo diccionario de origen es total y nadie cae al valor técnico", () => {
    const rojos = archivosDeLaWallet().flatMap((r) => hallazgosEn(r, codigo(r)));
    expect(rojos).toEqual([]);
  });

  it("los DTO de los tres libros tipan `origenTipo` con el catálogo (R9)", () => {
    const tipos = archivosBajo(["lib/types"]).filter((r) => /^lib\/types\/wallet[\w-]*\.ts$/.test(r));
    expect(tipos).toEqual(expect.arrayContaining(["lib/types/wallet.ts", "lib/types/wallet-tienda.ts", "lib/types/wallet-mensajero.ts"]));
    const rojos = tipos.filter((r) => DTO_ORIGEN_STRING.test(codigo(r)));
    expect(rojos).toEqual([]);
  });

  it("en ejecución, los tres diccionarios tienen exactamente las claves del catálogo y nombres legibles", () => {
    const catalogo = [...WALLET_ORIGEN_TIPO_SEED].sort();
    for (const dic of [ORIGEN_LABEL, ORIGEN_TIENDA_LABEL, ORIGEN_PAGO_LABEL]) {
      expect(Object.keys(dic).sort()).toEqual(catalogo);
      for (const [clave, texto] of Object.entries(dic)) {
        expect(texto).not.toBe(clave);
        expect(texto.trim()).not.toBe("");
      }
    }
  });

  it("composition root: los 9 bordes de los libros adjuntan el origen con el servicio REAL por defecto", () => {
    // Memoria «el composition root que no inyecta»: importar no es pasar. Cada borde que entrega
    // filas de un libro llama `deps.origenes ?? buildOrigenes()`, y `buildOrigenes` construye el
    // servicio sobre el repositorio de Prisma.
    const esperado: Record<string, number> = {
      "lib/actions/wallet.ts": 3,
      "lib/actions/wallet-tienda.ts": 4,
      "lib/actions/wallet-mensajero.ts": 2,
    };
    for (const [archivo, n] of Object.entries(esperado)) {
      const fuente = codigo(archivo);
      expect({ archivo, n: fuente.split("deps.origenes ?? buildOrigenes()").length - 1 }).toEqual({ archivo, n });
      expect(fuente).toMatch(/new OrigenLegibleService\(new OrigenLegibleRepository\(getPrismaClient\(\)\)\)/);
    }
  });

  it("contraprueba: la fuente de antes de la 458-A la pone roja por los dos motivos", () => {
    const antes = quitarComentarios(`
      export const ORIGEN_TIENDA_LABEL: Record<string, string> = { cierre_dia: "Cierre del día" };
      export function origenLabel(origenTipo: string): string {
        return ORIGEN_TIENDA_LABEL[origenTipo] ?? origenTipo;
      }
      const base = ORIGEN_PAGO_LABEL[movimiento.origenTipo] ?? movimiento.origenTipo;
    `);
    const h = hallazgosEn("fuente-de-antes.ts", antes).map((x) => x.motivo);
    expect(h).toContain("ORIGEN_TIENDA_LABEL tipado Record<string, string>");
    expect(h).toContain("caida `?? origenTipo`");
    expect(DTO_ORIGEN_STRING.test("  origenTipo: string; // cierre_dia | pago_tienda")).toBe(true);
  });
});
