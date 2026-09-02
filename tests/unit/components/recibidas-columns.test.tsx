// @vitest-environment jsdom
//
// FICHA 349 — LAS COLUMNAS DE «Órdenes de la bodega» SALEN DE LAS DE `/ordenes`.
//
// ─── QUÉ VIGILA ESTE ARCHIVO, Y POR QUÉ ES EL QUE DA VALOR A LA FICHA ───────────────────────
//
// El humano pidió tres cosas sobre esta tabla: que muestre la info completa, que el estado se
// pinte en BADGE «como la tabla de órdenes de la bodega central», y que «básicamente sea el
// mismo componente». Las tres se cumplen con UNA decisión —montar `ordenesColumns` y quitar por
// id— y las tres se pierden a la vez si alguien vuelve a escribir las columnas a mano. Eso es
// lo que este archivo tiene que poner rojo, y es la mutación obligatoria de la ficha.
//
// ─── LA REGLA QUE GOBIERNA EL ARCHIVO ──────────────────────────────────────────────────────
//
// El conjunto esperado se CALCULA desde `ordenesColumns`; no se escribe una lista literal de
// ids. Una lista literal sería la aserción-contra-su-propia-fuente que este repo ya pagó:
// pasaría a ser un peaje que hay que actualizar cada vez que `/ordenes` cambie, y el día que
// alguien la actualizara «para que pase» dejaría de comprobar nada.
//
// Las dos únicas listas literales son (a) los cinco `value` de estatus del listado, que son el
// contrato de la pantalla (`ESTADOS_BODEGA_SATELITE`, y se importan, no se copian), y (b) los
// tres encabezados que la ficha AÑADE, que son la petición del humano escrita como texto.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ordenesColumns } from "@/app/(app)/ordenes/_components/ordenes-columns";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import {
  COLUMNAS_SIN_DATO_EN_ALCANCE_ZONA,
  recibidasColumns,
} from "@/app/(app)/recepcion-satelite/_components/recibidas-columns";
import { COLUMNAS_SOLO_ALCANCE_GLOBAL } from "@/app/(app)/monitoreo/_components/detalle-columnas";
import { DataTable } from "@/components/shared/DataTable";
import { formatMonto } from "@/lib/config/moneda";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { recortarPorAlcance } from "@/lib/types/recorte-alcance-orden";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import { ordenDeListado } from "@/tests/fixtures/orden-detalle-dia";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

afterEach(() => {
  cleanup();
});

/** El marcador de «relación opcional que no resolvió» del repo. No es un cero. */
const SIN_DATO = "—";

const RAIZ = process.cwd();
const FUENTE_COLUMNAS = path.join(
  RAIZ,
  "app/(app)/recepcion-satelite/_components/recibidas-columns.tsx",
);
const FUENTE_LISTADO = path.join(
  RAIZ,
  "app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx",
);

/**
 * Una fila de la bodega tal como llega HOY al navegador: la del listado de órdenes —con sus
 * centinelas de dinero puestos— más los nueve campos propios, y ya pasada por el recorte de
 * alcance `zona` que aplica la capa de datos. Se recorta AQUÍ y no se escribe un objeto sin
 * dinero a mano: así el fixture no puede afirmar la ausencia por construcción.
 */
function filaDeLaBodega(
  overrides: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  const base = ordenDeListado({
    id: overrides.id,
    estatusValue: "en_bodega_satelite",
    zonaNombre: "Quepos",
  });
  const fila: RecepcionSateliteDTO = {
    ...base,
    // Los cuatro que la fila de la bodega declara OBLIGATORIOS y el listado tiene opcionales:
    // el `??` no es un valor por defecto inventado, es lo que hace representable esa diferencia.
    estatusValue: base.estatusValue ?? "en_bodega_satelite",
    direccion: base.direccion ?? null,
    montoCobrar: base.montoCobrar ?? null,
    zonaNombre: base.zonaNombre ?? "Quepos",
    provinciaNombre: "Provincia Uno",
    cantonNombre: "Canton Uno",
    distritoNombre: "Distrito Uno",
    prioridad: false,
    fechaRepartoISO: null,
    relaciones: {
      ...base.relaciones!,
      estatus: { id: "est-sat", value: "en_bodega_satelite" },
      zona: { id: "zona-1", nombre: "Quepos", esCentral: false },
    },
    ...overrides,
  };
  // El recorte del servidor, aplicado tal cual: es la fila que la pantalla recibe de verdad.
  return recortarPorAlcance(fila, "zona");
}

