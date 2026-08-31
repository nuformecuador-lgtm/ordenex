// @vitest-environment jsdom
// Feature 170 (Tanda D) — descarga de las tres tablas de dinero que recibían su dataset ENTERO
// por props: saldos de tiendas, cuentas por pagar a mensajeros y plantillas de gasto fijo.
// Cubre R1, R7, R10, R26, R30 y R32.
//
// Eran FAMILIA B pura. Feature 170 — FASE 2: las tres paginan ya en el servidor (T I.2 las dos
// primeras, T L.2 las cuentas por pagar), así que su archivo NO puede salir del array que la
// tabla pinta —sería «descargar lo que se ve»— y se RELEE del conjunto completo al pulsar el
// control (R52).
//
// Los riesgos que estos tests cierran: (a) que una descarga se quede en la página visible,
// (b) que el archivo deje de respetar el filtro vigente y entregue filas que el usuario no
// está viendo, y (c) que el tope de 5000 deje de aplicarse y se entregue un archivo gigante
// —o peor, uno truncado en silencio—.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { descargaConfig } from "@/lib/config/descarga";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// El desglose por cierre se stubbea: aquí se prueba la TABLA de cuentas por pagar, no la
// expansión (que tiene sus propios tests en `WalletDescarga.test.tsx`).
vi.mock("@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero", () => ({
  DesglosePagosMensajero: () => <div data-testid="desglose-stub" />,
}));

vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  setActivaPlantillaAction: vi.fn(),
  listarPlantillasAction: vi.fn(),
  // Feature 184 — Tanda G (T G.2): la lectura DEDICADA del listado 11, de la que sale el
  // archivo. La relectura de arriba se conserva VIVA y programada: que ya no se llame tiene
  // que ser una decisión de la pantalla, no que el doble no responda.
  listarPlantillasCompletoAction: vi.fn(),
  listarPlantillasPaginadoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarSaldosTiendasAction: vi.fn(),
  // Feature 184 — Tanda G (T G.2): la lectura DEDICADA del listado 12, de la que sale el
  // archivo. La relectura de arriba se conserva VIVA y programada: que ya no se llame tiene
  // que ser una decisión de la pantalla, no que el doble no responda.
  listarSaldosTiendasCompletoAction: vi.fn(),
  listarSaldosTiendasPaginadoAction: vi.fn(),
}));
// Feature 170 — FASE 2 (T L.2): cuentas por pagar pasa a leer su página —y su conjunto para el
// archivo— del servidor.
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarAction: vi.fn(),
  listarCuentasPorPagarPaginadoAction: vi.fn(),
  // Feature 170 — FASE 2 (T M.1, cierre de Q-L2): el conjunto para el archivo lo devuelve YA
  // filtrado el servidor; la pantalla dejo de releer el listado entero y filtrarlo aqui.
  listarCuentasPorPagarCompletoAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

const toastErrorMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: (...a: unknown[]) => toastErrorMock(...a),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import {
  listarSaldosTiendasAction,
  listarSaldosTiendasCompletoAction,
  listarSaldosTiendasPaginadoAction,
} from "@/lib/actions/wallet-tienda";
import {
  listarPlantillasAction,
  listarPlantillasCompletoAction,
  listarPlantillasPaginadoAction,
} from "@/lib/actions/gasto-fijo-plantilla";
import {
  listarCuentasPorPagarCompletoAction,
  listarCuentasPorPagarPaginadoAction,
} from "@/lib/actions/wallet-mensajero";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";
import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";
import { GastosFijosPlantillasPanel } from "@/app/(app)/wallet/_components/GastosFijosPlantillasPanel";

// --- Datos ---------------------------------------------------------------

