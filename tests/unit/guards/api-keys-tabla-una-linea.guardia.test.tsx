// @vitest-environment jsdom
// 2026-09-04 — GUARDIA de la tabla de `Configuración › API`. Sustituye a
// `api-keys-acciones-alcanzables.guardia.test.ts`, que afirmaba la regla CONTRARIA («las
// columnas con botones van DELANTE») y quedó falso al revertirse aquel reordenado. Un guard que
// codifica una regla derogada no es neutral: es un test verde defendiendo lo que ya no queremos.
//
// LO QUE DE VERDAD ESTABA ROTO ERA VERTICAL. La queja no era el scroll: era que las celdas
// PARTÍAN su contenido en varios renglones. Medido en Chromium sobre `/configuracion/api` con
// la barra lateral desplegada, ANTES del arreglo (líneas por celda, primera fila):
//
//   | viewport | visible | tabla | identificador | usuario dedicado | fecha | máx. líneas |
//   |----------|---------|-------|---------------|------------------|-------|-------------|
//   | 1024     |     718 |  1100 | 3             | 3                | 2     | 3           |
//   | 1280     |     974 |  1100 | 3             | 3                | 2     | 3           |
//   | 1440     |    1134 |  1134 | 3             | 3                | 2     | 3           |
//   | 1920     |    1614 |  1614 | 1             | 1                | 1     | 1           |
//
// La fila de 1440 es la que lo explica: la tabla NO desbordaba y aun así el texto se partía en
// tres. El plegado no venía del scroll — venía de que a `w-full` con layout automático el
// navegador estruja cada columna hasta su `min-content`, y el `min-content` de un texto que
// puede partirse es su palabra más larga. DESPUÉS del arreglo (una línea por celda + el email
// sintético acortado), con las mismas medidas:
//
//   | viewport | visible | tabla | desborda | máx. líneas por celda | «Eliminar» tras la flecha |
//   |----------|---------|-------|----------|-----------------------|---------------------------|
//   | 1024     |     718 |  1177 |    459 → | 1                     | dentro, y recibe el clic  |
//   | 1280     |     974 |  1177 |    203 → | 1                     | dentro                    |
//   | 1440     |    1134 |  1177 |     43 → | 1                     | dentro                    |
//   | 1920     |    1614 |  1614 |        0 | 1                     | visible sin desplazar     |
//
// A 1440 SE QUEDÓ A 43 px, Y NO ES POR FALTA DE APRETAR. Acortar el email llevó su columna de
// 394 a 133 px, que es su SUELO: el texto de la cabecera «Usuario dedicado» mide 109 px y la
// celda tiene 24 de relleno, así que por mucho que se recorte el dato la columna no baja de ahí.
// Los 261 px que aportó son todo lo que esta columna tenía. El resto ya no se puede sacar sin
// tocar datos que sí importan, y eso NO se hizo a propósito.
//
// El desbordamiento que queda NO es un defecto: `DataTable` ya trae el control para eso (las
// flechas que solo aparecen cuando la tabla desborda). Se pulsó de verdad en los tres anchos y
// llevó el scroll hasta el final; a 1024 el «Eliminar» habilitado quedó dentro del área visible,
// recibió el clic y abrió su modal de confirmación.
//
// QUÉ AFIRMA ESTE ARCHIVO, Y QUÉ NO. jsdom no tiene layout: aquí NO se miden píxeles ni líneas
// —esa medición es la de arriba, hecha en el navegador—. Lo que se vigila es lo que sí es
// verificable sin layout y es justo lo que se rompe por descuido:
//   1. el ORDEN de las columnas, con «Acciones» LA ÚLTIMA y «Webhook» justo antes;
//   2. el orden de los botones DENTRO de la fila, con «Eliminar» el último de todos;
//   3. que cada celda DECLARE una línea (el `whitespace-nowrap` que produce ese
//      `white-space: nowrap`), en TODAS las columnas y no solo en las que hoy se plegaban;
//   4. que la ÚNICA columna que acorta su dato siga dejándolo alcanzable (`title` + `sr-only`),
//      y que ninguna otra se contagie de la excepción.
// Las listas van escritas a mano, no derivadas de `buildApiKeysColumns`: compararlas contra su
// propia fuente estaría siempre verde (lección «aserción contra su propia fuente»).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