/** Pinta la tabla con las columnas de la bodega y devuelve cabeceras y celdas. */
function pintar(fila: RecepcionSateliteDTO = filaDeLaBodega({ id: "o1" })) {
  render(
    <DataTable
      columns={recibidasColumns()}
      data={[fila]}
      rowKey="id"
      ariaLabel="Órdenes de la bodega"
    />,
  );
  const tabla = screen.getByRole("table");
  const cabeceras = within(tabla)
    .getAllByRole("columnheader")
    .map((th) => th.textContent?.trim() ?? "");
  const celdas = [...tabla.querySelectorAll("tbody td")];
  return {
    tabla,
    cabeceras,
    celdas: celdas.map((td) => td.textContent?.trim() ?? ""),
    /** La celda (elemento, no texto) bajo un encabezado dado. */
    celdaDe(encabezado: string): HTMLElement {
      const i = cabeceras.indexOf(encabezado);
      expect(i, `no hay ninguna columna «${encabezado}»`).toBeGreaterThanOrEqual(0);
      return celdas[i] as HTMLElement;
    },
  };
}

/** Fuente de un archivo del árbol, sin comentarios (los comentarios NOMBRAN lo prohibido). */
function fuenteSinComentarios(archivo: string): string {
  return quitarComentarios(readFileSync(archivo, "utf8"));
}

/* -------------------------------------------------------------------------- */
/* LA UNIFICACIÓN — las columnas SON las de `/ordenes`, no una copia            */
/* -------------------------------------------------------------------------- */

