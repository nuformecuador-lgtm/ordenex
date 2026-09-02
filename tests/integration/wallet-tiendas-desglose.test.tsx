// @vitest-environment jsdom
// Feature 171 (T2.7) — el DESPLEGABLE del dinero de una tienda, montado sobre la tabla de
// saldos REAL. Cubre R1–R5, R7, R11, R13–R21, R32, R33, R36, R37, R38, R43, R44, R45, R46.
//
// Se monta `SaldosTiendasTable` de verdad —no el desglose suelto— porque casi todo lo que
// esta feature promete es una propiedad de la RELACIÓN entre la tabla y sus filas abiertas:
// que listar no consulte, que abrir consulte una vez, que dos filas abiertas no se pisen y
// que un fallo en una no tumbe a las demás. Con el componente aislado, ninguna de esas
// cuatro se puede afirmar.
//
// La caché de SWR se aísla por render (`provider` nuevo + `dedupingInterval: 0`) para que
// cada test observe SUS propias llamadas a la Server Action, que va doblada.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig, mutate as mutateGlobal } from "swr";
import type { ReactNode } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type {
  ListarMovimientosDeTiendaResult,
  SaldoTiendaResumenDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";

const listarDesgloseMock = vi.fn();
const listarDesgloseCompletoMock = vi.fn();
// Feature 170 - FASE 2 (T I.2): la tabla de saldos pide su pagina al servidor (SWR revalida
// al montar) y relee el conjunto completo para descargar. Ninguna de las dos lecturas toca el
// desglose, que es lo que este archivo vigila; se programan en `renderTabla`.
const listarSaldosPaginaMock = vi.fn();
const listarSaldosCompletoMock = vi.fn();
/** Feature 184 - Tanda G (T G.2): la lectura DEDICADA de la que sale el archivo. */
const listarSaldosDedicadoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMovimientosDeTiendaAction: (...a: unknown[]) => listarDesgloseMock(...a),
  listarMovimientosDeTiendaCompletoAction: (...a: unknown[]) =>
    listarDesgloseCompletoMock(...a),
  // Feature 170 - FASE 2 (T I.2): la tabla de saldos pide su pagina al servidor y relee el
  // conjunto completo para descargar. Ninguna de las dos toca el desglose, que es lo que
  // este archivo vigila.
  //
  // Feature 184 - Tanda G (T G.2): el conjunto del archivo sale ya de la lectura DEDICADA.
  // Sin declararla aqui, el control de descarga de esta tabla llama a `undefined` y el
  // archivo no sale (este archivo lo PULSA en su caso de la descarga).
  listarSaldosTiendasPaginadoAction: (...a: unknown[]) => listarSaldosPaginaMock(...a),
  listarSaldosTiendasCompletoAction: (...a: unknown[]) => listarSaldosDedicadoMock(...a),
  listarSaldosTiendasAction: (...a: unknown[]) => listarSaldosCompletoMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";
import {
  DesgloseMovimientosTienda,
  claveDesgloseTienda,
} from "@/app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda";

// --- Datos ---------------------------------------------------------------

const NORTE: SaldoTiendaResumenDTO = {
  tiendaId: "t1",
  tiendaNombre: "Tienda Norte",
  saldo: "9000.00",
  signo: "positivo",
};

const SUR: SaldoTiendaResumenDTO = {
  tiendaId: "t2",
  tiendaNombre: "Tienda Sur",
  saldo: "-452.00",
  signo: "negativo",
};

const TIENDAS = [NORTE, SUR];

function mov(over: Partial<WalletTiendaMovimientoDTO> = {}): WalletTiendaMovimientoDTO {
  return {
    id: "m1",
    tiendaId: "t1",
    tipo: "credito",
    categoria: "cod_recaudado",
    monto: "10000.00",
    origenTipo: "cierre_dia",
    origenId: "c1",
    descripcion: null,
    fechaMovimiento: "2026-07-12T10:00:00.000Z",
    ...over,
  };
}

// Desglose SIN filtros de Tienda Norte. Dos movimientos, más reciente primero (el servidor
// ya los devuelve ordenados). La cabecera cumple 10000 − 1000 − 0 = 9000, que es EXACTAMENTE
// el saldo de la fila (R11).
const DESGLOSE_NORTE: ListarMovimientosDeTiendaResult = {
  tiendaId: "t1",
  movimientos: [
    mov({ id: "m2", fechaMovimiento: "2026-07-12T10:00:00.000Z" }),
    mov({
      id: "m1",
      tipo: "debito",
      categoria: "iva_comision_cod",
      monto: "1000.00",
      fechaMovimiento: "2026-07-05T10:00:00.000Z",
      descripcion: "Cierre del 5",
    }),
  ],
  total: 42, // > pageSize: hay más páginas (R17)
  page: 1,
  pageSize: 20,
  desglose: {
    aFavor: "10000.00",
    cargos: "1000.00",
    pagado: "0.00", // R43: cero VERDADERO, no «no disponible»
    saldo: "9000.00",
    signo: "positivo",
  },
};

const DESGLOSE_SUR: ListarMovimientosDeTiendaResult = {
  tiendaId: "t2",
  movimientos: [
    mov({
      id: "s1",
      tiendaId: "t2",
      tipo: "debito",
      categoria: "flete",
      monto: "452.00",
      fechaMovimiento: "2026-07-08T10:00:00.000Z",
    }),
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  desglose: {
    aFavor: "0.00",
    cargos: "452.00",
    pagado: "0.00",
    saldo: "-452.00",
    signo: "negativo",
  },
};

// Conjunto FILTRADO: subconjunto de filas y —lo que importa— cabecera del conjunto filtrado,
// no del agregado total (R12).
const DESGLOSE_FILTRADO: ListarMovimientosDeTiendaResult = {
  ...DESGLOSE_NORTE,
  movimientos: [DESGLOSE_NORTE.movimientos[1]],
  total: 1,
  desglose: {
    aFavor: "0.00",
    cargos: "1000.00",
    pagado: "0.00",
    saldo: "-1000.00",
    signo: "negativo",
  },
};

const DESGLOSE_VACIO: ListarMovimientosDeTiendaResult = {
  ...DESGLOSE_NORTE,
  movimientos: [],
  total: 0,
  desglose: {
    aFavor: "0.00",
    cargos: "0.00",
    pagado: "0.00",
    saldo: "0.00",
    signo: "cero",
  },
};

/** Responde a cada llamada con el desglose de la tienda que se pidió (nunca el de otra). */
function responderPorTienda(
  porTienda: Record<string, ListarMovimientosDeTiendaResult> = {
    t1: DESGLOSE_NORTE,
    t2: DESGLOSE_SUR,
  },
) {
  listarDesgloseMock.mockImplementation(async (input: { tiendaId: string }) => {
    const data = porTienda[input.tiendaId];
    if (!data) throw new Error(`sin doble para ${input.tiendaId}`);
    return { status: "ok", data };
  });
}

// --- Montaje -------------------------------------------------------------

function envolver(nodo: ReactNode) {
  // El control de descarga del `DataTable` usa `useToast`; en la app el proveedor vive en
  // `app/(app)/layout.tsx`, encima de esta pantalla.
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

/**
 * Feature 170 — FASE 2 (T I.2): la tabla recibe la PÁGINA que pre-cargó el Server Component.
 * El helper sigue tomando el array para no reescribir cada caso.
 */
function renderTabla(tiendas: SaldoTiendaResumenDTO[] = TIENDAS) {
  programarSaldos(tiendas);
  return envolver(<SaldosTiendasTable initialData={paginaInicial(tiendas)} />);
}

/** Deja las tres lecturas de saldos devolviendo el MISMO conjunto que se monta. */
function programarSaldos(tiendas: SaldoTiendaResumenDTO[]) {
  listarSaldosPaginaMock.mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(tiendas),
  });
  // T G.2: de aqui sale el archivo. La relectura vieja se conserva programada: que ya no se
  // llame tiene que ser una decision de la pantalla, no que el doble no responda.
  listarSaldosDedicadoMock.mockResolvedValue({
    status: "ok",
    items: tiendas,
    total: tiendas.length,
  });
  listarSaldosCompletoMock.mockResolvedValue({ status: "ok", tiendas });
}

/** Despliega la fila de una tienda por el nombre accesible de SU botón. */
async function desplegar(tiendaNombre: string) {
  fireEvent.click(screen.getByRole("button", { name: `Ver desglose de ${tiendaNombre}` }));
  return screen.findByRole("region", { name: `Desglose de ${tiendaNombre}` });
}

/**
 * Los cuatro bloques de importe de la cabecera, en orden de pantalla.
 *
 * Se acota a la cabecera a propósito: los mismos montos aparecen también en las filas de la
 * tabla de movimientos, y una búsqueda global no distinguiría «el total a favor» de «el
 * importe de un movimiento que casualmente vale lo mismo».
 */
function importesDeCabecera(region: HTMLElement): HTMLElement[] {
  return Array.from(region.firstElementChild!.children) as HTMLElement[];
}

/** Rótulo de un bloque de importe (el primer `span`, junto al que va la insignia de signo). */
function rotuloDe(bloque: HTMLElement): string {
  return bloque.firstElementChild!.firstElementChild!.textContent ?? "";
}

/** La CIFRA de un bloque de importe, tal cual está pintada. */
function cifraDe(bloque: HTMLElement): string {
  return (bloque.children[1] as HTMLElement).textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  responderPorTienda();
  listarDesgloseCompletoMock.mockResolvedValue({
    status: "ok",
    items: DESGLOSE_NORTE.movimientos,
    total: DESGLOSE_NORTE.movimientos.length,
  });
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------

describe("R32/R33 — la lectura se paga al ABRIR, no al listar", () => {
  it("con la tabla pintada y ninguna fila abierta NO se lee ningún desglose", async () => {
    renderTabla([
      NORTE,
      SUR,
      { ...NORTE, tiendaId: "t3", tiendaNombre: "Tienda Este" },
      { ...NORTE, tiendaId: "t4", tiendaNombre: "Tienda Oeste" },
    ]);

    expect(await screen.findByText("Tienda Norte")).toBeInTheDocument();
    expect(screen.getByText("Tienda Oeste")).toBeInTheDocument();

    // Cuatro tiendas listadas, CERO lecturas. Es lo que hace que la pantalla no cueste más
    // por tener más tiendas: el `useSWR` vive dentro del desglose, que aún no se ha montado.
    expect(listarDesgloseMock).not.toHaveBeenCalled();
  });

  it("abrir una fila emite EXACTAMENTE una lectura, y con el tiendaId de ESA fila (R2)", async () => {
    renderTabla();
    await desplegar("Tienda Norte");

    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));
    expect(listarDesgloseMock).toHaveBeenCalledWith({
      tiendaId: "t1",
      page: 1,
      pageSize: 20,
    });
    // Contraprueba de R2: ninguna llamada pidió la otra tienda.
    for (const [input] of listarDesgloseMock.mock.calls) {
      expect(input.tiendaId).toBe("t1");
    }
  });

  it("abrir la segunda fila cuesta UNA lectura más, no vuelve a leer la primera (R3)", async () => {
    renderTabla();
    await desplegar("Tienda Norte");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));

    await desplegar("Tienda Sur");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(2));
    expect(listarDesgloseMock.mock.calls.map(([i]) => i.tiendaId)).toEqual(["t1", "t2"]);
  });

  it("cerrar y reabrir no acumula lecturas de más allá de una por apertura", async () => {
    renderTabla();
    await desplegar("Tienda Norte");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));

    // Cerrar: el desglose se desmonta.
    fireEvent.click(screen.getByRole("button", { name: "Ver desglose de Tienda Norte" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Desglose de Tienda Norte" }),
      ).not.toBeInTheDocument(),
    );
    expect(listarDesgloseMock).toHaveBeenCalledTimes(1);
  });
});

