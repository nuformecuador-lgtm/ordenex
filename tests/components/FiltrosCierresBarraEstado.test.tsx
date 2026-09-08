// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FiltrosCierresBarra } from "@/app/(app)/cierres-admin/_components/FiltrosCierresBarra";
import {
  filtrosCierresSchema,
  type CatalogoFiltrosCierresDTO,
  type FiltrosCierres,
} from "@/lib/types/filtros-cierres";

/**
 * FICHA 386 (2026-09-08) — EL CONTROL DE ESTADO DE LA BARRA DE CIERRES, POR EL LADO DE LA
 * PANTALLA.
 *
 * La mitad de servidor ya está mergeada (PR #744) y su borde está cubierto por
 * `tests/unit/guards/filtros-cierres-alcance.guardia.test.ts`; el `WHERE` por
 * `tests/unit/repositories/cierres-filtros-where.test.ts` y por un test de integración contra
 * Postgres real. Nada de eso se repite aquí.
 *
 * Aquí se afirma lo que SOLO se ve montando el control, y son cinco cosas que se rompen calladas:
 *
 *  1. **lo que se emite es lo que el borde acepta** — no se compara contra un literal escrito a
 *     mano en el esperado, se PASA POR `filtrosCierresSchema`, que es el mismo objeto zod que
 *     valida la Server Action. Así, «la pantalla emite algo que el servidor rechaza» se ve aquí y
 *     no en producción con un `validation_error` mudo;
 *  2. **desmarcarlo todo OMITE la clave**, no manda `[]`. `[]` sería «los cierres de cero
 *     estados» —siempre nada— y el borde lo rechaza; el usuario que desmarca la última casilla
 *     espera volver a verlo todo, no un listado vacío;
 *  3. **el control pinta la ETIQUETA, nunca el valor crudo del enum**. Hay precedente malo y
 *     reciente en este repo (un select de Rol que pinta `adminSatelite` a pelo);
 *  4. **los cuatro estados van AGRUPADOS por la lista en la que aparecen.** Ésta es la mitad
 *     visible de la decisión que documenta la cabecera de `FiltrosCierresBarra`: se ofrecen los
 *     cuatro en las dos pestañas —el filtro interseca con cada lista y por eso pedir uno de la
 *     otra da vacío—, y lo que impide que eso se lea como un error es que el desplegable diga a
 *     qué lista pertenece cada estado ANTES de elegirlo;
 *  5. **la barra NO ofrece el estado por defecto.** Esta misma barra la montan las dos pantallas
 *     de BODEGA, cuyo bloque de filtros (`filtrosCierresBodegaSchema`) no declara `estados` y es
 *     `.strict()`: ofrecérselo sería ofrecer un control que su servidor rechaza en cuanto alguien
 *     lo toque.
 *
 * ⚠️ LAS ETIQUETAS SE ESCRIBEN A MANO EN LOS ESPERADOS, a propósito. Compararlas contra
 * `ESTADO_LABEL` —la constante que las GENERA— dejaría estos casos verdes para siempre, incluida
 * la mutación «pinta el enum crudo». El precio es que renombrar un estado pone rojo este archivo;
 * eso es exactamente lo que se quiere, porque es un texto que el usuario lee.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
}));

const BARRA = "Filtros de los cierres del día";
const ZONA_A = "11111111-1111-4111-8111-111111111111";
const MENSAJERO_DIANA = "33333333-3333-4333-8333-333333333333";

const CATALOGO: CatalogoFiltrosCierresDTO = {
  zonas: [{ id: ZONA_A, nombre: "Bodega Heredia" }],
  mensajeros: [{ id: MENSAJERO_DIANA, nombre: "Diana Mora", zonaId: ZONA_A }],
  mensajerosFiltro: [{ id: MENSAJERO_DIANA, nombre: "Diana Mora", zonaId: ZONA_A }],
};

function montar(props: { conEstado?: boolean; sinMensajero?: boolean } = {}) {
  const onChange = vi.fn<(f: FiltrosCierres) => void>();
  render(
    <FiltrosCierresBarra catalogo={CATALOGO} onChange={onChange} {...props} />,
  );
  return onChange;
}

/** El último objeto que la barra emitió. */
function ultimoEmitido(onChange: ReturnType<typeof montar>): FiltrosCierres {
  const llamadas = onChange.mock.calls;
  expect(llamadas.length, "la barra no emitió nada").toBeGreaterThan(0);
  return llamadas[llamadas.length - 1][0];
}

