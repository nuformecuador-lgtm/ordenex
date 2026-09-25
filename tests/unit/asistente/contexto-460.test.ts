import { describe, expect, it } from "vitest";

import { contextoPara } from "@/lib/asistente/contexto";
import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { NOMBRE_ESTADO } from "@/lib/types/order-status";
import type { RolValue } from "@prisma/client";

/**
 * FICHA 460 — la ayuda y el asistente al día con la 454, la 456 y la 459.
 *
 * El asistente solo sabe lo que está en `docs/ayuda/**` y, de eso, solo lo que el rol puede leer
 * (`contextoPara`). Este archivo afirma que las explicaciones nuevas LLEGAN al contexto del rol que
 * las necesita, y que no llegan al que no debe verlas.
 *
 * Los textos esperados son LITERALES a propósito (no se leen de la fuente que los genera): son el
 * contrato de lo que el asistente tiene que poder explicar. Si alguien los borra o los reescribe
 * de forma que dejen de decir lo mismo, este archivo se pone rojo y obliga a mirar el documento.
 */

const docs = await leerCatalogoAyuda();

/**
 * El Markdown con los saltos de línea y los espacios repetidos reducidos a uno: los documentos
 * cortan las líneas a ~100 columnas, y una frase no deja de estar porque cambie dónde se corta.
 */
function plano(texto: string): string {
  return texto.replace(/\s+/g, " ");
}

/** Todo el texto que el asistente recibe para ese rol, en una sola cadena. */
function textoDelContexto(rol: RolValue): string {
  return contextoPara(docs, rol)
    .map((doc) => plano(doc.cuerpo))
    .join(" ");
}

/** El cuerpo de UN documento dentro del contexto del rol (falla si no está). */
function cuerpoEnContexto(rol: RolValue, slug: string): string {
  const doc = contextoPara(docs, rol).find((d) => d.slug === slug);
  expect(doc, `${rol} no recibe ${slug}`).toBeDefined();
  return plano(doc?.cuerpo ?? "");
}

const OFICINA: RolValue[] = ["maestro", "admin"];
const FUERA_DE_OFICINA: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];
const PERSONAS: RolValue[] = [...OFICINA, ...FUERA_DE_OFICINA];

describe("459 — la oficina puede preguntar por la caja nueva", () => {
  it.each(OFICINA)("%s: la diferencia entre pago por cuenta y cobrar un costo, con su ejemplo", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("Pago por cuenta de una tienda, o cobrar un costo: no son lo mismo");
    expect(caja).toContain("¿salió dinero de Ordenex hacia otra persona?");
    expect(caja).toContain("Elegir el equivocado descuadra la caja.");
    // El ejemplo: el mismo pago, bien y mal registrado.
    expect(caja).toContain("Ordenex le paga **₡50.000 a Facebook**");
    expect(caja).toContain("La caja queda mostrando ₡50.000 que ya no están.");
    // Qué pide el pago por cuenta.
    expect(caja).toContain("**A quién se le pagó**");
    expect(caja).toContain("**En SINPE y transferencia la referencia es obligatoria.**");
    expect(caja).toContain("**Un comprobante**, si lo tenés. Es opcional.");
  });

  it.each(OFICINA)("%s: flujo registrado frente a dinero en caja, y por qué el flujo sale negativo", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("**Flujo de dinero registrado**");
    expect(caja).toContain("**Dinero en caja**");
    expect(caja).toContain("**Movimiento neto del periodo**");
    expect(caja).toContain("«Flujo de dinero registrado» no es el saldo del banco.");
    expect(caja).toContain("### Por qué el flujo puede salir negativo");
    expect(caja).toContain("dinero que Ordenex ya tenía **antes** de usar la app");
  });

  it.each(OFICINA)("%s: saldo inicial sin cifra propuesta, anulación con motivo, comprobante y hora de Costa Rica", (rol) => {
    const caja = cuerpoEnContexto(rol, "oficina/wallet-caja");
    expect(caja).toContain("**La app nunca propone una cifra.**");
    expect(caja).toContain("**Solo puede haber uno.**");
    expect(caja).toContain("**El motivo es obligatorio.**");
    expect(caja).toContain("**movimiento contrario**");
    expect(caja).toContain("Imagen JPEG, PNG o WebP, o un PDF, de hasta 4 MB.");
    expect(caja).toContain("## Las fechas, en hora de Costa Rica");
  });

  it.each(OFICINA)("%s: Wallet · Tiendas distingue los dos conceptos en el desglose", (rol) => {
    const tiendas = cuerpoEnContexto(rol, "oficina/wallet-tiendas");
    expect(tiendas).toContain("**Pago por cuenta de la tienda**");
    expect(tiendas).toContain("**Cobro de Ordenex**");
    expect(tiendas).toContain("**Un pago por cuenta no cuenta como un pago a la tienda**");
  });

  it.each(FUERA_DE_OFICINA)("%s NO recibe la ayuda de la caja (acotamiento por rol)", (rol) => {
    const todo = textoDelContexto(rol);
    expect(contextoPara(docs, rol).map((d) => d.slug)).not.toContain("oficina/wallet-caja");
    expect(todo).not.toContain("Pago por cuenta de una tienda, o cobrar un costo: no son lo mismo");
    expect(todo).not.toContain("**La app nunca propone una cifra.**");
  });
});