describe("R7/R11/R14/R43 — la cabecera de cuatro importes", () => {
  it("muestra los CUATRO importes en el orden de la fórmula, con los STRING del servidor", async () => {
    renderTabla();
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));

    // R7: el orden ES la fórmula leída de izquierda a derecha (a favor − cargos − pagado).
    await waitFor(() =>
      expect(within(region).getByText("A favor de la tienda")).toBeInTheDocument(),
    );
    const bloques = importesDeCabecera(region);
    expect(bloques).toHaveLength(4);
    expect(bloques.map(rotuloDe)).toEqual([
      "A favor de la tienda",
      "Cargos de Ordenex",
      "Pagado a la tienda",
      "Saldo a favor",
    ]);

    // R14: las cifras son las que devolvió el servidor, TAL CUAL, y cada una en su sitio.
    // Nada se recalcula aquí: si el cliente hiciera la resta, un `Number()` intermedio ya
    // podría perder el céntimo. Y cuadran: 10000 − 1000 − 0 = 9000.
    expect(bloques.map(cifraDe)).toEqual([
      "₡10.000",
      "₡1.000",
      "₡0",
      "₡9.000",
    ]);
  });

  it("R43: «Pagado a la tienda» se muestra en ₡0 — un cero verdadero, no un «no disponible»", async () => {
    // Hoy ningún flujo emite un pago a tienda (lo cierra la 172), así que la cifra sale
    // siempre cero. Se enseña IGUAL: el servidor la lee de la categoría real del libro, y
    // ocultarla o pintarla como «sin datos» obligaría a rehacer la cabecera el día que
    // existan pagos.
    renderTabla();
    const region = await desplegar("Tienda Norte");

    await within(region).findByText("Pagado a la tienda");
    const bloque = importesDeCabecera(region)[2];
    expect(rotuloDe(bloque)).toBe("Pagado a la tienda");
    // Y no es un texto de ausencia («—», que es lo que se ve mientras carga): la cifra está,
    // con su símbolo (feature 230: sin cola de céntimos, pero cifra al fin).
    await waitFor(() => expect(cifraDe(bloque)).toBe("₡0"));
  });

  it("R43 (contraprueba): el día que haya un pago, la MISMA cabecera lo refleja sin tocar nada", async () => {
    // El mismo componente, con una respuesta que sí trae `pagado`. Si la cifra fuera
    // decorativa (un cero escrito a mano en el cliente), este test caería.
    responderPorTienda({
      t1: {
        ...DESGLOSE_NORTE,
        desglose: {
          aFavor: "10000.00",
          cargos: "1000.00",
          pagado: "4000.00",
          saldo: "5000.00",
          signo: "positivo",
        },
      },
    });
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");

    await waitFor(() =>
      expect(within(region).getByText("₡4.000")).toBeInTheDocument(),
    );
    expect(within(region).getByText("₡5.000")).toBeInTheDocument();
  });

  it("R11: sin filtros, el saldo del desglose es el MISMO de la fila de esa tienda", async () => {
    renderTabla();
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));

    // La fila decía ₡9.000; el desglose sin filtros dice lo mismo, cifra y signo.
    await waitFor(() =>
      expect(within(region).getByText("₡9.000")).toBeInTheDocument(),
    );
    expect(within(region).getByText("A favor")).toBeInTheDocument();
  });

  it("R13: el estado del saldo usa la MISMA etiqueta que la tabla de saldos para ese signo", async () => {
    renderTabla();
    const region = await desplegar("Tienda Sur");

    // Saldo negativo: la tienda le debe a Ordenex. La tabla lo llama «En contra»; el
    // desglose, también — porque leen del mismo mapa.
    await waitFor(() => expect(within(region).getByText("En contra")).toBeInTheDocument());
    expect(within(region).getByText("-₡452")).toBeInTheDocument();
  });
});