// El borde: sin esto, importar las columnas arrastra las Server Actions al test. Las celdas se
// RENDERIZAN (para leer el DOM), pero ninguna acción llega a invocarse.
vi.mock("@/lib/actions/api-keys", () => ({
  rotarApiKey: vi.fn(),
  activarApiKey: vi.fn(),
  desactivarApiKey: vi.fn(),
  eliminarApiKey: vi.fn(),
}));
vi.mock("@/lib/actions/webhooks", () => ({
  obtenerWebhook: vi.fn(),
  registrarWebhook: vi.fn(),
  desactivarWebhook: vi.fn(),
  rotarSecretoWebhook: vi.fn(),
}));

import { buildApiKeysColumns } from "@/app/(app)/configuracion/api/_components/api-keys-columns";

/**
 * El ORDEN HISTÓRICO, restaurado: identidad de la fila → sus datos → lo que se HACE con ella.
 * «Acciones» cierra la tabla y «Webhook» va justo antes, que es lo que deja «Eliminar» como
 * última acción de la fila (su «Editar» queda delante del trío).
 */
const ORDEN_ESPERADO = [
  "identificador",
  "keyPrefix",
  "usuarioEmail",
  "tiendaDestino",
  "createdAt",
  "estado",
  "webhook",
  "acciones",
] as const;

/** Cabeceras visibles, en el mismo orden. Escritas a mano por el mismo motivo. */
const CABECERAS_ESPERADAS = [
  "Identificador",
  "Prefijo",
  "Usuario dedicado",
  "Tienda destino",
  "Fecha de creación",
  "Estado",
  "Webhook",
  "Acciones",
];

/**
 * La clase de Tailwind que produce `white-space: nowrap`. Es el mecanismo que YA usa el repo
 * para esto (`ProductosTabla` de analítica, ficha 354) y por eso se reusa en vez de inventar
 * otro. Va como literal a propósito: si alguien la cambia por `truncate`, `line-clamp` o
 * `wrap-anywhere`, este archivo se pone rojo y obliga a volver a medir en el navegador.
 */
const CLASE_UNA_LINEA = "whitespace-nowrap";

/**
 * Fila de prueba con los valores QUE SE PLEGABAN en producción local, no con valores cómodos:
 * un identificador con espacios y dos puntos, y su email sintético lleno de guiones (el
 * navegador partía por cada uno de ellos).
 */
const FILA: ApiKeyListItemDTO = {
  id: "0f1f1d3a-0000-4000-8000-000000000001",
  identificador: "Prueba Tienda 18:06:29",
  keyPrefix: "ordx_CU5aFdJ",
  estado: "activa",
  usuarioId: "u-1",
  usuarioEmail: "apikey+prueba-tienda-18-06-29@apikey.invalid",
  tiendaDestinoId: null,
  tiendaDestinoNombre: "Tania",
  eliminable: false,
  motivoNoEliminable: "activa",
  createdAt: new Date("2026-09-04T18:06:29Z"),
};

function columnas() {
  return buildApiKeysColumns({ onMutated: async () => {}, onEliminada: () => {} });
}

/** Renderiza la celda de una columna y devuelve su contenedor. */
function pintarCelda(id: string): HTMLElement {
  const columna = columnas().find((c) => c.id === id);
  expect(columna, `la columna «${id}» ya no existe en el listado`).toBeDefined();
  expect(
    typeof columna!.render,
    `la columna «${id}» dejó de declarar un render propio: sin él la celda vuelve a plegarse`,
  ).toBe("function");
  const { container } = render(
    <ToastProvider>
      {(columna!.render as (row: ApiKeyListItemDTO) => ReactNode)(FILA)}
    </ToastProvider>,
  );
  return container;
}

/**
 * Elementos que contienen TEXTO propio (no solo hijos). Son las cajas que el navegador puede
 * plegar, y por tanto las que tienen que quedar amparadas por `whitespace-nowrap`.
 */
function cajasConTexto(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>("*")).filter((el) =>
    Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    ),
  );
}

afterEach(() => {
  cleanup();
});