describe("459 — la tienda entiende un pago hecho por su cuenta en Mi wallet", () => {
  it("adminTienda: Mi wallet explica el pago por cuenta, su anulación y que no es un Cobro de Ordenex", () => {
    const wallet = cuerpoEnContexto("adminTienda", "tienda/mi-wallet");
    expect(wallet).toContain("## Un pago que Ordenex hizo por tu cuenta");
    expect(wallet).toContain("**a quién se le pagó, el motivo, el método**");
    expect(wallet).toContain("**Pago por cuenta anulado**");
    expect(wallet).toContain("Un **Cobro de Ordenex** es otra cosa");
    expect(wallet).toContain("**tu saldo queda en contra**");
  });
});

describe("454 — «pendiente de confirmación» y la ayuda como aviso, rol por rol", () => {
  it("mensajero: la gestión queda pendiente de confirmación hasta que se apruebe su cierre", () => {
    const reparto = cuerpoEnContexto("mensajero", "mensajero/reparto");
    expect(reparto).toContain("«pendiente de confirmación»");
    expect(reparto).toContain("**«Entregado · pendiente de confirmación»**");
    expect(reparto).toContain("sigue **En reparto** hasta que la oficina **apruebe tu cierre del día**");
    expect(reparto).toContain("**Pedir ayuda no cambia el estado de la orden.**");
    expect(reparto).toContain("**Recuperar**");

    const cierre = cuerpoEnContexto("mensajero", "mensajero/cierre-del-dia");
    expect(cierre).toContain("## Al aprobarse, se confirma el estado de cada orden");
    expect(cierre).toContain("**Devolver a gestión**");
    expect(cierre).toContain("**Solo mientras no hayas solicitado el cierre.**");
  });

  it("adminTienda: Órdenes explica la nota y Novedades dice que la ayuda no es un estado", () => {
    const ordenes = cuerpoEnContexto("adminTienda", "tienda/ordenes");
    expect(ordenes).toContain("## «Entregado · pendiente de confirmación»");
    expect(ordenes).toContain("**falta que se apruebe su cierre del día**");

    const novedades = cuerpoEnContexto("adminTienda", "tienda/novedades");
    expect(novedades).toContain("**La ayuda es un aviso, no un estado.**");
    expect(novedades).toContain("**Resolver la orden por tu cuenta**");
  });

  it.each(OFICINA)("%s: aprobar el cierre aplica el estado, y se puede corregir antes", (rol) => {
    const cierres = cuerpoEnContexto(rol, "oficina/cierres");
    expect(cierres).toContain("## Por qué las órdenes siguen «En reparto» hasta que aprobás");
    expect(cierres).toContain("**El estado real se aplica al aprobar el cierre**");
    expect(cierres).toContain("**Corregir el resultado**");
    expect(cierres).toContain("**no se puede traspasar a otro mensajero ni cambiarle el día de reparto**");
  });

  it("adminSatelite: la nota de pendiente y la de ayuda junto a «En reparto»", () => {
    const bodega = cuerpoEnContexto("adminSatelite", "satelite/en-bodega");
    expect(bodega).toContain("**«Entregado · pendiente de confirmación»**");
    expect(bodega).toContain("**La nota de ayuda**");
    // Y aprueba cierres: recibe el documento que explica que aprobar aplica el estado.
    expect(cuerpoEnContexto("adminSatelite", "oficina/cierres")).toContain(
      "**El estado real se aplica al aprobar el cierre**",
    );
  });
});

describe("456 — el botón de información y lo que significa cada estado llegan a TODOS", () => {
  it.each(PERSONAS)("%s: el contexto explica el botón (i) y qué significa «Novedad interna»", (rol) => {
    const rastreo = cuerpoEnContexto(rol, "publico/rastreo-de-paquete");
    expect(rastreo).toContain("## Qué significa cada estado");
    expect(rastreo).toContain("Cada estado lleva un botón **(i)** que explica qué significa");
    expect(rastreo).toContain(
      "| **Novedad interna** | El mensajero terminó el día con el paquete encima y sin registrar qué pasó con él.",
    );
    expect(rastreo).toContain("| **Devolución a origen por rechazo** | El destinatario rechazó el paquete.");
    expect(rastreo).toContain("**«Entregado · pendiente de confirmación».**");
  });

  it("la tabla de estados tiene una fila por cada estado vigente: uno nuevo sin explicar la pone roja", () => {
    // Sobre el cuerpo CRUDO (con sus saltos de línea): cada fila de la tabla es una línea.
    const crudo = contextoPara(docs, "mensajero").find((d) => d.slug === "publico/rastreo-de-paquete");
    const nombresEnTabla = (crudo?.cuerpo ?? "")
      .split("\n")
      .map((linea) => /^\| \*\*([^*]+)\*\* \| /.exec(linea)?.[1])
      .filter((nombre): nombre is string => nombre !== undefined);
    expect(nombresEnTabla).toHaveLength(20);
    expect([...nombresEnTabla].sort()).toEqual(Object.values(NOMBRE_ESTADO).sort());
  });
});