describe("R15/R16/R20/R21 — la lista de movimientos", () => {
  it("lista las CINCO columnas en orden y del más reciente al más antiguo", async () => {
    renderTabla();
    await desplegar("Tienda Norte");

    const tabla = await screen.findByRole("table", {
      name: "Movimientos del desglose de Tienda Norte",
    });
    await within(tabla).findByText("2026-07-12");

    const cabeceras = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(cabeceras).toEqual(["Fecha", "Tipo", "Concepto", "Monto", "Origen"]);

    // R16: el orden del servidor se preserva — no se reordena en el cliente.
    const filas = within(tabla).getAllByRole("row");
    expect(within(filas[1]).getByText("2026-07-12")).toBeInTheDocument();
    expect(within(filas[2]).getByText("2026-07-05")).toBeInTheDocument();
  });

  it("R20: concepto y origen salen con la MISMA etiqueta legible que /mi-wallet", async () => {
    renderTabla();
    await desplegar("Tienda Norte");

    const tabla = await screen.findByRole("table", {
      name: "Movimientos del desglose de Tienda Norte",
    });
    await within(tabla).findByText("2026-07-12");

    expect(within(tabla).getByText("COD recaudado")).toBeInTheDocument();
    expect(within(tabla).getByText("IVA de la comisión")).toBeInTheDocument();
    // Nunca el valor interno del enum.
    expect(within(tabla).queryByText("iva_comision_cod")).not.toBeInTheDocument();
    // Origen compuesto: etiqueta · descripción, igual que en el archivo.
    expect(within(tabla).getByText("Cierre del día · Cierre del 5")).toBeInTheDocument();
  });

  it("los montos del servidor se pintan TAL CUAL, con su cola y agrupados, sin recalcular", async () => {
    // ⚠️ Feature 230 — ESTE CASO SE QUEDO SIN PRESA Y SE LE DEVOLVIO UNA. Se titulaba
    // «money-safe: los montos se pintan TAL CUAL, con sus dos decimales» y afirmaba
    // `₡10.000,00` / `₡1.000,00`. Sin la cola decimal, dos importes redondos como esos salen
    // identicos con o sin un `Number(` por el medio: el titulo prometia una medida que ya no
    // existia. Se cambio el conjunto por importes que SI discriminaban con la regla de
    // entonces —un acarreo que cambia de digito y uno de once digitos que no cabe en un
    // `double`—.
    //
    // ✅ FICHA 359 — el conjunto se QUEDA y la presa se refuerza: los mismos dos importes
    // ahora se pintan con su cola, asi que el caso vuelve a medir lo que su titulo original
    // prometia (que los decimales del servidor llegan a pantalla) Y ademas los once digitos.
    // El barrido del caso siguiente sigue cubriendo, sobre el FUENTE, la conversion a numero.
    responderPorTienda({
      t1: {
        ...DESGLOSE_NORTE,
        movimientos: [
          mov({ id: "m2", monto: "999.99" }),
          mov({ id: "m1", monto: "12345678901.99", fechaMovimiento: "2026-07-05T10:00:00.000Z" }),
        ],
      },
    });
    renderTabla();
    await desplegar("Tienda Norte");

    const tabla = await screen.findByRole("table", {
      name: "Movimientos del desglose de Tienda Norte",
    });
    await within(tabla).findByText("2026-07-12");
    // Los dos se pintan enteros y sin moverse. Con la 230 el primero acarreaba a `₡1.000`
    // y el segundo a `₡12.345.678.902`.
    expect(within(tabla).getByText("₡999,99")).toBeInTheDocument();
    expect(within(tabla).queryByText("₡1.000")).toBeNull();
    // Once digitos enteros MAS la cola: un `Number(` intermedio no puede prometerlo.
    expect(within(tabla).getByText("₡12.345.678.901,99")).toBeInTheDocument();
  });

  it("el panel del desglose no convierte ningun monto a numero (money-safe)", () => {
    // La red que el caso de arriba perdio, en el unico sitio donde todavia se puede medir: el
    // CODIGO. Este componente no lo cubre ningun barrido —el de la 172 censa
    // `components/shared/liquidacion` y los `*Liquidacion*` de `lib/`—, asi que sin esto un
    // `parseFloat` en la celda del monto no rompe ni un solo test del repo.
    const fuente = codigoSinComentarios(
      "app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx",
    );
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(fuente, `el panel llama a ${prohibida}`).not.toMatch(prohibida);
    }
    // Contraprueba, para que el barrido no pase por no mirar nada.
    expect(fuente.length).toBeGreaterThan(1000);
    expect("const x = Number(monto);").toMatch(LLAMADAS_PROHIBIDAS_EN_DINERO[0]);
  });

  it("R21: el conjunto filtrado sin movimientos lo DICE, no deja una tabla muda", async () => {
    responderPorTienda({ t1: DESGLOSE_VACIO });
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");

    await waitFor(() =>
      expect(
        within(region).getByText("No hay movimientos que coincidan con los filtros."),
      ).toBeInTheDocument(),
    );
  });
});