describe("API keys · la tabla no parte sus celdas y «Eliminar» cierra la fila", () => {
  it("«Acciones» es la ÚLTIMA columna y «Webhook» la penúltima", () => {
    const ids = columnas().map((c) => c.id);
    expect(ids).toEqual([...ORDEN_ESPERADO]);
    expect(ids[ids.length - 1]).toBe("acciones");
    expect(ids[ids.length - 2]).toBe("webhook");
  });

  it("las cabeceras salen en ese mismo orden y ninguna columna se perdió por el camino", () => {
    const cols = columnas();
    expect(cols.map((c) => c.value)).toEqual(CABECERAS_ESPERADAS);
    // El arreglo NO borra columnas: si alguien "arregla" el ancho quitando una, esto muerde.
    expect(cols).toHaveLength(8);
    expect(new Set(cols.map((c) => c.id)).size).toBe(8); // ids únicos: son la key de React
  });

  it("cada celda declara UNA línea: toda caja con texto queda bajo `whitespace-nowrap`", () => {
    for (const id of ORDEN_ESPERADO) {
      const celda = pintarCelda(id);
      const cajas = cajasConTexto(celda);
      expect(cajas.length, `la celda «${id}» no pintó texto alguno`).toBeGreaterThan(0);
      for (const caja of cajas) {
        expect(
          caja.closest(`.${CLASE_UNA_LINEA}`),
          `la celda «${id}» puede plegar «${caja.textContent?.trim()}» en varios renglones: ` +
            `falta ${CLASE_UNA_LINEA} en ella o en algún ancestro suyo`,
        ).not.toBeNull();
      }
      cleanup();
    }
  });

  it("«Usuario dedicado» acorta lo VISIBLE pero no pierde el valor: `title` + `sr-only`", () => {
    // Es la ÚNICA columna que esconde parte de su dato (aprobado 2026-09-04: es un email
    // sintético sobre un dominio `.invalid`, derivado del identificador que ya está entero en
    // la primera columna). El permiso vale SOLO si el valor completo sigue alcanzable, así que
    // eso es lo que se vigila aquí: quitar el `title` o el `sr-only` deja el dato inaccesible
    // y pone rojo este test.
    const celda = pintarCelda("usuarioEmail");

    // 1) Lo VISIBLE va acortado y marcado como tal con el elipsis (patrón de «Prefijo»).
    const visible = celda.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(visible, "no hay parte visible marcada `aria-hidden` en la celda").not.toBeNull();
    const textoVisible = visible!.textContent ?? "";
    expect(textoVisible.endsWith("…"), `«${textoVisible}» no avisa con elipsis`).toBe(true);
    expect(textoVisible).not.toContain(FILA.usuarioEmail);
    // Se acorta de verdad: 12 caracteres + el elipsis, como el `keyPrefix` de al lado. El
    // esperado va como LITERAL, no derivado de la constante del componente: si alguien sube o
    // baja ese presupuesto, esto se pone rojo y obliga a volver a medir la columna.
    expect(textoVisible).toBe("apikey+prueb…");

    // 2) El valor COMPLETO, en el tooltip.
    const conTitle = celda.querySelector<HTMLElement>("[title]");
    expect(conTitle?.getAttribute("title"), "el `title` ya no lleva el email entero").toBe(
      FILA.usuarioEmail,
    );

    // 3) Y para quien no tiene ratón: un `title` en un `<span>` no lo anuncia un lector de
    //    pantalla, así que el email entero tiene que estar además en texto `sr-only`.
    const soloLectores = Array.from(celda.querySelectorAll<HTMLElement>(".sr-only")).map((el) =>
      el.textContent?.trim(),
    );
    expect(
      soloLectores,
      "sin `sr-only` el email completo solo existiría al posar el ratón encima",
    ).toContain(FILA.usuarioEmail);
  });

  it("ninguna OTRA columna esconde su dato: la excepción es una, no una costumbre", () => {
    for (const id of ORDEN_ESPERADO) {
      if (id === "usuarioEmail") continue;
      const celda = pintarCelda(id);
      expect(
        celda.querySelector('[aria-hidden="true"]'),
        `la celda «${id}» empezó a esconder parte de su contenido: eso hay que medirlo y ` +
          `justificarlo, no heredarlo del vecino`,
      ).toBeNull();
      cleanup();
    }
  });

  it("dentro de la fila, el orden de las acciones deja «Eliminar» la ÚLTIMA", () => {
    // El «Editar» del webhook va en la columna de ANTES, así que en el DOM precede al trío.
    const webhook = pintarCelda("webhook");
    expect(
      within(webhook).getByRole("button").textContent?.trim(),
      "la columna «Webhook» dejó de ofrecer su acción",
    ).toBe("Editar");
    cleanup();

    const acciones = pintarCelda("acciones");
    const etiquetas = within(acciones)
      .getAllByRole("button")
      .map((b) => b.textContent?.trim());
    // `FILA` está activa ⇒ el botón del medio ofrece «Desactivar».
    expect(etiquetas).toEqual(["Rotar", "Desactivar", "Eliminar"]);
    expect(etiquetas[etiquetas.length - 1]).toBe("Eliminar");
  });
});