const TIENDAS: SaldoTiendaResumenDTO[] = [
  { tiendaId: "t1", tiendaNombre: "Tienda Uno", saldo: "1000.10", signo: "positivo" },
  { tiendaId: "t2", tiendaNombre: "Tienda Dos", saldo: "-250.00", signo: "negativo" },
  { tiendaId: "t3", tiendaNombre: "Tienda Tres", saldo: "0.00", signo: "cero" },
];

const MENSAJEROS: CuentaPorPagarResumenDTO[] = [
  {
    mensajeroId: "u1",
    mensajeroNombre: "Ana Mensajera",
    devengado: "5000.00",
    pagado: "3000.00",
    cuentaPorPagar: "2000.00",
    signo: "positivo",
  },
  {
    mensajeroId: "u2",
    mensajeroNombre: "Beto Repartidor",
    devengado: "4000.10",
    pagado: "4000.10",
    cuentaPorPagar: "0.00",
    signo: "cero",
  },
];

function plantillaGasto(i: number, activa = true): GastoFijoPlantillaDTO {
  return {
    id: `g-${i}`,
    concepto: `Alquiler ${i}`,
    monto: `${100 + i}.10`,
    activa,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-01",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
  } as GastoFijoPlantillaDTO;
}

const PLANTILLAS = [plantillaGasto(1), plantillaGasto(2, false)];

/** Instante fijo del panel de gastos fijos (feature 85, R23): 2026-07-15 a las 12:00 de CR. */
const AHORA_ISO = "2026-07-15T18:00:00.000Z";

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/**
 * Quita comentarios de línea y de bloque antes de buscar patrones de CÓDIGO. Sin esto, la
 * guardia estática de más abajo se dispara con una frase de un comentario («no hace fetch
 * (los datos ya llegaron por props)»), que es justo lo contrario de lo que vigila.
 */
function sinComentarios(fuente: string): string {
  return quitarComentarios(fuente);
}

/**
 * Feature 170 — FASE 2 (T I.2): monta la tabla de saldos con su PÁGINA y programa las dos
 * lecturas —la de la página y la del conjunto completo que alimenta la descarga—.
 *
 * Feature 184 — Tanda G (T G.2): el conjunto del archivo sale de la lectura DEDICADA
 * (`listarSaldosTiendasCompletoAction`). La relectura vieja se programa IGUAL, con el mismo
 * conjunto: si el archivo saliera todavía de ella, saldría idéntico —los dos listados
 * devuelven las mismas filas—, así que lo único que separa un camino del otro es contar las
 * llamadas y el TOPE, que ahora decide el servidor.
 */
function montarSaldos(
  visibles: SaldoTiendaResumenDTO[],
  completo: SaldoTiendaResumenDTO[] = visibles,
) {
  vi.mocked(listarSaldosTiendasPaginadoAction).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(visibles, { total: completo.length }),
  });
  vi.mocked(listarSaldosTiendasCompletoAction).mockResolvedValue({
    status: "ok",
    items: completo,
    total: completo.length,
  });
  vi.mocked(listarSaldosTiendasAction).mockResolvedValue({
    status: "ok",
    tiendas: completo,
  });
  return envolver(
    <SaldosTiendasTable
      initialData={paginaInicial(visibles, { total: completo.length })}
    />,
  );
}

/** Espejo del anterior para el panel de plantillas de gasto fijo. */
function montarPlantillas(
  visibles: GastoFijoPlantillaDTO[],
  completo: GastoFijoPlantillaDTO[] = visibles,
) {
  vi.mocked(listarPlantillasPaginadoAction).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(visibles, { total: completo.length }),
  });
  vi.mocked(listarPlantillasCompletoAction).mockResolvedValue({
    status: "ok",
    items: completo,
    total: completo.length,
  });
  vi.mocked(listarPlantillasAction).mockResolvedValue({
    status: "ok",
    plantillas: completo,
  });
  return envolver(
    <GastosFijosPlantillasPanel
      initialData={paginaInicial(visibles, { total: completo.length })}
      // Feature 85 (T F.6, R23): el instante del «Próximo cobro» es una prop REQUERIDA y se
      // resuelve en el servidor. Aquí se fija a un día conocido para que este archivo —que
      // mide de dónde salen las filas del archivo, no qué fecha llevan— no dependa del
      // calendario del día en que se ejecute.
      ahoraIso={AHORA_ISO}
    />,
  );
}

