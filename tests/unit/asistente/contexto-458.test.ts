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

// FICHA 458-D (T D.8/T D.9): el bloque A de la oficina describía el DESGLOSE de `/wallet/tiendas` y
// de `/wallet/mensajeros` (su filtro de cierre, sus conceptos con número y su columna «Origen» con
// enlace). Los desgloses se retiraron (D14) y su ayuda se reescribió como la del ESTADO DE CUENTA: esos
// tres casos pasan al bloque D con lo que la pantalla hace HOY. Lo que se conserva del bloque A es que
// la ayuda de la oficina no llega a otros roles (arriba del bloque D, más abajo) y la de Mi wallet.

describe("458-A (bloque A) — lo de la oficina no sale de la oficina", () => {
  it.each(FUERA_DE_OFICINA)("%s NO recibe la ayuda de las tiendas ni la de los mensajeros (R103)", (rol) => {
    const slugs = contextoPara(docs, rol).map((d) => d.slug);
    expect(slugs).not.toContain("oficina/wallet-tiendas");
    expect(slugs).not.toContain("oficina/wallet-mensajeros");
    const todo = todoElContexto(rol);
    expect(todo).not.toContain("## El estado de cuenta de una tienda");
    expect(todo).not.toContain("## El estado de cuenta de un mensajero");
  });
});

describe("458-A (bloque A) — la tienda entiende sus filtros y sus orígenes en Mi wallet", () => {
  // FICHA 458-D (T D.5, cierre de pantalla): `/mi-wallet` es el estado de cuenta de la tienda. El filtro
  // por concepto de la 458-A (con su número y el «(0)») se retiró con el libro: lo sustituyen los chips,
  // y la ayuda ya no lo promete (bloque D, abajo). El origen con nombre se conserva.
  it("adminTienda: el origen con nombre; el filtro por concepto ya no se promete", () => {
    const wallet = cuerpoEnContexto("adminTienda", "tienda/mi-wallet");
    expect(wallet).toContain(
      "El **origen** lo dice con nombre, por ejemplo «Cierre del día · 2026-09-12» o «Gestión de orden · cobro por rechazo · guía 4321».",
    );
    expect(wallet).not.toContain("Solo aparecen los conceptos que **tienen movimientos**");
    expect(wallet).not.toContain("sigue elegido con **(0)**");
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
      // 458-C (TC.5): `DocumentoCajaAcciones` se retiró; la anulación vive en el panel «Ver».
      "components/shared/wallet/DetalleMovimientoPanel.tsx",
    ]) {
      expect(declaradas, `wallet-caja sin ${fuente}`).toContain(fuente);
    }
  });
});

// ── Bloque C — 458-C «Registrar un movimiento y panel Ver» ─────────────────────────────────────────
//
// La oficina puede preguntar cómo se registra con el diálogo único (diez conceptos, «a quién»,
// «Así queda», comprobante) y cómo se ve y se anula un movimiento (panel «Ver», «Anular…» uniforme,
// adjuntar el comprobante). Nada de eso llega a la tienda, al mensajero ni a la bodega (R103).