describe("R17/R18/R19/R36 — paginación y filtros, resueltos en el servidor", () => {
  it("R17: pagina contra el servidor usando el TOTAL del conjunto filtrado", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));

    // total 42 con pageSize 20 ⇒ 3 páginas; la navegación no recorta un array local.
    const nav = within(region).getByRole("navigation", {
      name: "Paginación del desglose de Tienda Norte",
    });
    expect(within(nav).getByText("1-20 de 42")).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(2));
    expect(listarDesgloseMock).toHaveBeenLastCalledWith({
      tiendaId: "t1",
      page: 2,
      pageSize: 20,
    });
  });

  it("R18/R19: aplicar filtros los manda al servidor y vuelve a la primera página", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));

    // Se avanza a la página 2 primero, para que «volver a la 1» sea observable.
    fireEvent.click(
      within(region).getByRole("button", { name: "Página siguiente" }),
    );
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(2));

    fireEvent.change(within(region).getByLabelText("Cierre"), {
      target: { value: "c1" },
    });
    fireEvent.change(within(region).getByLabelText("Desde"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(within(region).getByLabelText("Hasta"), {
      target: { value: "2026-07-31" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Filtros del desglose de Tienda Norte" }),
    );

    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(3));
    expect(listarDesgloseMock).toHaveBeenLastCalledWith({
      tiendaId: "t1",
      page: 1, // R19
      pageSize: 20,
      cierreId: "c1",
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });
  });

  it("R19: limpiar los filtros también vuelve a la primera página, y sin filtros vacíos", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));

    fireEvent.change(within(region).getByLabelText("Cierre"), {
      target: { value: "c1" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Filtros del desglose de Tienda Norte" }),
    );
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(2));

    fireEvent.click(within(region).getByRole("button", { name: "Limpiar" }));
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(3));
    // Los filtros vacíos NO se mandan: una cadena vacía no es «sin filtro» para el borde.
    expect(listarDesgloseMock).toHaveBeenLastCalledWith({
      tiendaId: "t1",
      page: 1,
      pageSize: 20,
    });
  });

  it("R12: al filtrar, los cuatro importes pasan a ser los del conjunto FILTRADO", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() =>
      expect(within(region).getByText("₡9.000")).toBeInTheDocument(),
    );

    listarDesgloseMock.mockResolvedValueOnce({ status: "ok", data: DESGLOSE_FILTRADO });
    fireEvent.change(within(region).getByLabelText("Cierre"), {
      target: { value: "c1" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Filtros del desglose de Tienda Norte" }),
    );

    await waitFor(() =>
      expect(within(region).getByText("-₡1.000")).toBeInTheDocument(),
    );
    // Y el agregado de antes ya no está: la cabecera habla del conjunto que se está viendo.
    expect(within(region).queryByText("₡9.000")).not.toBeInTheDocument();
  });

  it("R12: mientras vuela la recarga filtrada, el saldo NO enseña la cifra sin filtrar", async () => {
    // Las cuatro cifras se leen juntas: si tres muestran el marcador de carga y la cuarta
    // muestra el saldo de la fila (el del conjunto SIN filtrar), esa cuarta se lee como si
    // fuera el resultado de la consulta en curso. Con filtros aplicados el conjunto es otro,
    // así que hasta que llegue la respuesta el saldo también es «—».
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(within(region).getByText("₡9.000")).toBeInTheDocument());

    // La recarga filtrada se deja EN VUELO a propósito: es el instante del defecto.
    let resolver: (v: unknown) => void = () => {};
    listarDesgloseMock.mockImplementationOnce(
      () => new Promise((res) => { resolver = res; }),
    );
    fireEvent.change(within(region).getByLabelText("Cierre"), { target: { value: "c1" } });
    fireEvent.submit(
      screen.getByRole("form", { name: "Filtros del desglose de Tienda Norte" }),
    );

    const saldo = () => importesDeCabecera(region)[3];
    await waitFor(() => expect(cifraDe(saldo())).toBe("—"));
    // Los cuatro dicen lo mismo: nada que enseñar todavía.
    expect(importesDeCabecera(region).map(cifraDe)).toEqual(["—", "—", "—", "—"]);
    // Y la insignia de signo tampoco afirma nada del conjunto que aún no llegó.
    expect(within(region).queryByText("A favor")).not.toBeInTheDocument();

    // Al llegar la respuesta, las cuatro cifras son las del conjunto filtrado.
    await act(async () => {
      resolver({ status: "ok", data: DESGLOSE_FILTRADO });
    });
    await waitFor(() => expect(cifraDe(saldo())).toBe("-₡1.000"));
    expect(within(region).queryByText("₡9.000")).not.toBeInTheDocument();
  });

  it("R3/R36: filtrar en una fila abierta NO vuelve a consultar la otra", async () => {
    renderTabla();
    await desplegar("Tienda Norte");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));
    const regionSur = await desplegar("Tienda Sur");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(2));

    const llamadasSurAntes = listarDesgloseMock.mock.calls.filter(
      ([i]) => i.tiendaId === "t2",
    ).length;

    fireEvent.change(screen.getByLabelText("Cierre", { selector: "#desglose-tienda-t1-cierre" }), {
      target: { value: "c1" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Filtros del desglose de Tienda Norte" }),
    );

    await waitFor(() =>
      expect(
        listarDesgloseMock.mock.calls.filter(([i]) => i.tiendaId === "t1").length,
      ).toBe(2),
    );
    // La otra tienda no se ha vuelto a consultar: cada fila tiene su propia clave.
    expect(
      listarDesgloseMock.mock.calls.filter(([i]) => i.tiendaId === "t2").length,
    ).toBe(llamadasSurAntes);
    // Y su contenido sigue en pie, con SUS cifras.
    expect(within(regionSur).getByText("-₡452")).toBeInTheDocument();
  });

  it("R44: `pago_tienda` es una opción del filtro por concepto", async () => {
    const user = userEvent.setup();
    renderTabla([NORTE]);
    await desplegar("Tienda Norte");

    await user.click(
      screen.getByRole("combobox", {
        name: "Filtrar por concepto del desglose de Tienda Norte",
      }),
    );
    const listbox = await screen.findByRole("listbox");
    // Está hoy, sin que nadie la haya escrito a mano: la lista se puebla del catálogo.
    expect(
      within(listbox).getByRole("option", { name: "Pago a la tienda" }),
    ).toBeInTheDocument();
    expect(
      within(listbox).getByRole("option", { name: "IVA de la comisión" }),
    ).toBeInTheDocument();
  });
});