/**
 * Feature 170 — FASE 2 (T L.2): espejo de los dos anteriores para las cuentas por pagar. La
 * búsqueda por nombre la resuelve el SERVIDOR, así que el doble de la página filtra de verdad
 * y el del conjunto entrega las N filas de las que sale el archivo.
 */
function montarCuentas(
  visibles: CuentaPorPagarResumenDTO[],
  completo: CuentaPorPagarResumenDTO[] = visibles,
) {
  vi.mocked(listarCuentasPorPagarPaginadoAction).mockImplementation(
    async (input: unknown) => {
      const q = ((input as { busqueda?: string })?.busqueda ?? "").trim().toLowerCase();
      const filtrados =
        q === ""
          ? visibles
          : completo.filter((m) => m.mensajeroNombre.toLowerCase().includes(q));
      return {
        status: "ok",
        page: 1,
        ...paginaInicial(filtrados, { total: q === "" ? completo.length : filtrados.length }),
      };
    },
  );
  // T M.1 (Q-L2): el archivo sale de una accion PROPIA que aplica la busqueda en el servidor.
  vi.mocked(listarCuentasPorPagarCompletoAction).mockImplementation(async (input: unknown) => {
    const q = ((input as { busqueda?: string })?.busqueda ?? "").trim().toLowerCase();
    const items =
      q === "" ? completo : completo.filter((m) => m.mensajeroNombre.toLowerCase().includes(q));
    return { status: "ok", items, total: items.length };
  });
  return envolver(
    <CuentasPorPagarTable
      initialData={paginaInicial(visibles, { total: completo.length })}
    />,
  );
}