describe("458-C (bloque C) — la oficina puede preguntar cómo registrar, ver y anular un movimiento", () => {
  it.each(OFICINA)("%s: el diálogo único, sus diez conceptos y lo que pide cada uno", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("**Registrar un movimiento** abre un diálogo con **diez conceptos en tres grupos**");
    expect(caja).toContain(
      "**Sale dinero de Ordenex** | Gasto de Ordenex · Sueldo · Ordenex paga un gasto de una tienda · Corrección de caja (resta) · Ordenex le paga a una tienda · Ordenex le paga a un mensajero",
    );
    expect(caja).toContain("**a quién se le pagó** —la persona o el proveedor, con su nombre libre—. **Es obligatorio.**");
    expect(caja).toContain("la cuenta, que se elige **buscando por su nombre**");
    expect(caja).toContain("Solo se admite **hasta lo que Ordenex le debe** a esa tienda.");
  });

  it.each(OFICINA)("%s: «Así queda» con el antes y el después, «no cambia» y el aviso de saldo en contra", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("### «Así queda»: el antes y el después, antes de registrar");
    expect(caja).toContain("Lo que el concepto no mueve dice **«no cambia»**.");
    expect(caja).toContain("Si la tienda **queda con el saldo en contra**, el recuadro lo avisa en palabras");
    expect(caja).toContain("Si no se pudo calcular, lo dice y **no enseña cifras**");
  });

  it.each(OFICINA)("%s: «Ver», «Anular…» uniforme (también sueldo y gasto) y el comprobante que se adjunta una vez", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("## Ver un movimiento");
    expect(caja).toContain("**Ver**, en cada fila del libro, abre su detalle a un costado");
    expect(caja).toContain("se anulan desde el detalle de su fila: **Ver** y luego **Anular…**");
    expect(caja).toContain("Al anular un **gasto de Ordenex**, un **sueldo** o un **gasto fijo cobrado**");
    expect(caja).toContain("aparece **Adjuntar comprobante**, **una sola vez**");
    // D11: «Reversar» ya no existe en la ayuda de la caja.
    expect(caja).not.toMatch(/Reversar|Reversado/);
    expect(caja).not.toContain("**ocho conceptos en tres grupos**");
  });

  it("la caja y su diálogo NO llegan a la tienda, al mensajero ni a la bodega", () => {
    for (const rol of FUERA_DE_OFICINA) {
      const todo = todoElContexto(rol);
      expect(todo).not.toContain("### «Así queda»: el antes y el después, antes de registrar");
      expect(todo).not.toContain("## Ver un movimiento");
    }
  });

  it("oficina/wallet-caja declara como fuentes las piezas nuevas y ya no las retiradas", () => {
    const crudo = readFileSync(path.join(DIR_AYUDA, "oficina/wallet-caja.md"), "utf8");
    const declaradas = partirFrontmatter(crudo).datos.fuentes ?? [];
    for (const fuente of [
      "components/shared/wallet/RegistrarMovimientoDialog.tsx",
      "components/shared/wallet/AsiQueda.tsx",
      "components/shared/wallet/DetalleMovimientoPanel.tsx",
      "components/shared/wallet/AnularMovimientoDialog.tsx",
      "app/(app)/wallet/_components/VerMovimientoCaja.tsx",
    ]) {
      expect(declaradas, `wallet-caja sin ${fuente}`).toContain(fuente);
    }
    expect(declaradas).not.toContain("app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx");
    expect(declaradas).not.toContain("app/(app)/wallet/_components/DocumentoCajaAcciones.tsx");
  });
});

// ── Bloque D — 458-D «Estados de cuenta y Mi wallet» ──────────────────────────────────────────────
//
// La oficina puede preguntar cómo se lee el estado de cuenta de una tienda, un mensajero y una bodega
// (frase, saldo inicial, saldo corrido, chips, anulados), qué acciones tiene cada uno y cómo se anula un
// pago a un mensajero desde la wallet. La tienda puede preguntar cómo ve el comprobante que subió
// Ordenex. Nada de la oficina llega a la tienda, al mensajero ni a la bodega (R103).

