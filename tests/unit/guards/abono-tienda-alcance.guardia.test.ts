import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { CONCEPTOS_MANUALES } from "@/app/(app)/wallet/_components/wallet-conceptos-manuales";
import { TIPO_POR_CATEGORIA_TIENDA } from "@/lib/utils/invariante-tiendas";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

/**
 * FICHA 457 / T8.2 (design §12; R65, R67) — GUARDIA DE ALCANCE: **lo que la D3 de la 381 protegia,
 * conservado.** D3 rechazo un credito manual a una tienda SIN dinero detras. La 457 reabre el credito
 * SOLO para el pago de una tienda a Ordenex, que entra a la caja en la misma transaccion. Esta guardia
 * hace que eso no se pueda aflojar en silencio:
 *
 *   (1) el UNICO productor de `categoria: "abono_tienda"` en `lib/` es `AbonoTiendaService`;
 *   (2) `AbonoTiendaService` NO se construye sin su puerto de caja (el constructor lo exige por tipo, sin
 *       `?` ni default), y el metodo que escribe el credito llama a `emitirIngresoDeAbono` dentro del
 *       MISMO `runTransaction`;
 *   (3) el catalogo del dialogo «Registrar movimiento» no ofrece NINGUN concepto que acredite a una tienda
 *       salvo, si existe, el del pago de la tienda a Ordenex (clase `abono_tienda`), y como mucho uno.
 *
 * Las tres son AUSENCIAS, asi que cada una lleva su CONTROL DE NO-VACUIDAD y su CONTRAPRUEBA (una fuente
 * mutada la pone roja): sin eso un `grep` mal escrito da la misma salida vacia que un alcance respetado.
 * MUTACION 12 de design §13 (un segundo productor de `categoria: "abono_tienda"`) → rojo en (1).
 */

const RAIZ = path.resolve(__dirname, "../../..");

function fuentesDe(carpeta: string): string[] {
  const abs = path.join(RAIZ, carpeta);
  const salida: string[] = [];
  for (const entrada of readdirSync(abs)) {
    const rel = `${carpeta}/${entrada}`;
    if (statSync(path.join(RAIZ, rel)).isDirectory()) salida.push(...fuentesDe(rel));
    else if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) salida.push(rel);
  }
  return salida;
}

function codigo(ruta: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, ruta), "utf8"));
}

const FUENTES_LIB = fuentesDe("lib");

/** Un PRODUCTOR: escribe una fila del libro de la tienda con esa categoria (`categoria: "abono_tienda"`). */
const PRODUCE_CREDITO = /categoria:\s*"abono_tienda"/;

function productoresEn(fuentes: ReadonlyArray<[ruta: string, texto: string]>): string[] {
  return fuentes.filter(([, texto]) => PRODUCE_CREDITO.test(texto)).map(([ruta]) => ruta);
}

// ── (1) un solo productor ────────────────────────────────────────────────────────────────────────

describe("457/R65 — el UNICO productor del credito `abono_tienda` es `AbonoTiendaService`", () => {
  const censo = FUENTES_LIB.map((r): [string, string] => [r, codigo(r)]);

  it("control de NO-VACUIDAD: `lib/` es grande y la categoria se nombra en varios sitios (tipos, tablas, textos)", () => {
    expect(FUENTES_LIB.length).toBeGreaterThan(300);
    const queLaNombran = censo.filter(([, t]) => /"abono_tienda"/.test(t)).map(([r]) => r);
    expect(queLaNombran.length).toBeGreaterThan(3);
    expect(queLaNombran).toContain("lib/types/wallet-tienda.ts");
  });

  it("el censo de productores es EXACTAMENTE el servicio", () => {
    expect(productoresEn(censo)).toEqual(["lib/services/AbonoTiendaService.ts"]);
  });

  it("CONTRAPRUEBA (mutacion 12): un segundo productor se detecta", () => {
    const intruso: [string, string] = [
      "lib/services/Intruso.ts",
      `await this.tiendaRepo.crearMovimientos(tx, [{ tiendaId, tipo: "credito", categoria: "abono_tienda", monto }]);`,
    ];
    expect(productoresEn([...censo, intruso]).sort()).toEqual(["lib/services/AbonoTiendaService.ts", "lib/services/Intruso.ts"]);
    // Y el detector no confunde el DEBITO de la anulacion con el credito.
    expect(PRODUCE_CREDITO.test(`categoria: "abono_tienda_anulado"`)).toBe(false);
  });
});

// ── (2) sin caja no se construye, y el credito y la entrada van juntos ──────────────────────────

