// @vitest-environment jsdom
// Feature 170 (T G.1) — CONSISTENCIA TRANSVERSAL del control de descarga. Cubre R33, R34,
// R35, R37 y R38.
//
// Los tests de cada tanda contestan «¿esta tabla descarga LO SUYO?». Éste contesta otra
// pregunta, que ninguno de ellos cubre: **¿las 25 se comportan IGUAL?**. Tras un rollout de
// seis tandas, escritas por manos distintas en días distintos, la deriva plausible no es que
// una tabla no descargue —eso lo caza la guardia del censo—, sino que una descargue
// DIFERENTE: que ofrezca un menú de formato, que se pueda disparar dos veces a la vez, que
// mueva la página al descargar o que se arme el archivo por su cuenta.
//
// La verificación va en dos planos deliberadamente distintos:
//
//  (a) CONDUCTA, sobre las TRES formas de cableado que existen en el rollout —Familia A con
//      filtros, Familia A sin filtros y Familia B con filtro de cliente—, montando
//      componentes reales de producción. Una por forma: si las tres coinciden, la propiedad
//      es del control compartido y no de una pantalla.
//  (b) BARRIDO ESTÁTICO sobre TODO el árbol, que es lo que extiende esas cinco propiedades
//      de 3 tablas a las 25 (y a las que vengan): ningún módulo declara formatos, ninguno
//      importa un generador de binario, ninguno arma un `DescargaFilasResult` a mano y
//      ninguno esquiva el tope compartido.
//
// El plano (b) importa tanto como el (a): un test de conducta solo puede cubrir lo que monta.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";
import { usuariosConfig } from "@/lib/config/usuarios";
import { ordenesConfig } from "@/lib/config/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

const listarOrdenesMock = vi.fn();
const listarOrdenesCompletoMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
  listarOrdenesCompleto: (...a: unknown[]) => listarOrdenesCompletoMock(...a),
}));

const listarUsuariosMock = vi.fn();
const listarUsuariosCompletoMock = vi.fn();
vi.mock("@/lib/actions/usuarios", () => ({
  listarUsuarios: (...a: unknown[]) => listarUsuariosMock(...a),
  listarUsuariosCompleto: (...a: unknown[]) => listarUsuariosCompletoMock(...a),
  obtenerUsuario: vi.fn(),
  cambiarEstadoUsuario: vi.fn(),
}));

