import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contextoPara } from "@/lib/asistente/contexto";
import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { partirFrontmatter } from "@/lib/ayuda/frontmatter";
import type { RolValue } from "@prisma/client";

const DIR_AYUDA = path.resolve(__dirname, "../../..", "docs", "ayuda");

/**
 * FICHA 458 (R102/R103) — la ayuda y el asistente al día con el rediseño de la wallet, UN BLOQUE POR
 * HIJA (tasks.md, «Reglas para TODAS las hijas»). Molde: `contexto-457.test.ts`.
 *
 * El asistente solo sabe lo que está en `docs/ayuda/**` y, de eso, solo lo que el rol puede leer
 * (`contextoPara`). Las frases son LITERALES del documento, escritas a mano: son el contrato de lo que
 * el asistente tiene que poder explicar.
 *
 * Bloque B (458-B, revision m3): la hija deja VISIBLE en `/wallet` «Anular…» en la indemnizacion por
 * un incidente y en las dos lineas del cobro por rechazo a una tienda, y la analitica descuenta esa
 * anulacion (B2). Esas frases no llegan a la tienda, al mensajero ni a la bodega.
 */

const docs = await leerCatalogoAyuda();

function plano(texto: string): string {
  return texto.replace(/\s+/g, " ");
}

function cuerpoEnContexto(rol: RolValue, slug: string): string {
  const doc = contextoPara(docs, rol).find((d) => d.slug === slug);
  expect(doc, `${rol} no recibe ${slug}`).toBeDefined();
  return plano(doc?.cuerpo ?? "");
}

function todoElContexto(rol: RolValue): string {
  return contextoPara(docs, rol)
    .map((d) => plano(d.cuerpo))
    .join(" ");
}

const OFICINA: RolValue[] = ["maestro", "admin"];
const FUERA_DE_OFICINA: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];

// ── Bloque A — 458-A «Detalles y guardias»: selector de cierre, conceptos con cuenta, origen con nombre ──

describe("458-A (bloque A) — la oficina puede preguntar cómo filtrar y de dónde viene cada movimiento", () => {
  it.each(OFICINA)("%s: Wallet · Tiendas explica el selector de cierre y los conceptos con su número", (rol) => {
    const tiendas = cuerpoEnContexto(rol, "oficina/wallet-tiendas");
    expect(tiendas).toContain("## Filtrar el desglose");
    expect(tiendas).toContain(
      "**Cierre**: se elige de la lista de cierres **de esta tienda** que tienen movimientos, cada uno con su día, el mensajero y cuántos movimientos trajo. Podés buscar **por día (2026-09-12) o por el nombre del mensajero**.",
    );
    expect(tiendas).toContain("No hace falta copiar ni pegar nada.");
    expect(tiendas).toContain(
      "**Concepto**: solo aparecen los conceptos que **tienen movimientos** de esta tienda en el periodo (y el cierre) que elegiste, cada uno con su número entre paréntesis",
    );
    expect(tiendas).toContain("sigue elegido con **(0)** hasta que lo quites.");
  });

  it.each(OFICINA)("%s: Wallet · Tiendas explica el origen con nombre y el enlace «Ver»", (rol) => {
    const tiendas = cuerpoEnContexto(rol, "oficina/wallet-tiendas");
    expect(tiendas).toContain("## De dónde viene cada movimiento");
    expect(tiendas).toContain(
      "La columna **Origen** dice qué produjo cada movimiento, con nombre: «Cierre del día · 2026-09-12 · Juan Pérez Mora», «Gestión de orden · cobro por rechazo · guía 4321»",
    );
    expect(tiendas).toContain("al lado aparece **Ver**, que te lleva al cierre, a la orden o al ranking de ese día.");
  });

  it.each(OFICINA)("%s: Wallet · Mensajeros explica el selector de cierre, sin pegar identificadores", (rol) => {
    const mensajeros = cuerpoEnContexto(rol, "oficina/wallet-mensajeros");
    expect(mensajeros).toContain("## Filtrar el desglose por cierre");
    expect(mensajeros).toContain(
      "El filtro **Cierre** se elige de la lista de cierres **de este mensajero** que tienen movimientos, cada uno con su día y cuántos movimientos trajo. Podés buscar **por día (2026-09-12) o por nombre**.",
    );
    expect(mensajeros).toContain("Ya no hay que copiar la dirección de ningún enlace ni pegar nada");
    expect(mensajeros).toContain("La fila que viene de un cierre lleva además **Ver el cierre**.");
    // La ayuda vieja («copiá su dirección y pegala») no vuelve.
    expect(mensajeros).not.toMatch(/copiá su dirección y pegala/);
  });

  it.each(FUERA_DE_OFICINA)("%s NO recibe la ayuda de las tiendas ni la de los mensajeros (R103)", (rol) => {
    const slugs = contextoPara(docs, rol).map((d) => d.slug);
    expect(slugs).not.toContain("oficina/wallet-tiendas");
    expect(slugs).not.toContain("oficina/wallet-mensajeros");
    const todo = todoElContexto(rol);
    expect(todo).not.toContain("## Filtrar el desglose por cierre");
    expect(todo).not.toContain("de esta tienda** que tienen movimientos, cada uno con su día, el mensajero");
  });
});

