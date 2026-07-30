import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";

// Feature 158 (T1.15, R29) — GUARD ESTRUCTURAL de los PRODUCTORES de `egreso_indemnizacion`.
// Patron de `tests/unit/repositories/cierre-detail-inmutable.test.ts`.
//
// Por que estructural y no de comportamiento: «solo estos sitios emiten esta categoria» no es
// una funcion que se pueda invocar, es la AUSENCIA de otros emisores. La base no lo impide (la
// categoria es un valor mas del enum y cualquier modulo puede construir un
// `CrearMovimientoInput` con ella), asi que esta red es lo unico que impide que una feature
// futura abra un tercer camino al dinero: una accion manual, un cron, un endpoint.
//
// QUE CUENTA COMO «EMITIR»: construir el movimiento, es decir escribir
// `categoria: "egreso_indemnizacion"`. NOMBRAR el literal en un comentario, en el SEED o en una
// agregacion de SOLO LECTURA no es emitir — y por eso el censo NO busca el literal suelto:
// buscarlo asi marcaria como emisor a cualquier archivo que lo mencione en prosa, y un guard
// que grita por un comentario acaba desactivado.
//
// R29 REESCRITO por el corte en dos PRs (design §15.2): el requisito pide «exactamente DOS
// puntos de emision». En ESTE PR existe UNO —la aprobacion del cierre del dia, camino del
// MENSAJERO—; el segundo (la aprobacion del incidente del ADMIN) llega con su PR y DEBE
// sumarse a la lista de abajo. La comparacion es de IGUALDAD: un emisor nuevo, declarado o no,
// pone este archivo en rojo y obliga a decidirlo a proposito.

const LIB_DIR = path.join(__dirname, "..", "..", "..", "lib");
const APP_DIR = path.join(__dirname, "..", "..", "..", "app");

/** EMITIR = construir el movimiento con esa categoria. */
const RE_EMISION = /categoria:\s*["']egreso_indemnizacion["']/;

/** Rutas (relativas a `lib/`, POSIX) que PUEDEN emitir, con su razon. */
const EMISORES_DECLARADOS: Array<{ archivo: string; razon: string }> = [
  {
    archivo: "services/WalletIndemnizacionFeedService.ts",
    razon:
      "camino del MENSAJERO: construye el egreso del cierre (origen_tipo = cierre_dia) dentro " +
      "de la tx de aprobacion, leyendo los montos que esa misma tx acaba de escribir",
  },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(full));
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Archivos de `base` que EMITEN la categoria, por ruta relativa POSIX. */
function emisoresEn(base: string): string[] {
  return tsFiles(base)
    .filter((f) => RE_EMISION.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(base, f).replace(/\\/g, "/"))
    .sort();
}

describe("Feature 158/R29 — quien puede emitir `egreso_indemnizacion`", () => {
  it("la categoria existe en el SEED (el guard no vigila un literal fantasma)", () => {
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain("egreso_indemnizacion");
  });

  it("los UNICOS modulos de lib/ que la EMITEN son los declarados", () => {
    // IGUALDAD, no `some()`: un modulo nuevo que la emita —o uno declarado que deje de
    // hacerlo— rompe. Esa es toda la fuerza del guard.
    expect(emisoresEn(LIB_DIR)).toEqual(EMISORES_DECLARADOS.map((e) => e.archivo).sort());
  });

  it("NINGUN modulo de app/ la emite (la UI no produce dinero)", () => {
    expect(emisoresEn(APP_DIR)).toEqual([]);
  });

  it("cada emisor declarado EXISTE y de verdad la emite (la lista no es decorativa)", () => {
    for (const { archivo } of EMISORES_DECLARADOS) {
      const full = path.join(LIB_DIR, ...archivo.split("/"));
      expect(fs.existsSync(full), `${archivo} no existe`).toBe(true);
      expect(RE_EMISION.test(fs.readFileSync(full, "utf8")), `${archivo} no la emite`).toBe(true);
    }
  });

  it("en ESTE PR hay UN emisor; el 2.º (camino del admin) debe sumarse aqui cuando llegue", () => {
    // Cuando el PR del camino del ADMIN aterrice, este numero pasa a 2 y la lista gana su feed
    // (`origen_tipo = orden_incidente`). Que este assert exista es lo que impide que ese
    // emisor entre sin que nadie lo mire.
    expect(EMISORES_DECLARADOS).toHaveLength(1);
    expect(EMISORES_DECLARADOS[0].archivo).toBe("services/WalletIndemnizacionFeedService.ts");
  });

  it("NINGUN emisor vive en actions/, jobs/ ni en un handler de cron", () => {
    const sospechosos = emisoresEn(LIB_DIR).filter(
      (f) => f.startsWith("actions/") || f.includes("jobs/") || f.includes("handlers/"),
    );
    expect(sospechosos).toEqual([]);
  });

  it("el formulario manual de egresos (45) NO puede producirla", () => {
    // `TIPO_EGRESO_MANUAL_A_CATEGORIA` es el UNICO mapa del formulario manual: si la
    // indemnizacion entrara ahi, un maestro podria emitirla a mano, sin cierre ni aprobacion.
    const wallet = fs.readFileSync(path.join(LIB_DIR, "types", "wallet.ts"), "utf8");
    const mapa = wallet.slice(
      wallet.indexOf("TIPO_EGRESO_MANUAL_A_CATEGORIA"),
      wallet.indexOf("registrarEgresoAdministrativoSchema"),
    );
    expect(mapa).not.toMatch(/egreso_indemnizacion/);
    // Y el enum del formulario sigue teniendo SOLO dos tipos manuales.
    expect(wallet).toMatch(/TIPO_EGRESO_MANUAL_SEED = \["gasto_variable", "sueldo"\]/);
  });

  it("el guard DISCRIMINA: la expresion de emision no marca una simple mencion", () => {
    // Si `RE_EMISION` fuera el literal suelto, cualquier comentario que lo nombrara contaria
    // como emisor y el guard se volveria inutilizable. Se fija aqui.
    expect(RE_EMISION.test('// emite el egreso `egreso_indemnizacion` del cierre')).toBe(false);
    expect(RE_EMISION.test('sumaDe("egreso_indemnizacion")')).toBe(false);
    expect(RE_EMISION.test('categoria: "egreso_indemnizacion",')).toBe(true);
  });
});