/**
 * PIDE un filtro en el selector de la barra. Los filtros no están puestos de entrada: se piden
 * uno a uno, como en `/ordenes`. Sin este paso el control no existe. El selector se queda ABIERTO
 * tras marcar una opción, así que solo se abre si hace falta.
 */
async function pedirFiltro(user: ReturnType<typeof userEvent.setup>, label: string) {
  if (screen.queryByRole("listbox", { name: "Filtros" }) === null) {
    const barra = screen.getByRole("region", { name: BARRA });
    await user.click(within(barra).getByRole("button", { name: /^Filtros/ }));
  }
  await user.click(
    within(await screen.findByRole("listbox", { name: "Filtros" })).getByRole("option", {
      name: label,
    }),
  );
}

/** Pide el filtro de estado, lo abre y devuelve su lista de opciones. */
async function abrirEstado(user: ReturnType<typeof userEvent.setup>) {
  await pedirFiltro(user, "Estado");
  const barra = screen.getByRole("region", { name: BARRA });
  await user.click(within(barra).getByRole("button", { name: /^Estado:/ }));
  return screen.findByRole("listbox", { name: "Estado" });
}

/** Texto visible de cada opción de una lista, en su orden de pantalla. */
function etiquetas(lista: HTMLElement): string[] {
  return within(lista)
    .getAllByRole("option")
    .map((o) => (o.textContent ?? "").trim());
}

afterEach(() => {
  cleanup();
});