describe("458-A (bloque A) — la tienda entiende sus filtros y sus orígenes en Mi wallet", () => {
  it("adminTienda: conceptos con su número y el elegido con (0); origen con nombre", () => {
    const wallet = cuerpoEnContexto("adminTienda", "tienda/mi-wallet");
    expect(wallet).toContain(
      "Solo aparecen los conceptos que **tienen movimientos** tuyos en el periodo (y el cierre) que elegiste, cada uno con su número entre paréntesis, por ejemplo «Ordenex te cobró el flete (8)».",
    );
    expect(wallet).toContain("sigue elegido con **(0)** hasta que lo quites.");
    expect(wallet).toContain(
      "La columna **Origen** lo dice con nombre, por ejemplo «Cierre del día · 2026-09-12» o «Gestión de orden · cobro por rechazo · guía 4321».",
    );
  });

  it.each(["mensajero", "adminSatelite"] as RolValue[])("%s NO recibe Mi wallet", (rol) => {
    expect(contextoPara(docs, rol).map((d) => d.slug)).not.toContain("tienda/mi-wallet");
  });
});

// ── Bloque B — 458-B «Cimientos»: anulación del cobro por rechazo y de la indemnización ──

describe("458-B (bloque B) — la oficina puede preguntar por la anulacion del cobro por rechazo y de la indemnizacion", () => {
  it.each(OFICINA)("%s: la caja dice que se anulan, como, y que la analitica lo descuenta", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("Tampoco un **cobro por rechazo a una tienda** ni una **indemnización por un incidente**.");
    expect(caja).toContain("se anula desde **cualquiera de las dos** y se anulan **las dos juntas**");
    expect(caja).toContain("**Flete por rechazo cobrado a la tienda anulado**");
    expect(caja).toContain("**IVA del flete por rechazo cobrado a la tienda anulado**");
    expect(caja).toContain(
      "En **Analítica**, «Ingreso por flete» e «Ingreso por IVA» descuentan la anulación: el **neto** vuelve a ser el de antes del cobro.",
    );
    expect(caja).toContain("Al anular una **indemnización**, aparece una **Corrección de caja (suma)** por el mismo monto");
  });

  it("la caja NO llega a la tienda, al mensajero ni a la bodega", () => {
    for (const rol of ["adminTienda", "mensajero", "adminSatelite"] as RolValue[]) {
      expect(contextoPara(docs, rol).map((d) => d.slug)).not.toContain("oficina/wallet-caja");
    }
  });

  it("oficina/wallet-caja: actualizado el 2026-09-26 y con las fuentes de la anulacion", () => {
    const doc = docs.find((d) => d.slug === "oficina/wallet-caja");
    expect(doc?.actualizado).toBe("2026-09-26");
    const crudo = readFileSync(path.join(DIR_AYUDA, "oficina/wallet-caja.md"), "utf8");
    const declaradas = partirFrontmatter(crudo).datos.fuentes ?? [];
    for (const fuente of [
      "lib/services/RechazoTiendaCobroService.ts",
      "lib/services/EgresoCajaAnulacionService.ts",
      "lib/actions/wallet-anulacion.ts",
      "app/(app)/wallet/_components/DocumentoCajaAcciones.tsx",
    ]) {
      expect(declaradas, `wallet-caja sin ${fuente}`).toContain(fuente);
    }
  });
});
