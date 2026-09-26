import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contextoPara } from "@/lib/asistente/contexto";
import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { partirFrontmatter } from "@/lib/ayuda/frontmatter";
import type { RolValue } from "@prisma/client";

const DIR_AYUDA = path.resolve(__dirname, "../../..", "docs", "ayuda");

/**
 * FICHA 457 (T7.1, design §11, R68/R69) — la ayuda y el asistente al día con el pago de una tienda a
 * Ordenex. Molde: `contexto-461.test.ts`.
 *
 * El asistente solo sabe lo que está en `docs/ayuda/**` y, de eso, solo lo que el rol puede leer
 * (`contextoPara`). Aquí se afirma que las explicaciones nuevas LLEGAN al contexto del rol que las
 * necesita —maestro y admin: la caja y las tiendas; adminTienda: Mi wallet— y que la de la caja NO llega
 * a mensajero, adminTienda ni adminSatelite (R69).
 *
 * Las frases son LITERALES de `design.md` §11, a propósito: son el contrato de lo que el asistente tiene
 * que poder explicar; no se leen de la fuente que las genera.
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

describe("457 R68/R69 — la oficina puede preguntar por el pago de una tienda a Ordenex", () => {
  it.each(OFICINA)("%s: la caja nombra el concepto, su anulación y su origen, y el diálogo con ocho conceptos", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain(
      "**Una tienda le paga a Ordenex** / **Pago de una tienda a Ordenex anulado** | Lo que una tienda con saldo en contra le paga a Ordenex, y su anulación. Es dinero de la tienda: sube lo que Ordenex les debe a las tiendas",
    );
    expect(caja).toContain("**Pago de una tienda a Ordenex**");
    expect(caja).toContain("**ocho conceptos en tres grupos**");
    expect(caja).toContain(
      "**Llega dinero a la caja** | Aporte de dinero a la caja · Una tienda le paga a Ordenex · Corrección de caja (suma)",
    );
  });

  it.each(OFICINA)("%s: la caja explica el efecto —llega dinero de la tienda, su saldo sube, la ganancia no cambia— y el tope", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("## Una tienda le paga a Ordenex: llega dinero de la tienda y su saldo sube");
    expect(caja).toContain("**Entró** y la cifra grande suben en el monto.");
    expect(caja).toContain("**Lo que Ordenex les debe a las tiendas** sube en el monto: la deuda de esa tienda baja.");
    expect(caja).toContain(
      "La **ganancia de Ordenex no cambia**: lo que la tienda debía ya se contó como ganancia al aprobar cada cierre.",
    );
    expect(caja).toContain("Solo se admite si la tienda tiene **saldo en contra**, y **hasta lo que debe**.");
    // Qué se pide y cómo sale en cada libro.
    expect(caja).toContain("**en SINPE y transferencia la referencia es obligatoria**");
    expect(caja).toContain("dueño **Tienda**");
    expect(caja).toContain("«La tienda le paga a Ordenex»");
    expect(caja).toContain("«Le pagaste a Ordenex»");
    expect(caja).toContain("**Registrar pago de la tienda a Ordenex**");
  });

  it.each(OFICINA)("%s: la caja explica la anulación y el comprobante", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain(
      "Al anular un pago de una tienda a Ordenex, **Salió** sube en el monto, la cifra grande y **lo que Ordenex les debe a las tiendas** bajan en el monto —la tienda vuelve a deber— y la ganancia no cambia. En la caja aparece **Pago de una tienda a Ordenex anulado**; en el libro de la tienda, «Pago de la tienda a Ordenex anulado».",
    );
    expect(caja).toContain("El pago de una tienda a Ordenex sí puede llevarlo.");
    expect(caja).toContain("un **pago de una tienda a Ordenex** o una **corrección de caja** no se editan");
  });

  it.each(OFICINA)("%s: Wallet · Tiendas nombra el pago y su anulación y dice cómo registrarlo", (rol) => {
    const tiendas = cuerpoEnContexto(rol, "oficina/wallet-tiendas");
    expect(tiendas).toContain(
      "**La tienda le paga a Ordenex** | Lo que la tienda le pagó a Ordenex cuando estaba en contra. Su saldo sube | **Sí**: entró dinero de la tienda",
    );
    expect(tiendas).toContain(
      "**Pago de la tienda a Ordenex anulado** | La anulación de ese pago: el saldo vuelve a bajar | Vuelve a salir",
    );
    expect(tiendas).toContain("## Registrar un pago de la tienda a Ordenex");
    expect(tiendas).toContain(
      "Cuando una tienda está **en contra**, desde las acciones de su desglose registrás el pago que ella le hizo a Ordenex: **Registrar pago de la tienda a Ordenex**. Se pide el monto —hasta lo que debe—, la fecha real, el motivo, el método (con referencia en SINPE y transferencia) y un comprobante opcional. Su saldo sube en el monto y la fila se actualiza sola. Se anula desde **Wallet · Caja**, en el libro, con motivo.",
    );
    expect(tiendas).toContain("ni se anulan pagos de la tienda a Ordenex");
  });

  it.each(FUERA_DE_OFICINA)("%s NO recibe la ayuda de la caja ni la de las tiendas (R69)", (rol) => {
    const slugs = contextoPara(docs, rol).map((d) => d.slug);
    expect(slugs).not.toContain("oficina/wallet-caja");
    expect(slugs).not.toContain("oficina/wallet-tiendas");
    const todo = textoDelContexto(rol);
    expect(todo).not.toContain("## Una tienda le paga a Ordenex: llega dinero de la tienda y su saldo sube");
    expect(todo).not.toContain("## Registrar un pago de la tienda a Ordenex");
  });
});

describe("457 R68/R69 — la tienda entiende su pago a Ordenex en Mi wallet, desde su lado", () => {
  it("adminTienda: Mi wallet lee el pago y su anulación en segunda persona", () => {
    const wallet = cuerpoEnContexto("adminTienda", "tienda/mi-wallet");
    expect(wallet).toContain(
      "- **Le pagaste a Ordenex** — lo que le pagaste a Ordenex cuando tu saldo estaba en contra.",
    );
    expect(wallet).toContain(
      "- **Ordenex anuló el pago que le hiciste** — la anulación de un pago tuyo registrado por error: tu saldo vuelve a bajar.",
    );
    expect(wallet).toContain("## Un pago que le hiciste a Ordenex");
    expect(wallet).toContain(
      "Si tu saldo quedó en contra y le pagaste a Ordenex, lo ves como **Le pagaste a Ordenex**, con el motivo, el método y la referencia. **Sube tu saldo** en el monto. Si la oficina lo anula por error, aparece **Ordenex anuló el pago que le hiciste** y tu saldo vuelve a bajar. El comprobante de tu pago lo guarda la oficina.",
    );
    // La tienda NO lee los nombres desde Ordenex (R47).
    expect(wallet).not.toContain("La tienda le paga a Ordenex");
  });

  it("mensajero y adminSatelite no reciben Mi wallet", () => {
    for (const rol of ["mensajero", "adminSatelite"] as RolValue[]) {
      expect(contextoPara(docs, rol).map((d) => d.slug)).not.toContain("tienda/mi-wallet");
    }
  });
});

describe("457 R68 — cada documento tocado declara su fecha y las fuentes del pago", () => {
  it.each([
    ["oficina/wallet-caja", ["lib/services/AbonoTiendaService.ts", "lib/utils/descripcion-abono.ts", "lib/actions/abono-tienda.ts"]],
    ["oficina/wallet-tiendas", ["lib/services/AbonoTiendaService.ts", "lib/utils/descripcion-abono.ts"]],
    ["tienda/mi-wallet", ["lib/services/AbonoTiendaService.ts", "lib/utils/descripcion-abono.ts"]],
  ] as const)("%s: actualizado el 2026-09-25 y con las fuentes del pago", (slug, fuentes) => {
    const doc = docs.find((d) => d.slug === slug);
    expect(doc).toBeDefined();
    expect(doc?.actualizado).toBe("2026-09-25");
    const crudo = readFileSync(path.join(DIR_AYUDA, `${slug}.md`), "utf8");
    const declaradas = partirFrontmatter(crudo).datos.fuentes ?? [];
    for (const fuente of fuentes) expect(declaradas, `${slug} sin ${fuente}`).toContain(fuente);
  });
});