describe("458-D (bloque D) — la oficina puede preguntar por los estados de cuenta", () => {
  it.each(OFICINA)("%s: el estado de cuenta de una tienda, sus cifras, su extracto y sus chips", (rol) => {
    const tiendas = cuerpoEnContexto(rol, "oficina/wallet-tiendas");
    expect(tiendas).toContain("## El estado de cuenta de una tienda");
    expect(tiendas).toContain("una frase que dice **quién le debe a quién**");
    expect(tiendas).toContain("Siempre se cumple: saldo inicial más abonos menos cargos es el saldo final.");
    expect(tiendas).toContain("La primera fila es el **saldo inicial** del periodo");
    expect(tiendas).toContain("**Todo · Cierres · Pagos · Cobros · Correcciones**");
    expect(tiendas).toContain("El saldo de cada fila **sigue siendo el de la cuenta entera**, aunque filtres");
    expect(tiendas).toContain("Si se anuló antes de que la wallet guardara el motivo, dice **«motivo no registrado»**.");
    expect(tiendas).toContain("La descarga trae **el periodo entero** que estás mirando");
  });

  it.each(OFICINA)("%s: las tres acciones de la tienda y cuándo aparece cada una", (rol) => {
    const tiendas = cuerpoEnContexto(rol, "oficina/wallet-tiendas");
    expect(tiendas).toContain("## Registrar desde el estado de cuenta");
    expect(tiendas).toContain("**La tienda le paga a Ordenex** — solo cuando la tienda está **en contra**");
    expect(tiendas).toContain("**Ordenex le cobra a la tienda** — siempre");
    expect(tiendas).toContain("el botón está apagado y lo dice: «Ordenex no le debe nada a…»");
    // Lo retirado no vuelve a la ayuda: ni el desglose ni su filtro de cierre por selector.
    expect(tiendas).not.toContain("## El desglose");
    expect(tiendas).not.toContain("## Filtrar el desglose");
  });

  it.each(OFICINA)("%s: el estado de cuenta del mensajero, su pago y la anulación desde la wallet (R70)", (rol) => {
    const mensajeros = cuerpoEnContexto(rol, "oficina/wallet-mensajeros");
    expect(mensajeros).toContain("## El estado de cuenta de un mensajero");
    expect(mensajeros).toContain("**Todo · Cierres · Pagos · Premios · Correcciones**");
    expect(mensajeros).toContain("**Ordenex le paga al mensajero**, en las acciones de su estado de cuenta");
    expect(mensajeros).toContain("## Anular un pago");
    expect(mensajeros).toContain("Es **la misma anulación que la de Cierres**");
    expect(mensajeros).not.toContain("## Filtrar el desglose por cierre");
  });

  it.each(OFICINA)("%s: el estado de cuenta de una bodega y la conciliación debajo (R31)", (rol) => {
    const satelites = cuerpoEnContexto(rol, "oficina/wallet-satelites");
    expect(satelites).toContain("## El estado de cuenta de una bodega");
    expect(satelites).toContain("**Todo · Declarado · Recibido**");
    expect(satelites).toContain("Debajo del estado de cuenta de la bodega están sus consolidaciones");
  });

  // Cierre de PANTALLA de la 458-D (R6–R8, R10, R19, TD.6): lo que el servidor ya daba y la pantalla
  // ahora monta. Frases literales: la ayuda dice lo que la pantalla hace hoy.
  it.each(OFICINA)("%s: filtrar por cierre, el origen con enlace, cómo se pagó y las órdenes de un cierre (tienda)", (rol) => {
    const tiendas = cuerpoEnContexto(rol, "oficina/wallet-tiendas");
    expect(tiendas).toContain("**Cierre**: un selector con búsqueda. Solo ofrece los cierres que tienen movimientos en **esta** tienda");
    expect(tiendas).toContain("se busca por un día (2026-09-12) o por el nombre del mensajero");
    expect(tiendas).toContain("y, cuando esa cosa tiene su pantalla, con un enlace **Ver** que te lleva a ella");
    expect(tiendas).toContain("Si el movimiento es un pago, dice **Cómo se pagó**: el método y la referencia");
    expect(tiendas).toContain("### Las órdenes de un cierre");
    expect(tiendas).toContain("**las órdenes de esta tienda que componen ese importe**");
    expect(tiendas).toContain("Si hay más movimientos de los que entran en una descarga, **no se descarga nada** y te lo dice");
    // Lo que la ayuda decía mientras faltaba el servidor no vuelve.
    expect(tiendas).not.toContain("todavía no se puede filtrar el estado de cuenta");
    expect(tiendas).not.toContain("No se abren las órdenes de un cierre desde el estado de cuenta");
  });

  it.each(OFICINA)("%s: el mensajero se filtra por cierre y su fila de cierre dice que no se reparte por orden", (rol) => {
    const mensajeros = cuerpoEnContexto(rol, "oficina/wallet-mensajeros");
    expect(mensajeros).toContain("un selector con búsqueda que solo ofrece los cierres con movimientos de este mensajero");
    expect(mensajeros).toContain("el pago de un cierre **no se reparte orden por orden**");
    expect(mensajeros).toContain("Para ver sus órdenes, abrí el cierre con el enlace **Ver** de la fila.");
    expect(mensajeros).not.toContain("No se filtra el estado de cuenta por cierre todavía");
  });

  it.each(FUERA_DE_OFICINA)("%s NO recibe la ayuda de los estados de cuenta (R103)", (rol) => {
    const slugs = contextoPara(docs, rol).map((d) => d.slug);
    expect(slugs).not.toContain("oficina/wallet-satelites");
    const todo = todoElContexto(rol);
    expect(todo).not.toContain("## Registrar desde el estado de cuenta");
    expect(todo).not.toContain("## El estado de cuenta de una bodega");
    expect(todo).not.toContain("## Anular un pago");
  });

  it("los cuatro documentos, actualizados el 2026-09-26 y con las fuentes de la 458-D", () => {
    const esperado: Record<string, string[]> = {
      "oficina/wallet-tiendas": [
        "app/(app)/wallet/tiendas/[tiendaId]/page.tsx",
        "components/shared/estado-cuenta/EstadoCuenta.tsx",
        "app/(app)/wallet/tiendas/_components/EstadoCuentaAcciones.tsx",
        "components/shared/estado-cuenta/SelectorCierreDeCuenta.tsx",
        "app/(app)/wallet/_components/ordenes-de-fila-cuenta.ts",
      ],
      "oficina/wallet-mensajeros": [
        "app/(app)/wallet/mensajeros/[mensajeroId]/page.tsx",
        "app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero.tsx",
        "components/shared/estado-cuenta/SelectorCierreDeCuenta.tsx",
        "app/(app)/wallet/_components/ordenes-de-fila-cuenta.ts",
      ],
      "oficina/wallet-satelites": [
        "app/(app)/wallet/satelites/[zonaId]/page.tsx",
        "app/(app)/wallet/satelites/_components/ConciliacionSatelite.tsx",
      ],
      "tienda/mi-wallet": [
        "app/(app)/mi-wallet/_components/VerComprobanteMiMovimiento.tsx",
        "app/(app)/mi-wallet/_components/MiEstadoCuenta.tsx",
        "components/shared/estado-cuenta/EstadoCuenta.tsx",
      ],
    };
    for (const [slug, fuentes] of Object.entries(esperado)) {
      const doc = docs.find((d) => d.slug === slug);
      expect(doc?.actualizado, slug).toBe("2026-09-26");
      const crudo = readFileSync(path.join(DIR_AYUDA, `${slug}.md`), "utf8");
      const declaradas = partirFrontmatter(crudo).datos.fuentes ?? [];
      for (const f of fuentes) expect(declaradas, `${slug} sin ${f}`).toContain(f);
      for (const retirada of [
        "app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx",
        "app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx",
        "app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx",
        "app/(app)/wallet/satelites/_components/DesgloseConsolidacionesSatelite.tsx",
        // Cierre de pantalla de la 458-D (T D.5): el libro de `/mi-wallet` se retiró.
        "app/(app)/mi-wallet/_components/MiWalletModule.tsx",
        "app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx",
        "app/(app)/mi-wallet/_components/MiWalletFiltros.tsx",
        "app/(app)/mi-wallet/_components/SaldoTiendaCard.tsx",
      ]) {
        expect(declaradas, `${slug} declara la retirada ${retirada}`).not.toContain(retirada);
      }
    }
  });
});

