// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { descargarBlob } from "@/components/shared/descargar-blob";
import type {
  HistorialAccionDTO,
  ListarHistorialAccionesCompletoResult,
  ListarHistorialAccionesResult,
} from "@/lib/types/historial-accion";

// FICHA 362 / T5.4 y T5.5 (R27/R30/R34–R37) — el MÓDULO del registro de acciones.
//
// Los tres casos que no se pueden deducir leyendo el código, y que si no están aquí no están
// en ninguna parte porque NINGUNO rompe nada visible:
//
//   · el ORDEN en la key de SWR (R27) — sin él, el control puesto y las filas sin moverse;
//   · `limite_excedido` tratado como ERROR (R30) — sin él, un archivo incompleto que el
//     usuario cree completo;
//   · el vacío que dice que el registro EMPIEZA el día del despliegue — sin él, el maestro ve
//     poco y concluye que está roto.

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});

// El control de descarga NO pinta el fallo en la tabla: lo dice por toast
// (`DescargarDatasetButton`). Para poder afirmar QUÉ dice, el doble tiene que ser
// inspeccionable.
const { errorToastMock } = vi.hoisted(() => ({ errorToastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorToastMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Las DOS lecturas, dobladas a nivel de módulo además de por `acciones`: si alguien saltara
// la inyección, el espía del módulo lo cazaría igual y ni Prisma ni `next/headers` entrarían.
const { listarMock, completoMock, catalogoMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  completoMock: vi.fn(),
  catalogoMock: vi.fn(),
}));
vi.mock("@/lib/actions/historial-acciones", () => ({
  listarHistorialAccionesPaginado: listarMock,
  listarHistorialAccionesCompleto: completoMock,
  obtenerCatalogoActoresHistorial: catalogoMock,
}));

import {
  HistorialAccionesModule,
  VACIO_DESCRIPCION,
  obtenerFilasDescargaHistorial,
} from "@/app/(app)/historico/acciones/_components/HistorialAccionesModule";
import { mensajeLimiteHistorial } from "@/app/(app)/historico/acciones/_components/historial-acciones-descarga";

const AHORA = new Date("2026-09-02T18:00:00Z");

function fila(extra: Partial<HistorialAccionDTO> = {}): HistorialAccionDTO {
  return {
    id: "f1",
    // 05:30 UTC del 2 = 23:30 del 1 en Costa Rica (UTC-6). Es la fila que distingue un
    // formateo en CR de uno en UTC (R35).
    fecha: "2026-09-02T05:30:00.000Z",
    accion: "orden_eliminada",
    accionLabel: "Eliminó una orden",
    categoria: "hace_desaparecer",
    entidadTipo: "orden",
    entidadEtiqueta: "Guía 1234",
    actorNombre: "Ana Mora",
    actorRol: "admin",
    monto: "1234.50",
    valorAnterior: null,
    valorNuevo: null,
    loteId: "l1",
    ...extra,
  };
}

function ok(items: HistorialAccionDTO[], total = items.length): ListarHistorialAccionesResult {
  return { status: "ok", items, page: 1, pageSize: 25, total };
}

/** El doble del servidor RESPETA el orden pedido: `asc` y `desc` devuelven filas distintas. */
function servidorQueOrdena() {
  listarMock.mockImplementation(async (input: { sortDir?: string }) =>
    ok([
      input?.sortDir === "asc"
        ? fila({ id: "vieja", entidadEtiqueta: "Guía ANTIGUA" })
        : fila({ id: "nueva", entidadEtiqueta: "Guía RECIENTE" }),
    ], 60),
  );
}

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}

function montar(props: Partial<Parameters<typeof HistorialAccionesModule>[0]> = {}) {
  return renderModule(
    <HistorialAccionesModule actores={[]} ahora={AHORA} debounceMs={0} {...props} />,
  );
}

/** La ÚLTIMA entrada con la que se llamó al listado paginado. */
function ultimaLlamada(): Record<string, unknown> {
  return (listarMock.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue(ok([fila()]));
  completoMock.mockResolvedValue({ status: "ok", items: [fila()] });
});