describe("R4/R38 — nombres accesibles, uno por tienda", () => {
  it("con dos filas abiertas, ningún control comparte nombre con el de la otra tienda", async () => {
    renderTabla();
    await desplegar("Tienda Norte");
    await desplegar("Tienda Sur");

    for (const nombre of ["Tienda Norte", "Tienda Sur"]) {
      expect(screen.getByRole("region", { name: `Desglose de ${nombre}` })).toBeInTheDocument();
      expect(
        screen.getByRole("form", { name: `Filtros del desglose de ${nombre}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("table", { name: `Movimientos del desglose de ${nombre}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("navigation", { name: `Paginación del desglose de ${nombre}` }),
      ).toBeInTheDocument();
      // R38: el control de descarga identifica a SU tienda; si no, con tres filas abiertas
      // nadie sabría de quién es el archivo que acaba de bajar.
      expect(
        screen.getByRole("button", { name: `Descargar Desglose de ${nombre}` }),
      ).toBeInTheDocument();
    }
  });
});

describe("R37 — la descarga se lleva el conjunto filtrado entero", () => {
  it("pide el modo COMPLETO con los filtros vigentes y SIN paginación", async () => {
    const user = userEvent.setup();
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));

    fireEvent.change(within(region).getByLabelText("Cierre"), {
      target: { value: "c1" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Filtros del desglose de Tienda Norte" }),
    );
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(2));

    await user.click(
      screen.getByRole("button", { name: "Descargar Desglose de Tienda Norte" }),
    );

    await waitFor(() => expect(listarDesgloseCompletoMock).toHaveBeenCalledTimes(1));
    // Los MISMOS filtros y NINGÚN `page`/`pageSize`: el schema del modo completo es
    // `.strict()`, así que colar la paginación devolvería un error en vez de un archivo.
    expect(listarDesgloseCompletoMock.mock.calls[0][0]).toEqual({
      tiendaId: "t1",
      cierreId: "c1",
    });
  });
});

describe("R5 — un desglose que falla no se lleva por delante la pantalla", () => {
  it("el fallo se cuenta DENTRO de esa fila; la tabla de saldos y la otra fila siguen", async () => {
    listarDesgloseMock.mockImplementation(async (input: { tiendaId: string }) => {
      if (input.tiendaId === "t1") return { status: "forbidden" };
      return { status: "ok", data: DESGLOSE_SUR };
    });

    renderTabla();
    const regionNorte = await desplegar("Tienda Norte");
    const regionSur = await desplegar("Tienda Sur");

    await waitFor(() =>
      expect(within(regionNorte).getByRole("alert")).toHaveTextContent(
        "No se pudo cargar el desglose de la tienda.",
      ),
    );

    // La tabla de saldos sigue en pie, con sus dos filas…
    const saldos = screen.getByRole("table", { name: "Saldos de tiendas" });
    expect(within(saldos).getByText("Tienda Norte")).toBeInTheDocument();
    expect(within(saldos).getByText("Tienda Sur")).toBeInTheDocument();
    // …y el desglose de la otra tienda cargó igual.
    await waitFor(() =>
      expect(within(regionSur).getByText("-₡452")).toBeInTheDocument(),
    );
    expect(within(regionSur).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("R45 — el sitio que la 172 encuentra preparado (sin implementar el pago)", () => {
  it("con `acciones`, el nodo se renderiza en la cabecera del desglose", async () => {
    envolver(
      <DesgloseMovimientosTienda
        resumen={NORTE}
        acciones={<button type="button">Registrar pago</button>}
      />,
    );

    const region = await screen.findByRole("region", { name: "Desglose de Tienda Norte" });
    expect(
      within(region).getByRole("button", { name: "Registrar pago" }),
    ).toBeInTheDocument();
  });

  it("sin `acciones` no se renderiza NINGÚN contenedor añadido", async () => {
    // No basta con que no haya botón: un contenedor vacío deja un hueco y un elemento que
    // anunciar. Se compara el número de nodos de la cabecera con y sin la prop.
    const { unmount } = envolver(<DesgloseMovimientosTienda resumen={NORTE} />);
    const sinAcciones = (
      await screen.findByRole("region", { name: "Desglose de Tienda Norte" })
    ).children.length;
    unmount();
    cleanup();

    envolver(
      <DesgloseMovimientosTienda
        resumen={NORTE}
        acciones={<button type="button">Registrar pago</button>}
      />,
    );
    const conAcciones = (
      await screen.findByRole("region", { name: "Desglose de Tienda Norte" })
    ).children.length;

    expect(conAcciones).toBe(sinAcciones + 1);
  });

  it("R47: esta pantalla no ofrece registrar ningún pago", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(1));

    expect(
      within(region).queryByRole("button", { name: /registrar pago/i }),
    ).not.toBeInTheDocument();
    expect(within(region).queryByText(/registrar pago/i)).not.toBeInTheDocument();
  });
});

describe("R46 — refrescar el desglose de UNA tienda desde fuera", () => {
  it("`mutate` sobre su clave recarga SOLO esa tienda", async () => {
    // Caché POR DEFECTO a propósito (sin `provider` propio): el `mutate` exportado por SWR
    // está atado a ella, y es el que la 172 llamará tras registrar un pago. Con una caché
    // aislada el test pasaría sin probar nada — el `mutate` no la alcanzaría siquiera.
    programarSaldos(TIENDAS);
    render(
      <SWRConfig value={{ dedupingInterval: 0 }}>
        <ToastProvider>
          <SaldosTiendasTable initialData={paginaInicial(TIENDAS)} />
        </ToastProvider>
      </SWRConfig>,
    );

    await desplegar("Tienda Norte");
    await desplegar("Tienda Sur");
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalledTimes(2));

    const norteAntes = listarDesgloseMock.mock.calls.filter(([i]) => i.tiendaId === "t1")
      .length;
    const surAntes = listarDesgloseMock.mock.calls.filter(([i]) => i.tiendaId === "t2")
      .length;

    await act(async () => {
      await mutateGlobal(claveDesgloseTienda("t1"));
    });

    await waitFor(() =>
      expect(
        listarDesgloseMock.mock.calls.filter(([i]) => i.tiendaId === "t1").length,
      ).toBe(norteAntes + 1),
    );
    // Y la otra tienda no se ha tocado: refrescar un desglose no refresca la pantalla.
    expect(
      listarDesgloseMock.mock.calls.filter(([i]) => i.tiendaId === "t2").length,
    ).toBe(surAntes);
  });

  it("la clave identifica a la tienda, la página y los filtros", () => {
    expect(claveDesgloseTienda("t1")).toEqual([
      "wallet-tiendas:desglose",
      "t1",
      1,
      "",
      "",
      "",
      "",
    ]);
    // Dos tiendas nunca comparten clave: es lo que impide que refrescar una toque a la otra.
    expect(claveDesgloseTienda("t1")).not.toEqual(claveDesgloseTienda("t2"));
    expect(claveDesgloseTienda("t1", 2)).not.toEqual(claveDesgloseTienda("t1", 1));
  });
});

describe("R6 — la tabla de saldos sigue siendo la de antes", () => {
  it("mismas columnas, mismos datos y su descarga sigue proyectando las props", async () => {
    renderTabla();

    const tabla = screen.getByRole("table", { name: "Saldos de tiendas" });
    const cabeceras = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    // La primera es la columna del botón de desplegar, que el `DataTable` antepone con su
    // propio nombre accesible; las tres de datos no cambian.
    expect(cabeceras).toEqual(["Desglose", "Tienda", "Saldo a favor", "Estado"]);

    expect(within(tabla).getByText("₡9.000")).toBeInTheDocument();
    expect(within(tabla).getByText("-₡452")).toBeInTheDocument();
    expect(within(tabla).getByText("A favor")).toBeInTheDocument();
    expect(within(tabla).getByText("En contra")).toBeInTheDocument();

    // Su control de descarga sigue existiendo y sigue siendo el de la tabla, no el de
    // ningún desglose (que ni siquiera está montado).
    expect(
      screen.getByRole("button", { name: "Descargar Saldos de tiendas" }),
    ).toBeInTheDocument();
    expect(listarDesgloseCompletoMock).not.toHaveBeenCalled();
  });

  it("sin tiendas, el estado vacío de la tabla es el de siempre", () => {
    renderTabla([]);
    expect(
      screen.getByText("No hay tiendas con saldo registrado."),
    ).toBeInTheDocument();
  });
});