describe("recibidasColumns — deriva del listado de órdenes, no lo espeja", () => {
  it("el censo NO es vacío: el módulo del listado trae de verdad sus columnas", () => {
    // Sin esto, todas las comparaciones de abajo podrían ser verdes por vacío.
    expect(ordenesColumns.length).toBeGreaterThan(15);
    expect(new Set(ordenesColumns.map((c) => c.id)).size).toBe(ordenesColumns.length);
  });

  it("cada columna montada es EL MISMO OBJETO que declaró `ordenesColumns`", () => {
    // ÉSTA es la aserción de la ficha. No compara ids ni encabezados —que se podrían
    // reproducir a mano y seguir en verde—: compara IDENTIDAD. Volver a escribir las columnas
    // aquí produciría objetos nuevos, iguales de lejos, y este caso se pondría rojo.
    for (const columna of recibidasColumns()) {
      expect(
        ordenesColumns,
        `la columna \`${columna.id}\` NO sale de \`ordenesColumns\`: se declaró aparte`,
      ).toContain(columna);
    }
  });

  it("los ids montados son EXACTAMENTE los de `/ordenes` menos la exclusión, y en su orden", () => {
    const esperados = ordenesColumns
      .map((c) => c.id)
      .filter((id) => !COLUMNAS_SIN_DATO_EN_ALCANCE_ZONA.includes(id));
    expect(recibidasColumns().map((c) => c.id)).toEqual(esperados);
  });

  it("no monta ninguna columna dos veces", () => {
    const ids = recibidasColumns().map((c) => c.id);
    expect(new Set(ids).size, `hay ids repetidos en ${ids.join(", ")}`).toBe(ids.length);
  });

  it("el módulo NO declara ni una definición de columna propia", () => {
    // Un `value:` es el encabezado de una columna. Cero, porque las dieciséis se leen de
    // `ordenesColumns`. Es la otra mitad de la aserción de identidad: aquélla caza que se
    // reemplacen las columnas montadas, ésta caza que se AÑADA una escrita a mano.
    const fuente = fuenteSinComentarios(FUENTE_COLUMNAS);
    expect([...fuente.matchAll(/\bvalue\s*:/g)]).toHaveLength(0);
    // Y que de verdad importa el módulo del listado: sin esto, un archivo que devolviera `[]`
    // pasaría los dos casos de arriba.
    expect(fuente).toContain("ordenesColumns");
  });

  it("el módulo padre sigue declarando SUS dos columnas y ninguna más", () => {
    // `SateliteOrdenesListado` antepone el checkbox de selección y añade «Incidente». Son
    // suyas —la selección y la regla de disponibilidad del incidente no salen de la fila— y
    // por eso no viven en el módulo de columnas. Dos, exactamente: una tercera aquí sería la
    // lista paralela volviendo por la puerta de al lado.
    const fuente = fuenteSinComentarios(FUENTE_LISTADO);
    expect([...fuente.matchAll(/\bvalue\s*:/g)]).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* LA EXCLUSIÓN — por id, existente, y JUSTIFICADA sobre la fila real          */
/* -------------------------------------------------------------------------- */

describe("recibidasColumns — lo que se quita, y por qué", () => {
  it("cada id de la exclusión existe de verdad entre las columnas del listado", () => {
    // Sin esto, un rename en `/ordenes` dejaría el filtro sin quitar nada EN SILENCIO: la
    // columna volvería a pintar el `₡0,00` de un dato que el servidor ya retiró.
    const delListado = new Set(ordenesColumns.map((c) => c.id));
    for (const id of COLUMNAS_SIN_DATO_EN_ALCANCE_ZONA) {
      expect(delListado.has(id), `\`${id}\` ya no es una columna del listado de órdenes`).toBe(
        true,
      );
    }
    expect(COLUMNAS_SIN_DATO_EN_ALCANCE_ZONA.length).toBe(3);
  });

  it("es la MISMA exclusión que `/monitoreo` declara para el mismo alcance", () => {
    // Las dos pantallas de alcance `zona` recortan lo mismo porque el servidor les retira lo
    // mismo. Están declaradas por separado (el bundle de cliente de la satélite no puede
    // importar el módulo de monitoreo), así que lo que impide que diverjan es este caso.
    expect([...COLUMNAS_SIN_DATO_EN_ALCANCE_ZONA].sort()).toEqual(
      [...COLUMNAS_SOLO_ALCANCE_GLOBAL].sort(),
    );
  });

  it("las tres excluidas MENTIRÍAN sobre la fila real: pintan ₡0,00 tras el recorte", () => {
    // La justificación, medida en vez de razonada. Se pinta la fila de la bodega —la de
    // verdad, ya recortada— con las columnas de `/ordenes` SIN filtrar, y se comprueba que las
    // tres de dinero dicen «cero» sobre una orden que sí cobra. Ése es el `₡0` que se lee como
    // «esta orden no paga flete» (260/R15), y por eso se retiran como COLUMNA.
    const fila = filaDeLaBodega({ id: "o-dinero" });
    render(
      <DataTable
        columns={ordenesColumns}
        data={[fila]}
        rowKey="id"
        ariaLabel="Órdenes de la bodega (sin recortar)"
      />,
    );
    const tabla = screen.getByRole("table");
    const cabeceras = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim() ?? "");
    const celdas = [...tabla.querySelectorAll("tbody td")];
    const cero = formatMonto(0);
    for (const id of COLUMNAS_SIN_DATO_EN_ALCANCE_ZONA) {
      const encabezado = ordenesColumns.find((c) => c.id === id)?.value ?? "";
      const celda = celdas[cabeceras.indexOf(encabezado)];
      expect(
        celda?.textContent?.trim(),
        `la columna «${encabezado}» no pinta el cero: la exclusión ya no está justificada`,
      ).toBe(cero);
    }
    // Contraprueba: `montoCobrar` NO se retira (260/R17) y sigue trayendo su importe.
    const monto = celdas[cabeceras.indexOf("Monto a cobrar")];
    expect(monto?.textContent?.trim()).not.toBe(cero);
  });

  it("ninguna cabecera de dinero restringido llega a la tabla de la bodega", () => {
    const { cabeceras } = pintar();
    for (const id of COLUMNAS_SIN_DATO_EN_ALCANCE_ZONA) {
      const encabezado = ordenesColumns.find((c) => c.id === id)?.value ?? "";
      expect(cabeceras).not.toContain(encabezado);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* EL ESTADO EN BADGE — la petición literal del humano                         */
/* -------------------------------------------------------------------------- */

describe("recibidasColumns — el estado se pinta como badge, igual que en `/ordenes`", () => {
  it.each(ESTADOS_BODEGA_SATELITE)("`%s` sale dentro de un chip con su etiqueta", (estado) => {
    const { celdaDe } = pintar(
      filaDeLaBodega({
        id: `o-${estado}`,
        estatusValue: estado,
        relaciones: undefined,
      }),
    );
    const celda = celdaDe("Estado");
    const chip = celda.querySelector('[data-slot="badge"]');
    expect(chip, `el estado \`${estado}\` se pintó como texto plano, no como badge`).not.toBeNull();
    expect(chip?.textContent?.trim()).toBe(ORDER_STATUS_LABELS[estado]);
  });

  it("el chip sale de la MISMA columna que `/ordenes`, no de una copia", () => {
    // Cierra el hueco del caso de arriba: un badge escrito a mano aquí también sería un chip.
    const columnaEstado = recibidasColumns().find((c) => c.id === "estatus");
    expect(columnaEstado).toBe(ordenesColumns.find((c) => c.id === "estatus"));
  });

  it("el chip ya NO repite la zona, y la zona sigue en su columna", () => {
    // Se retira el sufijo « de <zona>» que esta pantalla componía (33/R9), por la razón que ya
    // escribió el archivo descargable de esta misma pantalla (170/R8): la zona viaja en su
    // propia columna y repetirla en el estado convierte un dato en dos. Lo que este caso
    // protege es que NO SE PIERDA el dato, que es lo único que importaba de aquel sufijo.
    const { celdaDe } = pintar(filaDeLaBodega({ id: "o-zona" }));
    expect(celdaDe("Estado").textContent?.trim()).toBe(
      ORDER_STATUS_LABELS.en_bodega_satelite,
    );
    expect(celdaDe("Zona").textContent?.trim()).toBe("Quepos");
  });
});

/* -------------------------------------------------------------------------- */
/* LA INFO COMPLETA — las tres columnas que la bodega no tenía                 */
/* -------------------------------------------------------------------------- */

describe("recibidasColumns — la tabla enseña lo que la fila trae desde la 349", () => {
  // Literal a propósito: ÉSTA es la petición del humano («no está mostrando la info
  // completa»), escrita como los tres encabezados que antes faltaban. Derivarla de
  // `ordenesColumns` la haría circular y siempre verde.
  it.each(["Mensajero", "Fecha de creación", "Tiempo"])(
    "monta la columna «%s», que la bodega no tenía",
    (encabezado) => {
      expect(pintar().cabeceras).toContain(encabezado);
    },
  );

  it("«Mensajero» pinta el NOMBRE resuelto, nunca el id", () => {
    const { celdaDe } = pintar(
      filaDeLaBodega({
        id: "o-men",
        mensajeroAsignadoId: "uuid-que-no-se-ve",
      }),
    );
    expect(celdaDe("Mensajero").textContent?.trim()).toBe("Ana");
  });

  it("sin mensajero asignado, la celda dice «—» y no un hueco", () => {
    const fila = filaDeLaBodega({ id: "o-sin-men" });
    const { celdaDe } = pintar({
      ...fila,
      relaciones: { ...fila.relaciones!, mensajeroAsignado: null },
    });
    expect(celdaDe("Mensajero").textContent?.trim()).toBe(SIN_DATO);
  });

  it("«Fecha de creación» y «Tiempo» salen de `createdAt` y dicen algo", () => {
    const { celdaDe } = pintar(
      filaDeLaBodega({ id: "o-fecha", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
    );
    // No se afirma el texto exacto de la fecha: lo compone `Intl` con la zona horaria de la
    // máquina, y fijarlo aquí sería afirmar el reloj del que corre el test. Se afirma lo que
    // la ficha promete: que la celda trae un dato y no el marcador de ausencia.
    expect(celdaDe("Fecha de creación").textContent?.trim()).not.toBe(SIN_DATO);
    expect(celdaDe("Fecha de creación").textContent?.trim()).not.toBe("");
    // «Tiempo» es el transcurrido desde la creación: `Xd Yh` para una fecha de hace meses.
    expect(celdaDe("Tiempo").textContent?.trim()).toMatch(/^\d+d \d+h$/);
  });
});

/* -------------------------------------------------------------------------- */
/* «Liberada el» se queda fuera, como en `/monitoreo`                          */
/* -------------------------------------------------------------------------- */

describe("recibidasColumns — «Liberada el» no entra", () => {
  it("no monta la columna de la variante `reprogramada`", () => {
    // Este listado mezcla cinco estados y `reprogramada` no es ninguno de ellos, así que la
    // columna hablaría de algo que aquí no se lista. Mismo criterio que `/monitoreo` (260/R45).
    expect(recibidasColumns().map((c) => c.id)).not.toContain("liberada");
  });

  it("`reprogramada` de verdad NO está entre los estados del listado", () => {
    // La cláusula de arriba no puede ser verde por vacío: si algún día `reprogramada` entrara
    // en la bodega, este caso se pone rojo y obliga a rehacer la decisión.
    expect([...ESTADOS_BODEGA_SATELITE]).not.toContain("reprogramada");
  });

  it("la cláusula NO es vacía: la variante del listado SÍ la trae", async () => {
    const { ordenesColumnsReprogramada } = await import(
      "@/app/(app)/ordenes/_components/ordenes-columns"
    );
    const propias = ordenesColumnsReprogramada
      .map((c) => c.id)
      .filter((id) => !ordenesColumns.some((c) => c.id === id));
    expect(propias, "la variante `reprogramada` ya no añade ninguna columna").toEqual(["liberada"]);
  });
});
