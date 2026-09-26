import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contextoPara } from "@/lib/asistente/contexto";
import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { partirFrontmatter } from "@/lib/ayuda/frontmatter";
import type { RolValue } from "@prisma/client";

const DIR_AYUDA = path.resolve(__dirname, "../../..", "docs", "ayuda");

/**
 * FICHA 461 (T D.1, design §11, R56/R57/R58) — la ayuda y el asistente al día con el cobro de Ordenex a
 * una tienda y con los nombres nuevos.
 *
 * El asistente solo sabe lo que está en `docs/ayuda/**` y, de eso, solo lo que el rol puede leer
 * (`contextoPara`). Este archivo afirma que las explicaciones nuevas LLEGAN al contexto del rol que
 * las necesita —maestro y admin reciben la caja y las tiendas; adminTienda recibe Mi wallet— y que la
 * de la caja NO llega a mensajero, adminTienda ni adminSatelite (R57).
 *
 * Los textos esperados son LITERALES a propósito (design §11), no se leen de la fuente que los genera:
 * son el contrato de lo que el asistente tiene que poder explicar. Si alguien los borra o los
 * reescribe de forma que dejen de decir lo mismo, este archivo se pone rojo y obliga a mirar el
 * documento.
 */

const docs = await leerCatalogoAyuda();

/** El Markdown con los saltos de línea y los espacios repetidos reducidos a uno. */
function plano(texto: string): string {
  return texto.replace(/\s+/g, " ");
}

function textoDelContexto(rol: RolValue): string {
  return contextoPara(docs, rol)
    .map((doc) => plano(doc.cuerpo))
    .join(" ");
}

function cuerpoEnContexto(rol: RolValue, slug: string): string {
  const doc = contextoPara(docs, rol).find((d) => d.slug === slug);
  expect(doc, `${rol} no recibe ${slug}`).toBeDefined();
  return plano(doc?.cuerpo ?? "");
}

const OFICINA: RolValue[] = ["maestro", "admin"];
const FUERA_DE_OFICINA: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];

describe("461 R56/R57 — la oficina puede preguntar por el cobro de Ordenex a una tienda", () => {
  it.each(OFICINA)("%s: la caja explica el cobro como cargo —no llega dinero nuevo, es ganancia— y su anulación", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    // design §11 — frases literales.
    expect(caja).toContain("## Ordenex le cobra a una tienda: se descuenta de su saldo y es ganancia");
    expect(caja).toContain("**No llega dinero nuevo**");
    expect(caja).toContain("pasa a ser **ganancia de Ordenex**");
    expect(caja).toContain("**Anular…**");
    // El efecto en las tres cifras, dicho en palabras.
    expect(caja).toContain("La **ganancia de Ordenex** sube en el monto.");
    expect(caja).toContain("**Entró**, **Salió** y la cifra grande **no cambian**.");
    expect(caja).toContain("**su saldo queda en contra**");
    // Y la anulación, con sus contra-asientos y su efecto.
    expect(caja).toContain("Al anular un cobro de Ordenex a una tienda, la **ganancia baja** en el monto");
    expect(caja).toContain("**Cobro a una tienda anulado**");
  });

  it.each(OFICINA)("%s: la tabla de los dos conceptos dice que el cobro NO cambia el dinero de la caja", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("## Ordenex paga un gasto de una tienda, u Ordenex le cobra a una tienda: no son lo mismo");
    expect(caja).toContain("**Baja: sale dinero**");
    expect(caja).toContain("**No cambia el dinero: pasa del saldo de la tienda a la ganancia de Ordenex**");
    expect(caja).toContain("Ordenex le paga **₡50.000 a Facebook**");
  });

  // FICHA 457 (T7.1) — REESCRITO (listado en `progress/impl_457.md`): el grupo «Llega dinero a la caja»
  // gana «Una tienda le paga a Ordenex» y el diálogo pasa a tener ocho conceptos (R68). Lo que la 461
  // fijaba aquí —los nombres y los tres grupos— se conserva literal.
  it.each(OFICINA)("%s: los ocho conceptos del diálogo con sus nombres y sus tres grupos", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("**Sale dinero de Ordenex** | Gasto de Ordenex · Sueldo · Ordenex paga un gasto de una tienda · Corrección de caja (resta)");
    expect(caja).toContain("**Llega dinero a la caja** | Aporte de dinero a la caja · Una tienda le paga a Ordenex · Corrección de caja (suma)");
    expect(caja).toContain("**Se descuenta del saldo de una tienda** | Ordenex le cobra a una tienda");
  });

  it.each(OFICINA)("%s: «De las tiendas» nombra lo que Ordenex les cobró y ya no dice que no pasa por la caja (R50/R56)", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("ya descontados el flete, la comisión, el impuesto y **lo que Ordenex les cobró**");
    expect(caja).not.toMatch(/sin pasar por la caja/i);
    expect(caja).not.toMatch(/no mueve la caja/i);
  });

  it.each(OFICINA)("%s: Wallet · Tiendas distingue el cobro, su anulación y el pago de un gasto, desde Ordenex", (rol) => {
    const tiendas = cuerpoEnContexto(rol, "oficina/wallet-tiendas");
    expect(tiendas).toContain("**Ordenex le cobra a la tienda**");
    expect(tiendas).toContain("**Cobro de Ordenex a la tienda anulado**");
    expect(tiendas).toContain("**Ordenex paga un gasto de la tienda**");
    expect(tiendas).toContain("**es ganancia de Ordenex**");
  });

  it.each(FUERA_DE_OFICINA)("%s NO recibe la ayuda de la caja (R57)", (rol) => {
    expect(contextoPara(docs, rol).map((d) => d.slug)).not.toContain("oficina/wallet-caja");
    expect(contextoPara(docs, rol).map((d) => d.slug)).not.toContain("oficina/wallet-tiendas");
    const todo = textoDelContexto(rol);
    expect(todo).not.toContain("## Ordenex le cobra a una tienda: se descuenta de su saldo y es ganancia");
    expect(todo).not.toContain("**Ordenex le cobra a la tienda**");
  });
});