/** Las tres tablas: cómo se montan, cómo se llama su control y qué debe traer el archivo. */
const TABLAS = [
  {
    titulo: "Saldos de tiendas",
    montar: () => montarSaldos(TIENDAS),
    filas: TIENDAS.length,
    // Money-safe: el saldo llega TAL CUAL, con céntimos y sin el símbolo de colón.
    clave: "saldo",
    valor: TIENDAS[0].saldo,
  },
  {
    titulo: "Cuentas por pagar a mensajeros",
    montar: () => montarCuentas(MENSAJEROS),
    filas: MENSAJEROS.length,
    clave: "cuentaPorPagar",
    valor: MENSAJEROS[0].cuentaPorPagar,
  },
  {
    titulo: "Plantillas de gasto fijo",
    montar: () => montarPlantillas(PLANTILLAS),
    filas: PLANTILLAS.length,
    clave: "monto",
    valor: PLANTILLAS[0].monto,
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Dinero por props · descarga", () => {
  it("las tres ofrecen su control y el archivo trae lo que la tabla pinta", async () => {
    // R1: control con nombre accesible propio; el archivo, una fila por fila visible y en
    // el mismo orden. Sin paginación de por medio no hay diferencia posible entre lo que se
    // ve y lo que se descarga, y este test lo fija.
    for (const tabla of TABLAS) {
      const user = userEvent.setup();
      tabla.montar();

      const boton = screen.getByRole("button", { name: `Descargar ${tabla.titulo}` });
      expect(boton).toBeInTheDocument();

      await user.click(boton);
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const [, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
      expect(filas, `${tabla.titulo}: filas del archivo`).toHaveLength(tabla.filas);
      expect(titulo).toBe(tabla.titulo);

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("los montos viajan TAL CUAL, sin recalcularlos ni adornarlos", async () => {
    // R7 money-safe. Un `Number` intermedio convertiría "1000.10" en "1000.1": los céntimos.
    // Y el símbolo de colón de `money` rompería la celda como número en la hoja.
    for (const tabla of TABLAS) {
      const user = userEvent.setup();
      tabla.montar();

      await user.click(screen.getByRole("button", { name: `Descargar ${tabla.titulo}` }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const [, filas] = buildXlsxRowsMock.mock.calls[0];
      expect(filas[0][tabla.clave], `${tabla.titulo}: ${tabla.clave}`).toBe(tabla.valor);
      expect(String(filas[0][tabla.clave])).not.toContain("₡");

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("cuentas por pagar exporta solo lo que la búsqueda deja a la vista", async () => {
    // R10 + R52. El filtro de esta tabla era de CLIENTE y desde T L.2 lo resuelve el
    // SERVIDOR; lo que el archivo tiene que traer no cambia: exactamente el conjunto que la
    // búsqueda deja a la vista, ni una fila más. Descargar el conjunto SIN filtrar sería
    // entregar datos que el usuario no está viendo, y descargar la página sería entregar
    // menos de los que sí está viendo.
    const user = userEvent.setup();
    montarCuentas(MENSAJEROS);

    await user.type(screen.getByRole("searchbox"), "Beto");

    const tabla = screen.getByRole("table", { name: "Cuentas por pagar a mensajeros" });
    // Anclar SOLO al número de filas era ambiguo, y es el tercer mecanismo del flake de jsdom
    // (`progress/chore_flake_jsdom.md` §6): con la búsqueda resuelta en el servidor, durante la
    // carga la tabla tiene header + la fila `role="status"` = 2, el MISMO número que el estado
    // ya asentado (header + Beto). El ancla es positiva —Beto pintado—, con la ausencia de Ana
    // (que `initialData` sí traía, así que «está Beto» es cierto ANTES de filtrar) y sin carga
    // en vuelo.
    await waitFor(() => {
      expect(within(tabla).getByText("Beto Repartidor")).toBeInTheDocument();
      expect(within(tabla).queryByText("Ana Mensajera")).not.toBeInTheDocument();
      expect(within(tabla).queryByRole("status")).not.toBeInTheDocument();
    });
    expect(within(tabla).getAllByRole("row")).toHaveLength(1 + 1);

    await user.click(
      screen.getByRole("button", { name: "Descargar Cuentas por pagar a mensajeros" }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(1);
    expect(filas[0].mensajero).toBe("Beto Repartidor");
  });

  it("las tres paginan y NINGUNA proyecta la página: releen el conjunto completo", () => {
    // R52, de forma ESTÁTICA sobre los módulos, que es donde vive la propiedad. Donde la
    // FASE 1 exigía `filasLocales(loQueSePinta)` —correcto mientras el array de props ERA el
    // dataset—, ahora se PROHÍBE: esa misma llamada, con la tabla paginada, es literalmente
    // «descargar lo que se ve», y sale un archivo de 25 filas de 300 sin fallar en ninguna
    // parte. Se exige a cambio el adaptador que relee.
    //
    // Feature 170 — FASE 2 (T L.2): las cuentas por pagar entran aquí y desaparece el caso
    // «la que NO pagina no relee» —ya no queda ninguna de las tres sin paginar—. Las tablas
    // de Familia B pura que siguen sin paginar (ranking, gestiones del cierre) no son de
    // este archivo y conservan sus propios tests.
    //
    // Feature 170 — FASE 2 (T M.1, cierre de Q-L2): las tres siguen sin proyectar la página,
    // pero ya no lo hacen todas igual. «Cuentas por pagar» estrena un `listarCompleto` propio y
    // usa el adaptador de FAMILIA A (`filasDesdeResultado`), que además trae el tope desde el
    // servidor; las otras dos siguen releyendo su listado sin recorte con
    // `filasDelConjuntoCompleto`, que es la deuda que Q-I5 dejó abierta. Lo que se exige aquí es
    // la propiedad —el archivo NO sale del array de la página— y cada tabla declara con cuál de
    // los dos adaptadores la cumple, para que ese reparto no cambie sin que nadie lo note.
    //
    // Feature 184 (T G.2/T G.3): las TRES declaran ya `completo`. Es el estado final de este
    // censo —la deuda de Q-I5 queda cerrada para los tres módulos de wallet— y el campo no se
    // borra: mientras exista `filasDelConjuntoCompleto`, la mitad NEGATIVA de abajo es lo que
    // impide que una de las tres vuelva a él sin que nadie lo note.
    //
    // Feature 184 (T H.2): el adaptador se RETIRÓ, y la mitad negativa se conserva igual —misma
    // decisión y mismo motivo que en `paginacion-transversal.test.tsx`—. Sin el export, la media
    // migración que MG3/MG11 midieron deja de ser posible por construcción; lo que esta mitad
    // sigue vigilando es que nadie lo rescate del historial y cablee AQUÍ uno de los tres. Que
    // el export no vuelva lo afirma `tests/unit/descarga/adaptador-conjunto.guardia.test.ts`.
    //
    // Feature 184 (T0.2): cada módulo declara su adaptador por NOMBRE y se comprueba la mitad
    // NEGATIVA además de la positiva —el declarado es el ÚNICO que usa—. Sin ella, una pantalla
    // que llamara a los dos (una migración a medias) pasaría verde con cualquiera de las dos
    // declaraciones, que es justo lo que este censo existe para impedir.
    const raiz = path.resolve(__dirname, "../../..");
    const ADAPTADOR = {
      conjunto: /filasDelConjuntoCompleto\(/,
      completo: /filasDesdeResultado\(/,
    } as const;
    const CONTRARIO = { conjunto: "completo", completo: "conjunto" } as const;
    const modulos: { ruta: string; adaptador: keyof typeof ADAPTADOR; nota: string }[] = [
      {
        ruta: "app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx",
        adaptador: "completo",
        nota: "T G.2: listarSaldosTiendasCompleto, con el tope en el servidor y el MISMO orden que la tabla",
      },
      {
        ruta: "app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx",
        adaptador: "completo",
        nota: "T G.2: listarPlantillasCompleto, con el tope en el servidor",
      },
      {
        ruta: "app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx",
        adaptador: "completo",
        nota: "T M.1: listarCuentasPorPagarCompleto, con la búsqueda y el tope en el servidor",
      },
    ];

    for (const { ruta, adaptador, nota } of modulos) {
      const fuente = sinComentarios(readFileSync(path.join(raiz, ruta), "utf8"));
      expect(fuente, `${ruta}: ${nota}`).toMatch(ADAPTADOR[adaptador]);
      expect(
        fuente,
        `${ruta}: se declara «${adaptador}» pero también llama al adaptador «${CONTRARIO[adaptador]}»`,
      ).not.toMatch(ADAPTADOR[CONTRARIO[adaptador]]);
      expect(fuente, `${ruta}: no puede proyectar el array visible`).not.toMatch(
        /filasLocales\(/,
      );
      // Y pagina de verdad: control de navegación + página pedida al servidor.
      expect(fuente, `${ruta}: sin control de paginación`).toMatch(/<Pagination[\s/>]/);
      expect(fuente, `${ruta}: sin lectura de la página`).toMatch(/\buseSWR\b/);
    }
  });

  it("por encima del tope rechaza con un error accionable y NO produce archivo", async () => {
    // R26/R28: por encima del tope la salida es un mensaje con total y tope —y ningún xlsx—:
    // un archivo al que le faltan filas sin avisar es peor que no poder descargarlo.
    //
    // Feature 184 — Tanda G (T G.2, R6): quién decide eso CAMBIA, y es lo único que esta
    // tanda gana de verdad en estos dos listados —en consultas no ahorran nada, medido—.
    // Antes: el servidor mandaba las 5001 filas, cruzaban al navegador y `filasLocales` las
    // contaba y las tiraba allí. Ahora el servidor responde `limite_excedido` con SOLO
    // conteos y NI UNA fila, y por eso el doble de aquí ni siquiera puede entregar el
    // conjunto: si la pantalla siguiera usando el adaptador que relee, no sabría leer esta
    // respuesta —`limite_excedido` no es un `ActionError`— y el mensaje saldría sin el total
    // ni el tope, que es justo lo que hace accionable al aviso.
    const user = userEvent.setup();
    const total = descargaConfig.MAX_FILAS + 1;

    // La página visible es pequeña y real; el CONJUNTO nunca llega. Es el caso de verdad:
    // nadie ve 5001 filas, pero sí puede pedirlas en un archivo.
    montarSaldos(TIENDAS);
    vi.mocked(listarSaldosTiendasCompletoAction).mockResolvedValue({
      status: "limite_excedido",
      total,
      limite: descargaConfig.MAX_FILAS,
    });

    await user.click(screen.getByRole("button", { name: "Descargar Saldos de tiendas" }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    const mensaje = String(toastErrorMock.mock.calls[0][0]);
    expect(mensaje).toContain(String(total));
    expect(mensaje).toContain(String(descargaConfig.MAX_FILAS));
    expect(mensaje).toMatch(/acota los filtros/i);
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
    // Y el conjunto NO cruzó: la respuesta del servidor son dos números. La relectura vieja
    // tampoco se pidió por detrás —eso serían las 5001 filas viajando igual—.
    expect(listarSaldosTiendasAction).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Feature 184 — Tanda G (T G.2): «Saldos de tiendas» (listado 12)
  // -------------------------------------------------------------------------

  it("el archivo de los saldos sale de su lectura DEDICADA, no de releer el listado (R1/R8)", async () => {
    // Las tres mitades, como en las tandas B–F:
    //
    //   (a) montar la pantalla NO ejecuta la lectura del conjunto (R8);
    //   (b) al pulsar se llama a `listarSaldosTiendasCompletoAction` UNA vez y SIN un solo
    //       argumento: este listado no tiene filtros, así que ni `page`, ni `pageSize`, ni
    //       `tiendaId` —la única cuya aceptación convertiría el saldo de TODAS las tiendas en
    //       el de una elegida por quien pide— pueden viajar (R3/R4/R17);
    //   (c) y NO se relee `listarSaldosTiendasAction`.
    //
    // Aquí (c) NO es «ya no arrastra la otra mitad» —este listado no es compuesto y las dos
    // lecturas devuelven las mismas filas—, y por eso el xlsx no distingue un camino del
    // otro: ni una celda cambia. Lo que se gana está medido y es otra cosa (el tope, arriba,
    // y el ORDEN del archivo, que el servidor fija en `saldos-tiendas-completo.test.ts`), así
    // que este `expect` es lo único que impide que la relectura vuelva sin que nada falle.
    const user = userEvent.setup();
    montarSaldos(TIENDAS);

    expect(listarSaldosTiendasCompletoAction).not.toHaveBeenCalled();
    expect(listarSaldosTiendasAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Descargar Saldos de tiendas" }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarSaldosTiendasCompletoAction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listarSaldosTiendasCompletoAction).mock.calls[0]).toEqual([]);
    expect(listarSaldosTiendasAction).not.toHaveBeenCalled();

    // ANTI-VACUIDAD, en dos pasos, porque «cero llamadas» pasa igual con un doble muerto o
    // con una descarga que nunca ocurrió:
    //  1. la descarga SÍ ocurrió y produjo sus filas;
    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(TIENDAS.length);
    //  2. y el doble de la relectura está VIVO y responde con el conjunto entero. No llamarlo
    //     es una decisión de la pantalla, no del arnés.
    const relectura = await listarSaldosTiendasAction();
    expect(relectura.status === "ok" && relectura.tiendas).toHaveLength(TIENDAS.length);
  });

  it("la pantalla NO recorta ni reordena los saldos que devolvió el servidor (R2)", async () => {
    // El discriminador entre «el servidor entrega el conjunto» y «lo entrega Y la pantalla lo
    // vuelve a tocar», con los dos números separados a propósito:
    //
    //   · el doble devuelve TREINTA filas y la tabla pinta TRES, así que un archivo de 25 —el
    //     `pageSize` de este dominio— o de 3 se distingue del bueno (recorte). Con el fixture
    //     de tres filas a secas, recortar a la página entera no se vería: la página SERÍA el
    //     conjunto;
    //   · y las tres primeras van en un orden que NINGÚN orden de cliente reproduce, EN EL
    //     CAMPO POR EL QUE EL SERVIDOR ORDENA y que la fila de descarga proyecta
    //     (`tiendaNombre` → `tienda`). Con el nombre idéntico en las treinta filas, un `sort`
    //     estable no movería nada y la mutación sobreviviría por un defecto del fixture, no
    //     del código — es exactamente lo que la tanda G de backend midió con su M9.
    const user = userEvent.setup();
    montarSaldos(TIENDAS);

    const conNombre = (i: number, nombre: string): SaldoTiendaResumenDTO => ({
      tiendaId: `t-${i}`,
      tiendaNombre: nombre,
      saldo: "10.00",
      signo: "positivo",
    });
    const relleno = Array.from({ length: 27 }, (_, i) => conNombre(100 + i, "Tienda Norte"));
    vi.mocked(listarSaldosTiendasCompletoAction).mockResolvedValue({
      status: "ok",
      items: [
        conNombre(1, "Tienda Media"),
        conNombre(2, "Tienda Zeta"),
        conNombre(3, "Tienda Alfa"),
        ...relleno,
      ],
      total: 30,
    });

    await user.click(screen.getByRole("button", { name: "Descargar Saldos de tiendas" }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas, "el archivo trae la página, no el conjunto").toHaveLength(30);
    // Ascendente sería [Alfa, Media, Norte]; descendente, [Zeta, Norte, Norte].
    expect(filas.slice(0, 3).map((f) => f.tienda)).toEqual([
      "Tienda Media",
      "Tienda Zeta",
      "Tienda Alfa",
    ]);
  });

  it("un fallo de la lectura de los saldos no produce archivo y el mensaje no lleva cifras de nadie (R7)", async () => {
    const user = userEvent.setup();
    montarSaldos(TIENDAS);
    vi.mocked(listarSaldosTiendasCompletoAction).mockResolvedValue({ status: "forbidden" });

    await user.click(screen.getByRole("button", { name: "Descargar Saldos de tiendas" }));
    // Ancla POSITIVA: el aviso que SALE, no el archivo que no sale.
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));

    const mensaje = String(toastErrorMock.mock.calls[0][0]);
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    // Accionable, y sin un solo dato del dominio: cada fila de esta tabla dice qué tienda es
    // y cuánto dinero se le debe (o debe), y el identificador interno no sale nunca.
    for (const dato of [TIENDAS[0].tiendaNombre, TIENDAS[0].saldo, TIENDAS[0].tiendaId]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Feature 184 — Tanda G (T G.2): «Plantillas de gasto fijo» (listado 11)
  // -------------------------------------------------------------------------

  it("el tope de las plantillas también lo decide el servidor (R6)", async () => {
    // El gemelo del caso del tope de los saldos, sobre el listado 11. Aquí el aviso no se
    // disparará jamás en producción —son un puñado de plantillas de configuración— y aun así
    // el caso existe: lo que fija no es el volumen, es DÓNDE se decide. Sin él, este listado
    // podría quedarse con el tope de cliente y el censo seguiría diciendo `completo`.
    const user = userEvent.setup();
    const total = descargaConfig.MAX_FILAS + 1;

    montarPlantillas(PLANTILLAS);
    vi.mocked(listarPlantillasCompletoAction).mockResolvedValue({
      status: "limite_excedido",
      total,
      limite: descargaConfig.MAX_FILAS,
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Plantillas de gasto fijo" }),
    );

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    const mensaje = String(toastErrorMock.mock.calls[0][0]);
    expect(mensaje).toContain(String(total));
    expect(mensaje).toContain(String(descargaConfig.MAX_FILAS));
    expect(mensaje).toMatch(/acota los filtros/i);
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(listarPlantillasAction).not.toHaveBeenCalled();
  });

  it("el archivo de las plantillas sale de su lectura DEDICADA, no de releer el listado (R1/R8)", async () => {
    // Espejo exacto del caso de los saldos, sobre el otro listado de la tanda.
    const user = userEvent.setup();
    montarPlantillas(PLANTILLAS);

    expect(listarPlantillasCompletoAction).not.toHaveBeenCalled();
    expect(listarPlantillasAction).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Descargar Plantillas de gasto fijo" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarPlantillasCompletoAction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listarPlantillasCompletoAction).mock.calls[0]).toEqual([]);
    expect(listarPlantillasAction).not.toHaveBeenCalled();

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(PLANTILLAS.length);
    const relectura = await listarPlantillasAction();
    expect(relectura.status === "ok" && relectura.plantillas).toHaveLength(PLANTILLAS.length);
  });

  it("la pantalla NO recorta ni reordena las plantillas que devolvió el servidor (R2)", async () => {
    // Mismo discriminador que en los saldos. El campo del fixture es `concepto` —el que la
    // fila de descarga proyecta— y los montos se mueven en un orden DISTINTO al de los
    // conceptos, para que reordenar por la otra columna de datos tampoco reproduzca la
    // secuencia esperada.
    const user = userEvent.setup();
    montarPlantillas(PLANTILLAS);

    const conConcepto = (i: number, concepto: string, monto: string): GastoFijoPlantillaDTO =>
      ({ ...plantillaGasto(i), concepto, monto }) as GastoFijoPlantillaDTO;
    const relleno = Array.from({ length: 27 }, (_, i) =>
      conConcepto(100 + i, "Luz", "150.00"),
    );
    vi.mocked(listarPlantillasCompletoAction).mockResolvedValue({
      status: "ok",
      items: [
        conConcepto(1, "Mantenimiento", "300.00"),
        conConcepto(2, "Zeta seguros", "100.00"),
        conConcepto(3, "Agua", "200.00"),
        ...relleno,
      ],
      total: 30,
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Plantillas de gasto fijo" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas, "el archivo trae la página, no el conjunto").toHaveLength(30);
    // Por concepto, ascendente sería [Agua, Luz, Luz] y descendente [Zeta, Mantenimiento, Luz];
    // por monto, [Zeta, Luz, Luz] y [Mantenimiento, Agua, Luz].
    expect(filas.slice(0, 3).map((f) => f.concepto)).toEqual([
      "Mantenimiento",
      "Zeta seguros",
      "Agua",
    ]);
  });

  it("un fallo de la lectura de las plantillas no produce archivo y el mensaje no lleva datos del listado (R7)", async () => {
    const user = userEvent.setup();
    montarPlantillas(PLANTILLAS);
    vi.mocked(listarPlantillasCompletoAction).mockResolvedValue({ status: "forbidden" });

    await user.click(
      screen.getByRole("button", { name: "Descargar Plantillas de gasto fijo" }),
    );
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));

    const mensaje = String(toastErrorMock.mock.calls[0][0]);
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    for (const dato of [PLANTILLAS[0].concepto, PLANTILLAS[0].monto, PLANTILLAS[0].id]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });
});