describe("457/R65 — `AbonoTiendaService` exige su puerto de caja y lo llama en la MISMA transaccion que el credito", () => {
  const servicio = codigo("lib/services/AbonoTiendaService.ts");

  it("el constructor declara `caja: ICajaAbonoTiendaFeedService` sin `?` ni valor por defecto", () => {
    expect(servicio).toMatch(/private readonly caja:\s*ICajaAbonoTiendaFeedService,/);
    expect(servicio).not.toMatch(/caja\?:\s*ICajaAbonoTiendaFeedService/);
    expect(servicio).not.toMatch(/caja:\s*ICajaAbonoTiendaFeedService\s*=/);
  });

  it("dentro del `runTransaction` de `registrar`, el credito `abono_tienda` y `emitirIngresoDeAbono` van juntos, en ese orden", () => {
    const registrar = servicio.slice(servicio.indexOf("async registrar("), servicio.indexOf("async anular("));
    expect(registrar.length).toBeGreaterThan(500);
    const tx = registrar.slice(registrar.indexOf("this.runTransaction(async (tx) =>"));
    const credito = tx.search(PRODUCE_CREDITO);
    const caja = tx.indexOf("this.caja.emitirIngresoDeAbono(tx,");
    expect(credito).toBeGreaterThan(-1);
    expect(caja).toBeGreaterThan(credito);
    // Y no hay ninguna otra escritura en la caja alcanzable desde el servicio: solo el puerto.
    expect(servicio).not.toMatch(/walletMovimiento\./);
    expect(servicio).not.toMatch(/cajaRepo/);
  });

  it("CONTRAPRUEBA (mutacion 1): quitar la llamada a la caja se detecta", () => {
    const mutado = servicio.replace("await this.caja.emitirIngresoDeAbono(tx, {", "await Promise.resolve({");
    expect(mutado).not.toBe(servicio);
    const registrar = mutado.slice(mutado.indexOf("async registrar("), mutado.indexOf("async anular("));
    expect(registrar.indexOf("this.caja.emitirIngresoDeAbono(tx,")).toBe(-1);
  });
});

// ── (3) el dialogo: como mucho UN concepto acredita a una tienda, y es el pago de la tienda a Ordenex ──

type Concepto = (typeof CONCEPTOS_MANUALES)[number];

/** Los conceptos del dialogo cuyo asiento en el libro de la tienda es un CREDITO. */
function conceptosQueAcreditan(catalogo: readonly Concepto[]): string[] {
  return catalogo
    .filter((c) => {
      const d = c.destino as { categoriaTienda?: keyof typeof TIPO_POR_CATEGORIA_TIENDA };
      return d.categoriaTienda !== undefined && TIPO_POR_CATEGORIA_TIENDA[d.categoriaTienda] === "credito";
    })
    .map((c) => c.id);
}

describe("457/R67 — el unico concepto del dialogo que acredita a una tienda es el pago de la tienda a Ordenex", () => {
  it("control de NO-VACUIDAD: el catalogo tiene conceptos con asiento en la tienda (los que la debitan)", () => {
    const conTienda = CONCEPTOS_MANUALES.filter((c) => "categoriaTienda" in c.destino);
    expect(conTienda.length).toBeGreaterThanOrEqual(2);
    expect(TIPO_POR_CATEGORIA_TIENDA.abono_tienda).toBe("credito");
  });

  it("los conceptos que acreditan son, como mucho, uno: el de clase `abono_tienda`", () => {
    const acreditan = conceptosQueAcreditan(CONCEPTOS_MANUALES);
    expect(acreditan.length).toBeLessThanOrEqual(1);
    for (const id of acreditan) {
      const c = CONCEPTOS_MANUALES.find((x) => x.id === id);
      expect(c?.destino.clase, id).toBe("abono_tienda");
      expect((c?.destino as { categoriaTienda?: string }).categoriaTienda, id).toBe("abono_tienda");
    }
  });

  it("CONTRAPRUEBA: un concepto que acreditara con `cobro_tienda_anulado` o `ajuste_credito` se detecta", () => {
    const intruso = {
      ...CONCEPTOS_MANUALES[0],
      id: "credito_a_mano",
      destino: { clase: "cobro_tienda", categoria: "egreso_reverso_cobro_tienda", categoriaTienda: "cobro_tienda_anulado" },
    } as unknown as Concepto;
    expect(conceptosQueAcreditan([...CONCEPTOS_MANUALES, intruso])).toContain("credito_a_mano");
    const otro = { ...intruso, id: "ajuste", destino: { ...intruso.destino, categoriaTienda: "ajuste_credito" } } as unknown as Concepto;
    expect(conceptosQueAcreditan([...CONCEPTOS_MANUALES, intruso, otro]).length).toBeGreaterThan(1);
  });
});