// El desglose expandible de cuentas por pagar tiene su propio fetch y sus propios tests; lo
// que aquí se juzga es la tabla que lo contiene.
vi.mock("@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero", () => ({
  DesglosePagosMensajero: () => <div data-testid="desglose-stub" />,
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// Se aísla SOLO el codificador binario (exceljs). `construirDescarga` —la función común de
// R33— corre REAL, así que el MIME, el nombre del archivo y el recorrido de columnas son los
// de producción. Y como es el ÚNICO codificador, que el buffer que devuelve llegue tal cual
// a `descargarBlob` demuestra por dónde pasó el contenido.
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { OrdenesModule } from "@/app/(app)/ordenes/_components/OrdenesModule";
import { UsuariosModule } from "@/app/(app)/configuracion/_components/UsuariosModule";
import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";

// --- Datos ---------------------------------------------------------------

const ESTATUS_ID = "est-en-bodega-central";

function orden(i: number): OrdenListItemDTO {
  return {
    id: `orden-${i}`,
    numGuia: 900 + i,
    numRemision: `REM-${String(i).padStart(3, "0")}`,
    estatusId: ESTATUS_ID,
    estatusValue: "en_bodega_central",
    destinatario: `Destinatario ${i}`,
    telefonoDest: "0999999999",
    tiendaId: "t1",
    tiendaNombre: "Tienda Uno",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: "d1",
    producto: `Producto ${i}`,
    peso: 1.5,
    notas: null,
    direccion: `Calle ${i}`,
    montoCobrar: 500 + i,
    intentosEntrega: 0,
    createdAt: new Date("2026-07-15T20:00:00Z"),
    updatedAt: new Date("2026-07-16T10:00:00Z"),
  } as OrdenListItemDTO;
}

function usuario(i: number): UsuarioListItemDTO {
  return {
    id: `u-${i}`,
    nombre: `Usuario ${i}`,
    email: `usuario${i}@ordenex.test`,
    rolValue: "mensajero",
    estado: "activo",
    createdAt: new Date("2026-07-01T10:00:00Z"),
  } as UsuarioListItemDTO;
}

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

const ORDENES_PAGINA = [orden(1), orden(2)];
const ORDENES_TODAS = Array.from({ length: 6 }, (_, i) => orden(i + 1));
const USUARIOS_PAGINA = [usuario(1), usuario(2)];
const USUARIOS_TODOS = Array.from({ length: 5 }, (_, i) => usuario(i + 1));

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/**
 * Las TRES formas de cableado del rollout, cada una con un componente REAL de producción.
 *
 * - `preparar` deja la pantalla en un estado NO trivial (página 2, búsqueda aplicada…) para
 *   que R37 tenga algo que estropear: si la pantalla estuviera en su estado inicial, «no
 *   alterar la página ni la selección» no afirmaría nada.
 * - `filasEsperadas` es el nº de filas del ARCHIVO, que en Familia A no coincide con lo que
 *   la tabla pinta — y ése es justo el punto.
 */
const FORMAS = [
  {
    // El representante de esta forma era `OrdenesApartado` («Apartado de órdenes por
    // estado»), borrado el 2026-07-31 con la vista legacy que era su único consumidor.
    // Se sustituye por `OrdenesModule` —el listado principal de `/ordenes`, que SÍ está
    // montado— porque es la misma forma de cableado: recorte server-side con `filter`
    // vigente, paginación propia y `obtenerFilas` contra `listarOrdenesCompleto`. La
    // propiedad que este archivo juzga es del control compartido, así que el
    // representante puede cambiar mientras la forma siga existiendo; lo que no puede es
    // desaparecer, o «las tres formas se comportan igual» pasaría a afirmar solo dos.
    forma: "Familia A con filtros",
    titulo: "Órdenes",
    montar: () =>
      envolver(<OrdenesModule filter={{ status_id: ESTATUS_ID }} permitirDescarga />),
    preparar: async (user: ReturnType<typeof userEvent.setup>) => {
      await screen.findByText("Destinatario 1");
      await user.click(screen.getByRole("button", { name: "Página siguiente" }));
      await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(2));
    },
    filasEsperadas: ORDENES_TODAS.length,
  },
  {
    forma: "Familia A sin filtros",
    titulo: "Usuarios",
    montar: () =>
      envolver(
        <UsuariosModule
          initialData={{
            items: USUARIOS_PAGINA,
            total: 42,
            pageSize: usuariosConfig.DEFAULT_PAGE_SIZE,
          }}
        />,
      ),
    preparar: async () => {
      await screen.findByText("Usuario 1");
    },
    filasEsperadas: USUARIOS_TODOS.length,
  },
  {
    forma: "Familia B con filtro de cliente",
    titulo: "Cuentas por pagar a mensajeros",
    montar: () => envolver(<CuentasPorPagarTable mensajeros={MENSAJEROS} />),
    preparar: async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByRole("searchbox"), "Beto");
      const tabla = screen.getByRole("table", {
        name: "Cuentas por pagar a mensajeros",
      });
      await waitFor(() => expect(within(tabla).getAllByRole("row")).toHaveLength(2));
    },
    filasEsperadas: 1,
  },
] as const;

/** Estado VISIBLE de la pantalla: lo que R37 promete no tocar. */
function fotoDeLaPantalla(titulo: string) {
  const tabla = screen.getByRole("table", { name: titulo });
  const busqueda = screen.queryByRole("searchbox") as HTMLInputElement | null;
  return {
    tabla: tabla.textContent,
    filas: within(tabla).getAllByRole("row").length,
    busqueda: busqueda?.value ?? null,
    // El indicador de página, cuando la pantalla lo tiene.
    paginacion: screen.queryByRole("navigation")?.textContent ?? null,
  };
}

// --- Barrido estático ------------------------------------------------------

const RAIZ = path.resolve(__dirname, "../../..");