describe("458-D (bloque D) — la tienda puede preguntar cómo ve el comprobante (R78)", () => {
  it("adminTienda: Mi wallet explica «Ver comprobante», en qué filas y que solo ve los suyos", () => {
    const wallet = cuerpoEnContexto("adminTienda", "tienda/mi-wallet");
    expect(wallet).toContain("## Ver el comprobante");
    expect(wallet).toContain("lo podés abrir desde la fila con **Ver comprobante**");
    expect(wallet).toContain("Solo ves los de tu tienda.");
    expect(wallet).toContain("**No se sube ni se cambia ningún comprobante.** Los guarda la oficina; acá solo se ven.");
    expect(wallet).not.toContain("No se abre el comprobante de un pago que Ordenex hizo por ti");
  });

  // Cierre de pantalla de la 458-D (T D.5, R34/R35): `/mi-wallet` es el estado de cuenta de la tienda.
  it("adminTienda: Mi wallet es su estado de cuenta: la frase del saldo, el extracto, los chips y el cierre", () => {
    const wallet = cuerpoEnContexto("adminTienda", "tienda/mi-wallet");
    expect(wallet).toContain("La cifra grande es tu **saldo actual**, con una frase que dice **quién le debe a quién**");
    expect(wallet).toContain("**Ordenex te debe ₡…**");
    expect(wallet).toContain("**Le debés ₡… a Ordenex**");
    expect(wallet).toContain("## Tu estado de cuenta");
    expect(wallet).toContain("La primera fila es el **saldo inicial**");
    expect(wallet).toContain("El saldo de la última fila es el mismo de la cifra grande de arriba.");
    expect(wallet).toContain("## Filtrar tu estado de cuenta");
    expect(wallet).toContain("**Todo · Cierres · Pagos · Cobros · Correcciones**");
    expect(wallet).toContain("«Cierre del 2026-09-12 · 7 movimientos»");
    expect(wallet).toContain("Y podés **descargar tu estado de cuenta**");
    // Lo retirado con el libro no vuelve: ni la cabecera de tres importes ni el filtro por concepto.
    expect(wallet).not.toContain("Cargos de Ordenex");
    expect(wallet).not.toContain("Ya pagado");
    expect(wallet).not.toContain("**Por concepto**");
    // Tampoco se nombra a la gente de Ordenex: la tienda no ve quién registró ni quién anuló.
    expect(wallet).not.toContain("Registró:");
  });

  it.each(["mensajero", "adminSatelite"] as RolValue[])("%s NO recibe la explicación del comprobante de la tienda", (rol) => {
    expect(todoElContexto(rol)).not.toContain("## Ver el comprobante");
  });
});