afterEach(() => cleanup());

describe("R34 — cada fila dice quién, qué, sobre qué y cuándo", () => {
  it("las diez cabeceras están, y entre ellas las cuatro de R34", () => {
    montar();
    const cabeceras = screen.getAllByRole("columnheader").map((th) => th.textContent);

    expect(cabeceras).toEqual([
      "Cuándo",
      "Quién",
      "Rol",
      "Categoría",
      "Qué",
      "Tipo",
      "Sobre qué",
      "Importe",
      "Valor anterior",
      "Valor nuevo",
    ]);
  });

  it("la fila pinta el actor, la acción y la entidad", async () => {
    montar();
    expect(await screen.findByText("Ana Mora")).toBeInTheDocument();
    expect(screen.getByText("Eliminó una orden")).toBeInTheDocument();
    expect(screen.getByText("Guía 1234")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.getByText("Hace desaparecer algo")).toBeInTheDocument();
    expect(screen.getByText("Orden")).toBeInTheDocument();
  });

  it("`accionLabel` y `entidadEtiqueta` se pintan CONGELADOS, no re-derivados del tipo", () => {
    // La etiqueta de la fila es la que era el día del hecho. Si la pantalla la recalculara a
    // partir de `accion`, esta fila diría «Eliminó una orden» en vez de lo que trae.
    listarMock.mockResolvedValue(
      ok([
        fila({
          accion: "orden_eliminada",
          accionLabel: "Texto de entonces, distinto del catálogo",
          entidadEtiqueta: "Etiqueta congelada de una orden que ya no existe",
        }),
      ]),
    );
    montar();

    return waitFor(() => {
      expect(
        screen.getByText("Texto de entonces, distinto del catálogo"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Etiqueta congelada de una orden que ya no existe"),
      ).toBeInTheDocument();
    });
  });
});

describe("R36 — la fila sin actor es del SISTEMA, nunca en blanco", () => {
  it("`actorNombre: null` se pinta «Sistema»", async () => {
    listarMock.mockResolvedValue(ok([fila({ actorNombre: null, actorRol: null })]));
    montar();

    expect(await screen.findByText("Sistema")).toBeInTheDocument();
    // Y no queda una celda vacía donde iba el nombre: la mutación que R36 prohíbe es pintar
    // `""`, que se lee como «falta el dato».
    const filas = screen.getAllByRole("row");
    const celdas = within(filas[1] as HTMLElement).getAllByRole("cell");
    expect(celdas[1]?.textContent?.trim()).toBe("Sistema");
  });
});

describe("R37 — el importe, con el formato de dinero de la casa", () => {
  it("un `monto` string se pinta `₡1.234,50` y no crudo", async () => {
    montar();
    expect(await screen.findByText("₡1.234,50")).toBeInTheDocument();
    expect(screen.queryByText("1234.50")).toBeNull();
  });

  it("un importe grande conserva TODOS sus céntimos (nada de `Number`)", async () => {
    listarMock.mockResolvedValue(ok([fila({ monto: "13331832.72" })]));
    montar();
    expect(await screen.findByText("₡13.331.832,72")).toBeInTheDocument();
  });

  it("sin importe se pinta la raya, no un cero", async () => {
    // Pintar `₡0,00` donde no hay importe es inventar un dato en una pantalla de auditoría.
    listarMock.mockResolvedValue(ok([fila({ monto: null })]));
    montar();
    await screen.findByText("Ana Mora");
    expect(screen.queryByText("₡0,00")).toBeNull();
  });
});

describe("R35 — el instante se pinta en la zona de Costa Rica", () => {
  it("una fila escrita a las 23:30 CR aparece en el día CR, no en el siguiente", async () => {
    montar();
    // `2026-09-02T05:30:00Z` es el 1 de septiembre a las 23:30 en Costa Rica.
    const celda = await screen.findByText(/1 sept/);
    expect(celda).toBeInTheDocument();
    expect(screen.queryByText(/2 sept/)).toBeNull();
  });
});

describe("⭑ R27 — el ORDEN está en la key de la caché", () => {
  beforeEach(() => servidorQueOrdena());

  it("arranca en «Más recientes», que es el defecto del contrato", async () => {
    montar();
    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    expect(ultimaLlamada().sortDir).toBe("desc");
    expect(ultimaLlamada().sortBy).toBe("created_at");
  });

  it("cambiar a «Más antiguas» vuelve a consultar Y repinta las filas del nuevo orden", async () => {
    // ⭑ EL CASO QUE ATA LA CLAVE. Quitar `claveDeOrden` de la key de SWR lo deja rojo por las
    // dos vías a la vez: no hay segunda consulta (misma key = respuesta cacheada) y la tabla
    // sigue enseñando la fila de «Más recientes» con el control puesto en «Más antiguas». Es
    // el fallo que haría parecer roto el control sin romper ningún otro test.
    montar();
    expect(await screen.findByText("Guía RECIENTE")).toBeInTheDocument();
    expect(listarMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Más antiguas" }));

    expect(await screen.findByText("Guía ANTIGUA")).toBeInTheDocument();
    expect(screen.queryByText("Guía RECIENTE")).toBeNull();
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(2));
    expect(ultimaLlamada().sortDir).toBe("asc");
  });

  it("volver a la dirección anterior sirve SU respuesta, no la del otro orden", async () => {
    montar();
    await screen.findByText("Guía RECIENTE");

    await userEvent.click(screen.getByRole("button", { name: "Más antiguas" }));
    await screen.findByText("Guía ANTIGUA");

    await userEvent.click(screen.getByRole("button", { name: "Más recientes" }));
    expect(await screen.findByText("Guía RECIENTE")).toBeInTheDocument();
  });

  it("el conmutador anuncia cuál está puesta (`aria-pressed`)", async () => {
    montar();
    await screen.findByText("Guía RECIENTE");

    expect(screen.getByRole("button", { name: "Más recientes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Más antiguas" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("el grupo tiene nombre accesible propio, distinto del filtro de fecha", () => {
    montar();
    expect(screen.getByRole("group", { name: "Ordenar por fecha" })).toBeInTheDocument();
  });
});

describe("T5.5 — el estado VACÍO dice que el registro empieza el día del despliegue", () => {
  it("sin filas, el texto explica que lo anterior no existe", async () => {
    listarMock.mockResolvedValue(ok([], 0));
    montar();

    expect(
      await screen.findByText("Todavía no hay acciones registradas"),
    ).toBeInTheDocument();
    const descripcion = screen.getByText(VACIO_DESCRIPCION);
    expect(descripcion).toBeInTheDocument();
    // Las tres cosas que el texto TIENE que decir, afirmadas sobre el texto y no sobre la
    // constante: un cero aquí significa «aún no ha pasado», no «está roto», y sólo se puede
    // saber si el vacío lo dice.
    expect(descripcion.textContent).toContain("empieza el día");
    expect(descripcion.textContent).toContain("no se puede reconstruir");
  });

  it("con búsqueda activa, el vacío es OTRO: «sin coincidencias» y el término", async () => {
    // Decir «todavía no hay acciones» mientras se busca es literalmente falso, y empuja a
    // concluir que la pantalla se rompió (169/R40).
    listarMock.mockResolvedValue(ok([], 0));
    montar();
    await screen.findByText("Todavía no hay acciones registradas");

    await userEvent.type(screen.getByRole("searchbox"), "zzz");

    expect(await screen.findByText("Sin coincidencias")).toBeInTheDocument();
    expect(screen.getByText(/Ninguna acción coincide con «zzz»/)).toBeInTheDocument();
    expect(screen.queryByText("Todavía no hay acciones registradas")).toBeNull();
  });
});

describe("R28 — la barra es la COMPARTIDA, no una propia", () => {
  it("el campo de búsqueda es el `searchbox` de `BuscadorFiltros`, no un `<input>` suelto", () => {
    montar();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    // `BuscadorFiltros` monta un `searchbox`; un campo propio sería un `textbox`.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("el buscador tiene nombre accesible y su placeholder documenta qué alcanza", () => {
    montar();
    const campo = screen.getByRole("searchbox", { name: "Buscar en el registro" });
    expect(campo).toHaveAttribute(
      "placeholder",
      "Persona, guía, remisión o nombre de lo afectado",
    );
  });

  it("el término viaja al servidor sólo por encima del mínimo (R32)", async () => {
    montar();
    await waitFor(() => expect(listarMock).toHaveBeenCalled());

    await userEvent.type(screen.getByRole("searchbox"), "an");
    await new Promise((r) => setTimeout(r, 20));
    expect(ultimaLlamada().q).toBeUndefined();

    await userEvent.type(screen.getByRole("searchbox"), "a");
    await waitFor(() => expect(ultimaLlamada().q).toBe("ana"));
  });
});

describe("⭑ R30 — la descarga: mismo conjunto, y el tope es un ERROR", () => {
  const NOMBRE_BOTON = "Descargar Registro de acciones";

  it("la descarga pide el conjunto completo con el filtro y el orden VIGENTES", async () => {
    servidorQueOrdena();
    completoMock.mockResolvedValue({ status: "ok", items: [fila()] });
    montar();
    await screen.findByText("Guía RECIENTE");

    await userEvent.click(screen.getByRole("button", { name: "Más antiguas" }));
    await screen.findByText("Guía ANTIGUA");

    await userEvent.click(screen.getByRole("button", { name: NOMBRE_BOTON }));

    // Se espera a que la descarga TERMINE antes de acabar el caso: sin esto, la promesa
    // sigue viva tras el `cleanup()` y su `descargarBlob` cae dentro del siguiente test, que
    // ya limpió los dobles. (Medido: hacía fallar al caso del `limite_excedido` con un
    // `descargarBlob` que no era suyo.)
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalled());
    const entrada = completoMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    // Mismo orden que la pantalla: descargar «lo que estoy viendo» y abrirlo al revés es la
    // misma sorpresa que el conmutador ya evita en la tabla.
    expect(entrada.sortDir).toBe("asc");
    expect(entrada.sortBy).toBe("created_at");
    // Y SIN página: la descarga no la tiene.
    expect(entrada).not.toHaveProperty("page");
    expect(entrada).not.toHaveProperty("pageSize");
  });

  it("⭑ `limite_excedido` NO produce archivo y avisa con el tope", async () => {
    // ⚠️ LA MUTACIÓN QUE ESTE CASO MATA: tratar `limite_excedido` como éxito. El usuario se
    // llevaría un archivo INCOMPLETO creyéndolo completo, y en una auditoría lo que no está
    // en el archivo se da por no ocurrido. Ningún otro test lo notaría: la descarga
    // «funciona», el archivo existe y nadie lo compara con la pantalla.
    const limite: ListarHistorialAccionesCompletoResult = {
      status: "limite_excedido",
      maximo: 5000,
    };
    completoMock.mockResolvedValue(limite);
    montar();
    await screen.findByText("Ana Mora");

    await userEvent.click(screen.getByRole("button", { name: NOMBRE_BOTON }));

    await waitFor(() => expect(errorToastMock).toHaveBeenCalled());
    expect(errorToastMock).toHaveBeenCalledWith(mensajeLimiteHistorial(5000));
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("`forbidden` en la descarga tampoco produce archivo", async () => {
    completoMock.mockResolvedValue({ status: "forbidden" });
    montar();
    await screen.findByText("Ana Mora");

    await userEvent.click(screen.getByRole("button", { name: NOMBRE_BOTON }));

    await waitFor(() => expect(errorToastMock).toHaveBeenCalled());
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("con datos SÍ produce archivo: el camino feliz no se rompió", async () => {
    completoMock.mockResolvedValue({ status: "ok", items: [fila()] });
    montar();
    await screen.findByText("Ana Mora");

    await userEvent.click(screen.getByRole("button", { name: NOMBRE_BOTON }));

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    expect(errorToastMock).not.toHaveBeenCalled();
  });
});

describe("R22 — la paginación la resuelve el servidor", () => {
  it("el total que pinta la barra es el del CONJUNTO, no el de la página", async () => {
    listarMock.mockResolvedValue(ok([fila()], 137));
    montar();
    await screen.findByText("Ana Mora");
    expect(screen.getByRole("navigation", { name: /paginación/i })).toBeInTheDocument();
  });

  it("cambiar el orden vuelve a la página 1", async () => {
    // La página N de un orden NO es la página N del contrario: quedarse en la 7 al invertir
    // deja al usuario en un tramo arbitrario del conjunto dado la vuelta, que parece legítimo.
    servidorQueOrdena();
    montar();
    await screen.findByText("Guía RECIENTE");

    await userEvent.click(screen.getByRole("button", { name: "Ir a la página 2" }));
    await waitFor(() => expect(ultimaLlamada().page).toBe(2));

    await userEvent.click(screen.getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(ultimaLlamada().page).toBe(1));
  });
});

describe("⭑ el adaptador de la descarga: qué traduce él y qué delega en el común", () => {
  it("`ok` produce una fila por elemento, en el MISMO orden que devolvió el servidor", async () => {
    const res = await obtenerFilasDescargaHistorial({
      status: "ok",
      items: [
        fila({ id: "a", entidadEtiqueta: "Primera" }),
        fila({ id: "b", entidadEtiqueta: "Segunda" }),
      ],
    });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("inalcanzable");
    expect(res.filas.map((f) => f.entidad)).toEqual(["Primera", "Segunda"]);
    // Y las diez columnas: el camino feliz pasa por `filasDesdeResultado`, el adaptador común.
    expect(Object.keys(res.filas[0] ?? {})).toHaveLength(10);
  });

  it("⭑ `limite_excedido` NO produce archivo: devuelve error con el tope", async () => {
    // ⚠️ LA MUTACIÓN QUE ESTE CASO MATA: tratarlo como éxito. El usuario se llevaría un
    // archivo INCOMPLETO creyéndolo completo.
    const res = await obtenerFilasDescargaHistorial({
      status: "limite_excedido",
      maximo: 5000,
    });

    expect(res.status).toBe("error");
    if (res.status !== "error") throw new Error("inalcanzable");
    expect(res.mensaje).toBe(mensajeLimiteHistorial(5000));
    expect(res).not.toHaveProperty("filas");
  });

  for (const estado of ["unauthenticated", "forbidden"] as const) {
    it(`\`${estado}\` tampoco produce archivo (lo traduce el adaptador común)`, async () => {
      const res = await obtenerFilasDescargaHistorial({ status: estado });
      expect(res.status).toBe("error");
      if (res.status !== "error") throw new Error("inalcanzable");
      expect(res.mensaje.trim()).not.toBe("");
      // El mensaje del adaptador común siempre dice qué hacer después.
      expect(res.mensaje).toContain("Vuelve a intentarlo");
    });
  }

  it("`validation_error` tampoco, y el mensaje no ecoa el motivo crudo del servidor", async () => {
    const res = await obtenerFilasDescargaHistorial({
      status: "validation_error",
      motivo: "Unrecognized key: 'zona_id'",
    });
    expect(res.status).toBe("error");
    if (res.status !== "error") throw new Error("inalcanzable");
    expect(res.mensaje).not.toContain("Unrecognized");
  });

  it("un dataset vacío SÍ es `ok` con cero filas: quien avisa es el control", async () => {
    expect(await obtenerFilasDescargaHistorial({ status: "ok", items: [] })).toEqual({
      status: "ok",
      filas: [],
    });
  });
});

describe("R21 — la pantalla no ofrece ninguna operación de escritura", () => {
  it("no hay formulario, ni campo de texto libre, ni botón que mute", async () => {
    montar();
    await screen.findByText("Ana Mora");

    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    for (const patron of [/eliminar/i, /guardar/i, /crear/i, /aprobar/i, /anular/i]) {
      expect(screen.queryByRole("button", { name: patron })).toBeNull();
    }
  });
});