describe("461 R56/R57 — la tienda entiende un cobro de Ordenex en Mi wallet, desde su lado", () => {
  it("adminTienda: Mi wallet lee el cobro, su anulación y el pago de un gasto en segunda persona", () => {
    const wallet = cuerpoEnContexto("adminTienda", "tienda/mi-wallet");
    // design §11 — frases literales.
    expect(wallet).toContain("**Ordenex te cobró**");
    expect(wallet).toContain("**Ordenex anuló un cobro y te lo devolvió**");
    expect(wallet).toContain("**Ordenex pagó un gasto por ti**");
    expect(wallet).toContain("## Un cobro que Ordenex te hizo");
    expect(wallet).toContain("**tu saldo queda en contra**");
    // Y dice que la anulación la hace la oficina, no la tienda.
    expect(wallet).toContain("**No se anula ningún cobro ni ningún pago desde acá.**");
  });

  it("adminTienda NO recibe la caja ni las tiendas de la oficina; mensajero y adminSatelite tampoco Mi wallet", () => {
    for (const rol of ["mensajero", "adminSatelite"] as RolValue[]) {
      expect(contextoPara(docs, rol).map((d) => d.slug)).not.toContain("tienda/mi-wallet");
    }
    expect(contextoPara(docs, "adminTienda").map((d) => d.slug)).not.toContain("oficina/wallet-caja");
  });
});

describe("461 R58 — cada documento tocado declara su fecha y las fuentes de lo que afirma", () => {
  it.each([
    ["oficina/wallet-caja", ["lib/services/CobroTiendaService.ts", "lib/services/CajaCobroTiendaFeedService.ts", "lib/utils/descripcion-cobro-tienda.ts", "app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts"]],
    ["oficina/wallet-tiendas", ["lib/services/CobroTiendaService.ts", "lib/utils/descripcion-cobro-tienda.ts", "app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts"]],
    ["tienda/mi-wallet", ["lib/services/CobroTiendaService.ts", "app/(app)/mi-wallet/_components/mi-wallet-labels.ts"]],
  ] as const)("%s: actualizado el 2026-09-25 o después y con las fuentes del cobro", (slug, fuentes) => {
    const doc = docs.find((d) => d.slug === slug);
    expect(doc).toBeDefined();
    // 458-A (R102): un documento tocado por una ficha POSTERIOR actualiza su fecha; lo que esta
    // ficha fija es que se actualizó al menos con ella, no que nadie lo vuelva a tocar.
    expect((doc?.actualizado ?? "") >= "2026-09-25").toBe(true);
    // `fuentes` no viaja en el catálogo a propósito (es para auditar, no para leer): se lee del
    // frontmatter crudo, como hace la guardia `asistente-sin-frontmatter`.
    const crudo = readFileSync(path.join(DIR_AYUDA, `${slug}.md`), "utf8");
    const declaradas = partirFrontmatter(crudo).datos.fuentes ?? [];
    for (const fuente of fuentes) expect(declaradas, `${slug} sin ${fuente}`).toContain(fuente);
  });
});