describe("Ficha 386 · el control de ESTADO de la barra de cierres", () => {
  it("ofrece los CUATRO estados con su nombre legible, nunca el valor crudo del enum", async () => {
    const user = userEvent.setup();
    montar({ conEstado: true });

    const lista = await abrirEstado(user);

    // El orden es el de la decisión: primero los de la cola, después los del histórico. «Todos»
    // encabeza la lista porque es el atajo que `MultiSelectFilter` monta en todos sus filtros.
    expect(etiquetas(lista)).toEqual([
      "Todos",
      "Solicitado",
      "Vencido",
      "Aprobado",
      "Rechazado",
    ]);

    // ⚠️ ÉSTA es la línea que se pone roja si alguien pinta el `value` en vez de la etiqueta. Los
    // cuatro valores del enum van en minúscula y las cuatro etiquetas capitalizadas, así que una
    // búsqueda sensible a mayúsculas los distingue sin ambigüedad.
    expect(lista.textContent ?? "").not.toMatch(
      /solicitado|vencido|aprobado|rechazado/,
    );
  });

  it("los agrupa por la lista en la que aparecen, que es lo que explica el vacío antes de elegir", async () => {
    // La mitad visible de la decisión de la cabecera: se ofrecen los cuatro en las dos pestañas,
    // y lo que impide que «pedí `aprobado` en Pendientes y no salió nada» se lea como una avería
    // es que el desplegable diga a qué lista pertenece cada uno.
    const user = userEvent.setup();
    montar({ conEstado: true });

    const lista = await abrirEstado(user);

    const pendientes = within(lista).getByRole("group", { name: "Pendientes" });
    expect(etiquetas(pendientes)).toEqual(["Solicitado", "Vencido"]);

    const resueltos = within(lista).getByRole("group", { name: "Resueltos" });
    expect(etiquetas(resueltos)).toEqual(["Aprobado", "Rechazado"]);
  });

  it("emite `estados` en PLURAL y como lista, y el borde real lo acepta", async () => {
    const user = userEvent.setup();
    const onChange = montar({ conEstado: true });

    const lista = await abrirEstado(user);
    await user.click(within(lista).getByRole("option", { name: "Vencido" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const emitido = ultimoEmitido(onChange);

    // El valor que viaja es el del ENUM, no la etiqueta: la traducción es solo de ida.
    expect(emitido.estados).toEqual(["vencido"]);
    // Y lo emitido pasa por el MISMO zod que valida la Server Action. Sin esto, «la pantalla
    // emite algo que el servidor rechaza» solo se vería en producción.
    const r = filtrosCierresSchema.safeParse(emitido);
    expect(r.success, `el borde rechazó lo que la barra emitió: ${JSON.stringify(emitido)}`).toBe(
      true,
    );
  });

  it("varios estados a la vez viajan los dos, en el orden en que se marcaron", async () => {
    const user = userEvent.setup();
    const onChange = montar({ conEstado: true });

    const lista = await abrirEstado(user);
    await user.click(within(lista).getByRole("option", { name: "Solicitado" }));
    await user.click(within(lista).getByRole("option", { name: "Vencido" }));

    await waitFor(() =>
      expect(ultimoEmitido(onChange).estados).toEqual(["solicitado", "vencido"]),
    );
    expect(filtrosCierresSchema.safeParse(ultimoEmitido(onChange)).success).toBe(true);
  });

  it("DESMARCARLO TODO omite la clave: no manda `[]`, que el borde rechaza", async () => {
    // El caso que da nombre a la mitad delicada de esta ficha. `[]` no es «todos»: es «los
    // cierres de cero estados», que es siempre nada. Quien desmarca la última casilla espera
    // volver a verlo todo, no un `validation_error` ni una lista vacía.
    const user = userEvent.setup();
    const onChange = montar({ conEstado: true });

    // Se marcan los CUATRO con el atajo «Todos»…
    const lista = await abrirEstado(user);
    await user.click(within(lista).getByRole("option", { name: "Todos" }));
    await waitFor(() => expect(ultimoEmitido(onChange).estados).toHaveLength(4));

    // …y se desmarcan los cuatro con el mismo atajo.
    await user.click(within(lista).getByRole("option", { name: "Todos" }));

    await waitFor(() => {
      const emitido = ultimoEmitido(onChange);
      expect(
        "estados" in emitido,
        `la clave sobrevivió al desmarcado: ${JSON.stringify(emitido)}`,
      ).toBe(false);
    });
    // Y el borde lo acepta, que es la otra mitad: con `estados: []` esto sería `false`.
    expect(filtrosCierresSchema.safeParse(ultimoEmitido(onChange)).success).toBe(true);
  });

  it("la X del control también lo deja sin filtro, no con la lista vacía", async () => {
    // El otro gesto que lleva al mismo sitio: la X que `MultiSelectFilter` superpone al
    // disparador llama a `onChange([])` directamente. Es el camino más corto a `estados: []` y
    // por eso se prueba aparte del atajo «Todos».
    const user = userEvent.setup();
    const onChange = montar({ conEstado: true });

    const lista = await abrirEstado(user);
    await user.click(within(lista).getByRole("option", { name: "Aprobado" }));
    await waitFor(() => expect(ultimoEmitido(onChange).estados).toEqual(["aprobado"]));

    const barra = screen.getByRole("region", { name: BARRA });
    await user.click(within(barra).getByRole("button", { name: "Limpiar Estado" }));

    await waitFor(() => expect("estados" in ultimoEmitido(onChange)).toBe(false));
    expect(filtrosCierresSchema.safeParse(ultimoEmitido(onChange)).success).toBe(true);
  });

  it("por defecto la barra NO ofrece el estado, y lo que emite no lleva la clave", async () => {
    // La protección de las DOS pantallas de bodega, que montan esta misma barra contra un bloque
    // (`filtrosCierresBodegaSchema`) que no declara `estados` y es `.strict()`. Se comprueban las
    // dos mitades: que el control no se ofrece Y que lo emitido no gana una clave nueva —porque
    // ofrecerlo y emitirlo son dos descuidos distintos y solo uno se ve mirando la pantalla.
    const user = userEvent.setup();
    const onChange = montar({ sinMensajero: true });

    const barra = await screen.findByRole("region", { name: BARRA });
    await user.click(within(barra).getByRole("button", { name: /^Filtros/ }));
    const ofrecidos = within(screen.getByRole("listbox", { name: "Filtros" }))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(ofrecidos).toEqual(["Fecha de solicitud", "Bodega"]);

    // Y con un filtro que SÍ existe puesto, lo emitido sigue sin la clave del estado.
    await pedirFiltro(user, "Bodega");
    await user.click(within(barra).getByRole("button", { name: /^Bodega:/ }));
    await user.click(await screen.findByRole("option", { name: "Bodega Heredia" }));

    await waitFor(() =>
      expect(ultimoEmitido(onChange).destinoZonaIds).toEqual([ZONA_A]),
    );
    expect("estados" in ultimoEmitido(onChange)).toBe(false);
  });
});