function listarArchivos(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarArchivos(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/** Quita comentarios para que una FRASE no dispare —ni silencie— un patrón de código. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Todos los módulos de `app/`, con su fuente sin comentarios. */
const MODULOS_APP: Array<{ ruta: string; fuente: string }> = listarArchivos(
  path.join(RAIZ, "app"),
)
  .map((archivo) => ({
    ruta: rutaRelativa(archivo),
    fuente: sinComentarios(readFileSync(archivo, "utf8")),
  }))
  .sort((a, b) => a.ruta.localeCompare(b.ruta));

/** Los que declaran la prop `descarga` de un `DataTable`: el cableado de cada tabla. */
const MODULOS_CON_DESCARGA = MODULOS_APP.filter((modulo) =>
  /\bdescarga=\{/.test(modulo.fuente),
);

/**
 * Los que BAJAN el callback a una tabla de presentación (`WalletLedger`,
 * `DesgloseTiendaLedger`, `DesglosePagos`): esas tres no conocen sus filtros, así que su
 * `obtenerFilas` llega por prop desde el módulo padre. Son el único punto del rollout donde
 * el adaptador común NO está en el mismo archivo que la tabla, y por eso se vigilan aparte.
 */
const MODULOS_PROVEEDORES = MODULOS_APP.filter((modulo) =>
  /obtenerFilasDescarga=\{/.test(modulo.fuente),
);

beforeEach(() => {
  vi.clearAllMocks();
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: ORDENES_PAGINA,
    page: 1,
    pageSize: ordenesConfig.DEFAULT_PAGE_SIZE,
    total: 42,
  });
  listarOrdenesCompletoMock.mockResolvedValue({
    status: "ok",
    items: ORDENES_TODAS,
    total: ORDENES_TODAS.length,
  });
  listarUsuariosMock.mockResolvedValue({
    status: "ok",
    items: USUARIOS_PAGINA,
    page: 1,
    pageSize: usuariosConfig.DEFAULT_PAGE_SIZE,
    total: 42,
  });
  listarUsuariosCompletoMock.mockResolvedValue({
    status: "ok",
    items: USUARIOS_TODOS,
    total: USUARIOS_TODOS.length,
  });
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Control de descarga · consistencia transversal", () => {
  it("las tres formas generan xlsx y ninguna ofrece elección de formato", async () => {
    // R34. `formatos` es opt-in en el contrato de la 151: con más de uno, el control abre un
    // menú. La decisión del humano (P7) es que NADIE lo declare, así que no basta con que
    // hoy no haya menú: hace falta que el archivo sea xlsx y que el disparador no anuncie
    // menú alguno (`aria-haspopup`), en las tres formas.
    for (const caso of FORMAS) {
      const user = userEvent.setup();
      caso.montar();
      await caso.preparar(user);

      const boton = screen.getByRole("button", { name: `Descargar ${caso.titulo}` });
      expect(boton, `${caso.forma}: el control anuncia un menú`).not.toHaveAttribute(
        "aria-haspopup",
      );

      await user.click(boton);
      await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

      // Pulsar descarga DIRECTO: no aparece ningún menú intermedio que elegir.
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      const [, mime, nombreArchivo] = descargarBlobMock.mock.calls[0];
      expect(mime, caso.forma).toBe(XLSX_MIME);
      expect(nombreArchivo, caso.forma).toMatch(/\.xlsx$/);

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("el contenido lo produce la función común, no cada listado", async () => {
    // R33. El único codificador del árbol está mockeado; que el buffer EXACTO que devuelve
    // llegue a `descargarBlob` demuestra el recorrido completo
    // `obtenerFilas -> construirDescarga -> buildXlsxRows -> descargarBlob`, sin ninguna
    // rama propia por el camino. Se usa un buffer distinto por caso para que la identidad
    // no pueda coincidir por casualidad entre iteraciones.
    for (const [indice, caso] of FORMAS.entries()) {
      const user = userEvent.setup();
      const binario = new ArrayBuffer(16 + indice);
      buildXlsxRowsMock.mockResolvedValue(binario);
      caso.montar();
      await caso.preparar(user);

      await user.click(screen.getByRole("button", { name: `Descargar ${caso.titulo}` }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

      // El generador recibe las columnas declaradas y las filas del dataset (no de la
      // página), y el nombre de la hoja es el título del listado.
      const [columnas, filas, hoja] = buildXlsxRowsMock.mock.calls[0];
      expect(columnas.length, caso.forma).toBeGreaterThan(0);
      expect(filas, caso.forma).toHaveLength(caso.filasEsperadas);
      expect(hoja, caso.forma).toBe(caso.titulo);

      const [contenido] = descargarBlobMock.mock.calls[0];
      expect(contenido, `${caso.forma}: el archivo no salió de la función común`).toBe(
        binario,
      );

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("mientras descarga, el control lo indica y no admite una segunda ejecución", async () => {
    // R35. El punto de espera se pone en el CODIFICADOR y no en la acción, para que valga
    // igual en Familia A (que espera al servidor) y en Familia B (que resuelve en memoria y
    // sería, si no, imposible de pillar «en vuelo»).
    for (const caso of FORMAS) {
      const user = userEvent.setup();
      let resolver: (b: ArrayBuffer) => void = () => {};
      buildXlsxRowsMock.mockImplementation(
        () =>
          new Promise<ArrayBuffer>((resolve) => {
            resolver = resolve;
          }),
      );

      caso.montar();
      await caso.preparar(user);
      const boton = screen.getByRole("button", { name: `Descargar ${caso.titulo}` });

      await user.click(boton);
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      // En curso: el control lo dice (aria-busy) y está deshabilitado.
      expect(boton, `${caso.forma}: sin estado de carga`).toHaveAttribute(
        "aria-busy",
        "true",
      );
      expect(boton).toBeDisabled();

      // Segundo intento mientras la primera está en vuelo: no arranca otra.
      await user.click(boton);
      expect(buildXlsxRowsMock, `${caso.forma}: reentrada`).toHaveBeenCalledTimes(1);
      expect(descargarBlobMock).not.toHaveBeenCalled();

      resolver(new ArrayBuffer(8));
      await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
      // Terminada, el control vuelve a estar disponible.
      await waitFor(() => expect(boton).not.toBeDisabled());
      expect(boton).not.toHaveAttribute("aria-busy");

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("descargar no altera la página, la búsqueda ni las filas visibles", async () => {
    // R37. Cada forma llega a la descarga en un estado NO inicial (página 2, búsqueda
    // «Beto»), que es cuando una recarga «de paso» se notaría: la foto de antes y la de
    // después tienen que ser idénticas, y el listado paginado no puede volver a consultarse.
    for (const caso of FORMAS) {
      const user = userEvent.setup();
      caso.montar();
      await caso.preparar(user);

      const antes = fotoDeLaPantalla(caso.titulo);
      const consultasListado = listarOrdenesMock.mock.calls.length;
      const consultasUsuarios = listarUsuariosMock.mock.calls.length;

      await user.click(screen.getByRole("button", { name: `Descargar ${caso.titulo}` }));
      await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

      expect(fotoDeLaPantalla(caso.titulo), caso.forma).toEqual(antes);
      expect(listarOrdenesMock.mock.calls.length, caso.forma).toBe(consultasListado);
      expect(listarUsuariosMock.mock.calls.length, caso.forma).toBe(consultasUsuarios);

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("el archivo nace y muere en el navegador: sin subida ni almacenamiento", async () => {
    // R38. El binario se arma en el cliente y se entrega por un anchor temporal
    // (`descargarBlob`). Lo que no puede pasar es que además viaje a algún sitio: con las
    // Server Actions mockeadas, cualquier `fetch` durante el ciclo sería exactamente eso.
    const fetchSpy = vi.fn();
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    try {
      for (const caso of FORMAS) {
        const user = userEvent.setup();
        caso.montar();
        await caso.preparar(user);
        fetchSpy.mockClear();

        await user.click(
          screen.getByRole("button", { name: `Descargar ${caso.titulo}` }),
        );
        await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

        expect(fetchSpy, `${caso.forma}: el archivo salió a la red`).not.toHaveBeenCalled();
        // La entrega es local: el mismo binario, con su MIME y su nombre de archivo.
        const [contenido, mime, nombre] = descargarBlobMock.mock.calls[0];
        expect(contenido).toBeInstanceOf(ArrayBuffer);
        expect(mime).toBe(XLSX_MIME);
        expect(String(nombre)).toMatch(/\.xlsx$/);

        cleanup();
        vi.clearAllMocks();
        buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
      }
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  it("ningún listado del árbol se sale del control común (barrido estático)", () => {
    // Lo que extiende R33/R34/R38 de las 3 formas montadas a las 24 tablas y a las futuras.
    // Un test de conducta solo cubre lo que monta; esto cubre lo que existe.
    //
    // El suelo baja de 20 a 19 módulos: `OrdenesApartado.tsx` declaraba `descarga={…}` y se
    // borró el 2026-07-31 con la vista legacy que lo montaba. Sigue siendo un SUELO (no una
    // igualdad) para que este barrido no se vuelva a tocar cada vez que se cablea una tabla
    // nueva; quien retire otra sin querer lo ve fallar igual.
    expect(MODULOS_CON_DESCARGA.length).toBeGreaterThanOrEqual(19);

    for (const modulo of MODULOS_CON_DESCARGA) {
      // R34: nadie declara `formatos` ⇒ nadie ofrece elección (P7 ratificada).
      expect(modulo.fuente, `${modulo.ruta} declara formatos`).not.toMatch(
        /\bformatos\s*:/,
      );

      // R33: nadie arma su propio archivo. El binario lo produce la función común, que
      // vive en `lib/utils/descarga-dataset` y solo la invoca `DescargarDatasetButton`.
      expect(modulo.fuente, `${modulo.ruta} importa un generador`).not.toMatch(
        /from\s+"@?\/?[^"]*(xlsx-template|csv-template|descarga-dataset|exceljs)/,
      );

      // R38: el archivo no viaja. Ningún módulo de listado sube nada ni lo guarda.
      expect(modulo.fuente, `${modulo.ruta} sube o almacena`).not.toMatch(
        /\b(FormData|sendBeacon|localStorage|sessionStorage)\b/,
      );
    }
  });

  it("ninguna tabla se salta el tope: el resultado lo arman los dos adaptadores comunes", () => {
    // R26/R28 transversal, y la razón por la que este test es ESTÁTICO.
    //
    // El tope de 5000 vive en un solo sitio por familia (`filasLocales` y el
    // `limite_excedido` que traduce `filasDesdeResultado`). Una tabla que construyera su
    // `DescargaFilasResult` a mano —`{ status: "ok", filas: … }`— se lo saltaría entera y
    // entregaría un archivo gigante o, peor, truncado en silencio; y ningún test de esa
    // pantalla lo notaría, porque su fixture tiene tres filas.
    //
    // Probarlo montando 5001 filas en CADA pantalla es lo que la tanda E midió como
    // inviable (esas vistas renderizan además una tarjeta por fila y el test no termina).
    // Esta forma cuesta milisegundos, cubre las 25 en vez de una y sigue valiendo para la
    // tabla que se añada dentro de un año.
    for (const modulo of MODULOS_CON_DESCARGA) {
      expect(
        /\bfilasLocales\(|\bfilasDesdeResultado\(|\bobtenerFilasDescarga\b/.test(
          modulo.fuente,
        ),
        `${modulo.ruta}: su descarga no pasa por un adaptador común`,
      ).toBe(true);

      // Nadie fabrica el resultado por su cuenta: si nadie lo arma, nadie puede saltarse
      // el tope que los adaptadores aplican.
      expect(modulo.fuente, `${modulo.ruta} arma un DescargaFilasResult a mano`).not.toMatch(
        /status\s*:\s*"ok"\s*,\s*filas\s*:/,
      );
    }

    // Y los tres componentes de presentación que reciben `obtenerFilas` por prop no son un
    // agujero: quien se la pasa también usa un adaptador común.
    expect(MODULOS_PROVEEDORES.length).toBe(3);
    for (const modulo of MODULOS_PROVEEDORES) {
      expect(modulo.fuente, `${modulo.ruta} pasa filas sin adaptador`).toMatch(
        /obtenerFilasDescarga=\{[^}]*?(filasDesdeResultado|filasLocales)\(/,
      );
    }
  });
});
