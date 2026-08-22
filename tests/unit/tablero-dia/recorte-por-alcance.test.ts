import { describe, expect, it } from "vitest";

import {
  CAMPOS_SOLO_ALCANCE_GLOBAL,
  recortarPorAlcance,
  type OrdenDetalleDia,
} from "@/lib/types/tablero-dia";
import {
  CENTINELAS,
  TODOS_LOS_CENTINELAS,
  ordenDelDetalle,
} from "@/tests/fixtures/orden-detalle-dia";

// FEATURE 260 (T0.3) — R13, R17, R43, R46. LA MITAD **DATO** DEL RECORTE POR ALCANCE.
//
// Aqui se prueba la funcion pura. La otra mitad —que la pantalla no monte las columnas que
// leen estos campos— vive en `app/(app)/monitoreo` y la prueba la clausula (c) de
// `recorte-por-alcance.guardia.test.ts`. Hacen falta LAS DOS: sin esta, el dato viaja al
// navegador aunque no se pinte y se lee con un `View source`; sin la otra, `PriceLabel`
// convierte el hueco en `₡0`, que afirma algo falso.
//
// POR QUE CENTINELAS Y NO VALORES REALISTAS: un `1500` de flete podria aparecer por casualidad
// en otro campo del payload y dar un falso rojo —o peor, un falso verde si el detector fuera
// «no contiene 1500» y el campo se hubiera renombrado—. Un `9999991` solo puede venir de un
// sitio. Por que los de dinero son numeros y no cadenas: lo explica el propio fixture (tienen
// que sobrevivir a `PriceLabel` para que la mitad COLUMNA del recorte se pueda medir).

const ZONA = "zona" as const;
const GLOBAL = "global" as const;

/** El JSON del objeto entero: es lo que caza un campo ANIDADO que nadie listo. */
function serializado(orden: OrdenDetalleDia): string {
  return JSON.stringify(orden);
}

describe("recortarPorAlcance — alcance `zona` (R13)", () => {
  it("no deja NINGUNO de los cinco centinelas en el objeto serializado", () => {
    const recortada = recortarPorAlcance(ordenDelDetalle({ id: "o1" }), ZONA);

    for (const centinela of TODOS_LOS_CENTINELAS) {
      expect(
        serializado(recortada),
        `el centinela ${centinela} sobrevivio al recorte de alcance \`zona\``,
      ).not.toContain(centinela);
    }
  });

  it("borra las claves de los campos opcionales en vez de dejarlas en `undefined`", () => {
    const recortada = recortarPorAlcance(ordenDelDetalle({ id: "o1" }), ZONA);

    // `undefined` no viaja en JSON, pero SI viaja por la frontera de un Server Component, y
    // una clave presente es una clave que alguien puede leer. Se borran.
    expect(Object.keys(recortada)).not.toContain("fleteConIva");
    expect(Object.keys(recortada)).not.toContain("comisionConIva");
    const tienda = recortada.relaciones?.tienda;
    expect(tienda).not.toBeNull();
    expect(Object.keys(tienda ?? {})).not.toContain("email");
    expect(Object.keys(tienda ?? {})).not.toContain("telefono");
  });

  it("la tarifa se retira poniendola a `null`, el valor que ya tiene una tienda sin tarifa", () => {
    const recortada = recortarPorAlcance(ordenDelDetalle({ id: "o1" }), ZONA);
    expect(recortada.relaciones?.tienda?.tarifa).toBeNull();
  });

  it("retira EXACTAMENTE los campos declarados en la lista unica, y ni uno mas (R43)", () => {
    // La lista es la declaracion; esta asercion la hace LOAD-BEARING: añadir un nombre a
    // `CAMPOS_SOLO_ALCANCE_GLOBAL` sin implementar su retirada pone este test rojo.
    const original = ordenDelDetalle({ id: "o1" });
    const recortada = recortarPorAlcance(original, ZONA);

    for (const campo of CAMPOS_SOLO_ALCANCE_GLOBAL.orden) {
      expect(recortada[campo], `\`${campo}\` sigue en la orden`).toBeUndefined();
    }
    for (const campo of CAMPOS_SOLO_ALCANCE_GLOBAL.tienda) {
      const valor = recortada.relaciones?.tienda?.[campo];
      expect(valor ?? null, `\`tienda.${campo}\` sigue con valor`).toBeNull();
    }
  });

  it("R17 — el monto a cobrar SI se conserva: ese alcance ya lo ve en su propia pantalla", () => {
    const original = ordenDelDetalle({ id: "o1" });
    const recortada = recortarPorAlcance(original, ZONA);
    expect(recortada.montoCobrar).toBe(original.montoCobrar);
    expect(recortada.montoCobrar).not.toBeUndefined();
  });

  it("el RESTO del objeto queda intacto, campo a campo", () => {
    const original = ordenDelDetalle({ id: "o1", resultadoDelDia: "entregada" });
    const recortada = recortarPorAlcance(original, ZONA);

    // Todo lo que no es un campo restringido tiene que llegar igual. Se compara contra el
    // ORIGINAL —no contra una lista escrita al lado—, asi que un campo nuevo del listado entra
    // solo en esta comprobacion.
    const restringidosDeLaOrden = new Set<string>(CAMPOS_SOLO_ALCANCE_GLOBAL.orden);
    for (const [clave, valor] of Object.entries(original)) {
      if (restringidosDeLaOrden.has(clave) || clave === "relaciones") continue;
      expect(recortada[clave as keyof OrdenDetalleDia], `cambio \`${clave}\``).toEqual(valor);
    }
    // Y las relaciones que no son la tienda, tambien.
    expect(recortada.relaciones?.zona).toEqual(original.relaciones?.zona);
    expect(recortada.relaciones?.mensajeroAsignado).toEqual(original.relaciones?.mensajeroAsignado);
    expect(recortada.relaciones?.tienda?.nombre).toBe(original.relaciones?.tienda?.nombre);
  });

  it("no rompe con una orden sin relaciones ni con una sin tienda", () => {
    const sinRelaciones = ordenDelDetalle({ id: "o1", relaciones: undefined });
    expect(recortarPorAlcance(sinRelaciones, ZONA).fleteConIva).toBeUndefined();

    const sinTienda = ordenDelDetalle({ id: "o2" });
    const conTiendaNula: OrdenDetalleDia = {
      ...sinTienda,
      relaciones: { ...sinTienda.relaciones!, tienda: null },
    };
    expect(recortarPorAlcance(conTiendaNula, ZONA).relaciones?.tienda).toBeNull();
  });

  it("no MUTA la orden que recibe: el original conserva sus centinelas", () => {
    const original = ordenDelDetalle({ id: "o1" });
    recortarPorAlcance(original, ZONA);
    expect(original.fleteConIva).toBe(CENTINELAS.flete);
    expect(original.relaciones?.tienda?.email).toBe(CENTINELAS.email);
  });
});

describe("recortarPorAlcance — alcance `global` (R46)", () => {
  it("deja los CINCO centinelas: si no, la clausula de arriba seria verde por vacio", () => {
    const intacta = recortarPorAlcance(ordenDelDetalle({ id: "o1" }), GLOBAL);

    for (const centinela of TODOS_LOS_CENTINELAS) {
      expect(
        serializado(intacta),
        `el centinela ${centinela} NO llego al fixture: el test de \`zona\` no probaria nada`,
      ).toContain(centinela);
    }
  });

  it("no recorta absolutamente nada por debajo del techo de R18", () => {
    const original = ordenDelDetalle({ id: "o1" });
    expect(recortarPorAlcance(original, GLOBAL)).toEqual(original);
  });
});
