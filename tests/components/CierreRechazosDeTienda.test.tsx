// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import {
  CierreFacturaDetalle,
  type CierreFacturaAudiencia,
  type CierreFacturaCabecera,
} from "@/app/(app)/cierres-admin/_components/cierre-factura";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreRechazoDeTienda,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";

/**
 * FICHA 425 — LA SECCIÓN «RECHAZADOS POR LA TIENDA» DEL COMPROBANTE DETALLADO (`tasks.md` F4).
 *
 * Cubre R15 y R16, la cara visible de R10 (en la sección no hay nada que escanear ni que tocar) y
 * la parte de pantalla de R14 (el comprobante del mensajero pinta la misma sección que el del
 * admin). Reproduce la forma que aprobó Carlos Restrepo el 2026-09-14 (`design.md §5.4`):
 *
 *   Gestiones del mensajero......  17   (paga)
 *   RECHAZADOS POR LA TIENDA.....   3   (revisar)
 *     NA-947, NA-981, NA-1103  -> separar para devolucion
 *   Al aprobar: las 3 pasan a «por devolver a tienda»
 *
 * ── LO QUE ESTE ARCHIVO SE PROHÍBE, escrito antes que su verde
 *  1. **Ningún texto se compara contra la constante o la función que lo emite.** Todos los
 *     literales están tecleados a mano. Comparar «Separar 3 órdenes…» contra la función que lo
 *     arma estaría verde siempre, también el día que vuelva a decir «orden(es)».
 *  2. **El dinero no se prueba con la lista vacía.** Con `[]` la hoja es la de antes de la ficha y
 *     cualquier aserción de totales sale verde por construcción. Los casos de dinero de aquí se
 *     pintan con los tres rechazos puestos.
 *
 * ── LO QUE NO AFIRMA
 * Que los rechazos no entren en los totales DEL SERVIDOR (R6/R7) ni que la aprobación no pida
 * escanearlos (R10 en el servidor): eso se prueba contra Postgres en
 * `tests/integration/db/cierre-rechazo-tienda-totales.test.ts` y `…-aprobacion.test.ts`. Aquí se
 * prueba que la PANTALLA no los suma ni ofrece nada que tocar. Que las dos pantallas le pasen la
 * lista al comprobante lo sostiene `tests/unit/guards/cierre-detalle-superficies.guardia.test.ts`.
 * jsdom no compone estilos: nada de aquí dice «se ve bien».
 */

// ── Semilla ─────────────────────────────────────────────────────────────────────────────────

/** Cabecera sin el nombre del mensajero: así la compone su propio módulo (el cierre es suyo). */
const BASE: Omit<CierreFacturaCabecera, "mensajeroNombre"> = {
  cierreId: "c4250001",
  estado: "solicitado",
  destinoTipo: "bodega_central",
  destinoZonaNombre: "GAM",
  totales: {
    efectivo: "5000.00",
    simpe: "1500.00",
    transferencia: "1500.00",
    general: "8000.00",
  },
  totalPagoMensajero: "1200.00",
  totalIngresoBodegaRechazos: "0.00",
  solicitadoAt: "2026-09-11T14:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
};

/** El caso de Arnel tal como nacerá tras desplegar: SÓLO rechazos, seis totales en cero. */
const TOTALES_EN_CERO: CierreFacturaCabecera["totales"] = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

function cabecera(
  audiencia: CierreFacturaAudiencia,
  enCero: boolean,
): CierreFacturaCabecera {
  const quien = audiencia === "mensajero" ? {} : { mensajeroNombre: "Arnel Guillen" };
  const dinero = enCero ? { totales: TOTALES_EN_CERO, totalPagoMensajero: "0.00" } : {};
  return { ...BASE, ...quien, ...dinero };
}

const INGRESO: TotalesIngresoOrdenex = {
  montoCobrar: "8000.00",
  fleteConIva: "2260.00",
  fleteDevolucionConIva: "0.00",
  comisionConIva: "800.00",
  total: "3060.00",
  flete: "2000.00",
  ivaFlete: "260.00",
  fleteDevolucion: "0.00",
  ivaFleteDevolucion: "0.00",
  comisionCod: "707.96",
  ivaComisionCod: "92.04",
};

const INGRESO_EN_CERO: TotalesIngresoOrdenex = {
  montoCobrar: "0.00",
  fleteConIva: "0.00",
  fleteDevolucionConIva: "0.00",
  comisionConIva: "0.00",
  total: "0.00",
  flete: "0.00",
  ivaFlete: "0.00",
  fleteDevolucion: "0.00",
  ivaFleteDevolucion: "0.00",
  comisionCod: "0.00",
  ivaComisionCod: "0.00",
};

function entrega(over: Partial<CierreDetalleGestion> = {}): CierreDetalleGestion {
  return {
    gestionId: "g1",
    ordenId: "o1",
    fechaGestion: "2026-09-10",
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    direccion: "Calle 1, casa 2",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    producto: "Caja mediana",
    tiendaNombre: "Tienda X",
    resultado: "entregado",
    montoRecibido: "5000.00",
    metodoPago: null,
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: "600.00",
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    desdeAyudaTienda: false,
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

/** DOS entregas: 5.000 + 3.000 = 8.000, que es el total general de la cabecera. */
function dosEntregas(): CierreGrupos {
  return {
    entregado: [
      entrega(),
      entrega({
        gestionId: "g2",
        ordenId: "o2",
        numGuia: 1002,
        numRemision: "REM-002",
        destinatario: "Luis Soto",
        montoRecibido: "3000.00",
      }),
    ],
    reprogramado: [],
    novedad: [],
    devolucion_a_origen_por_rechazo: [],
    incidente: [],
  };
}

function ningunaGestion(): CierreGrupos {
  return { entregado: [], reprogramado: [], novedad: [], devolucion_a_origen_por_rechazo: [], incidente: [] };
}

function rechazo(over: Partial<CierreRechazoDeTienda> = {}): CierreRechazoDeTienda {
  return {
    gestionId: "r947",
    ordenId: "o947",
    numGuia: 19301246,
    numRemision: "NA-947",
    destinatario: "Beto Mora",
    producto: "Sobre acolchado",
    tiendaNombre: "Nuform",
    zonaNombre: "GAM",
    rechazadoAt: "2026-08-28T15:00:00.000Z",
    motivo: "El cliente no quiso recibir",
    ...over,
  };
}

/**
 * Los tres, en el orden en que los manda el servidor (del más viejo al más reciente). El tercero
 * no trae guía ni motivo —para probar que la fila OMITE esas piezas— y se rechazó a las 20:30 de
 * Costa Rica del 10/09, que en UTC ya es el 11: es el caso que un `slice(0, 10)` pintaría mal.
 * (En producción NA-1103 sí tiene guía; aquí se le quita a propósito.)
 */
const TRES: CierreRechazoDeTienda[] = [
  rechazo(),
  rechazo({
    gestionId: "r981",
    ordenId: "o981",
    numGuia: 58980454,
    numRemision: "NA-981",
    destinatario: "Carla Vega",
    producto: "Bulto",
    rechazadoAt: "2026-09-10T16:00:00.000Z",
    motivo: "Dirección incompleta",
  }),
  rechazo({
    gestionId: "r1103",
    ordenId: "o1103",
    numGuia: null,
    numRemision: "NA-1103",
    destinatario: "Dora Ruiz",
    producto: "Caja chica",
    tiendaNombre: "Tienda W",
    rechazadoAt: "2026-09-11T02:30:00.000Z",
    motivo: null,
  }),
];

interface Escena {
  rechazos?: CierreRechazoDeTienda[];
  /** `true` = el caso Arnel: ninguna gestión y todos los importes en cero. */
  enCero?: boolean;
  audiencia?: CierreFacturaAudiencia;
}

function pintar({ rechazos = TRES, enCero = false, audiencia = "admin" }: Escena = {}): void {
  render(
    <CierreFacturaDetalle
      audiencia={audiencia}
      cierre={cabecera(audiencia, enCero)}
      grupos={enCero ? ningunaGestion() : dosEntregas()}
      totalesIngreso={enCero ? INGRESO_EN_CERO : INGRESO}
      desgloseIngresoBodegaRechazos={{ sla: "0.00", manual: "0.00", total: "0.00" }}
      ganancia={enCero ? "0.00" : "1860.00"}
      pagoTienda={enCero ? "0.00" : "4940.00"}
      ordenesSinGestion={[]}
      sinGestionRegistrado
      rechazosDeTienda={rechazos}
    />,
  );
}

/** La sección, por su NOMBRE ACCESIBLE (nunca por una clase). */
function seccion(): HTMLElement {
  return screen.getByRole("region", { name: "Rechazados por la tienda" });
}

/** Uno de los dos conteos, por su rótulo. */
function conteo(nombre: string): HTMLElement {
  return within(seccion()).getByRole("group", { name: nombre });
}

/** La fila del rechazo de `destinatario`, localizada por su rol de lista. */
function fila(destinatario: string): HTMLElement {
  const encontrada = within(seccion())
    .getByText(destinatario)
    .closest('[role="listitem"]');
  expect(encontrada, `no hay fila para ${destinatario}`).not.toBeNull();
  return encontrada as HTMLElement;
}

/**
 * El valor de un KPI de la cabecera, leído de su propia tarjeta. Mismo anclaje que la 264: la
 * rejilla se localiza por «Gestiones», que sólo existe ahí (el «Gestiones del mensajero» de la
 * sección no casa: la búsqueda es por texto EXACTO).
 */
function kpi(label: string): string {
  const hoja = screen.getByRole("region", { name: /^Comprobante detallado/ });
  const rejilla = within(hoja).getByText("Gestiones").parentElement!
    .parentElement as HTMLElement;
  const tarjeta = within(rejilla).getByText(label, { selector: "span" }).parentElement;
  return (tarjeta?.textContent ?? "").slice(label.length).trim();
}

afterEach(() => {
  cleanup();
});

// ── R16: la forma aprobada ──────────────────────────────────────────────────────────────────

describe("ficha 425 — la sección existe, va aparte y tiene la forma aprobada (R16)", () => {
  it("es una sección propia con su rótulo visible, fuera de las pestañas de gestiones", () => {
    pintar();
    const s = seccion();
    expect(
      within(s).getByRole("heading", { name: "Rechazados por la tienda" }),
    ).toBeInTheDocument();

    const pestanas = screen.getByRole("region", { name: "Órdenes del cierre" });
    expect(pestanas.contains(s)).toBe(false);
    expect(s.contains(pestanas)).toBe(false);
    expect(within(s).queryAllByRole("tab")).toHaveLength(0);
    // Tampoco se mete en la sección de la 264: con su lista vacía, esa ni existe.
    expect(screen.queryByRole("region", { name: "Pasaron a Novedad interna" })).toBeNull();
  });

  it("los DOS conteos van etiquetados con lo que hace cada uno: gestiones «paga», rechazos «revisar»", () => {
    pintar();

    const gestiones = conteo("Gestiones del mensajero");
    expect(within(gestiones).getByText("2")).toBeInTheDocument();
    expect(within(gestiones).getByText("paga")).toBeInTheDocument();
    expect(within(gestiones).queryByText("revisar")).toBeNull();

    const rechazos = conteo("Rechazados por la tienda");
    expect(within(rechazos).getByText("3")).toBeInTheDocument();
    expect(within(rechazos).getByText("revisar")).toBeInTheDocument();
    expect(within(rechazos).queryByText("paga")).toBeNull();
  });

  it("dice que no son gestiones del mensajero y que no suman a su pago", () => {
    pintar();
    expect(
      within(seccion()).getByText("No son gestiones del mensajero y no suman a su pago."),
    ).toBeInTheDocument();
  });

  it("dice qué hacer y qué pasa al aprobar: separar sin escanear, y las órdenes salen solas", () => {
    pintar();
    const s = seccion();
    expect(
      within(s).getByText("Separar 3 órdenes para devolución, sin escanearlas."),
    ).toBeInTheDocument();
    expect(
      within(s).getByText(
        "Al aprobar el cierre, las 3 pasan solas a «Por devolver a tienda» (las de zona satélite, a «Por devolver a bodega central»).",
      ),
    ).toBeInTheDocument();
  });
});

// ── R15: lo necesario para separar el paquete ───────────────────────────────────────────────

describe("ficha 425 — cada fila trae lo necesario para separar el paquete (R15)", () => {
  it("una fila por rechazo, en el orden en que los manda el servidor", () => {
    pintar();
    const filas = within(seccion()).getAllByRole("listitem");
    expect(filas).toHaveLength(3);
    // El orden lo decide el servidor (del más viejo al más reciente): la pantalla no lo rehace.
    expect(filas.map((f) => (f.textContent ?? "").match(/NA-\d+/)?.[0])).toEqual([
      "NA-947",
      "NA-981",
      "NA-1103",
    ]);
  });

  it("455/m8: la lista se nombra en masculino, como el título, sin el participio del estado retirado", () => {
    pintar();
    expect(
      within(seccion()).getByRole("list", { name: "Lista de paquetes rechazados por la tienda" }),
    ).toBeInTheDocument();
  });

  it("guía, remisión, destinatario, producto, tienda, FECHA del rechazo y motivo", () => {
    pintar();
    const texto = fila("Beto Mora").textContent ?? "";
    for (const pieza of [
      "19301246",
      "NA-947",
      "Beto Mora",
      "Sobre acolchado",
      "Nuform",
      "2026-08-28",
      "Motivo: El cliente no quiso recibir",
    ]) {
      expect(texto, `falta «${pieza}» en la fila`).toContain(pieza);
    }
  });

  it("la columna de la fecha está rotulada como fecha DEL RECHAZO", () => {
    pintar();
    expect(within(seccion()).getByText("Fecha del rechazo")).toBeInTheDocument();
  });

  it("la fecha es la del calendario de Costa Rica: rechazado a las 20:30 del 10/09 dice 2026-09-10", () => {
    pintar();
    const f = fila("Dora Ruiz");
    // 2026-09-11T02:30Z son las 20:30 del día 10 en Costa Rica (UTC-6). Cortar el ISO diría 11.
    expect(f.textContent ?? "").toContain("2026-09-10");
    expect(f.textContent ?? "").not.toContain("2026-09-11");
    // El instante exacto queda en el DOM, en el atributo del `<time>`.
    expect(f.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-09-11T02:30:00.000Z",
    );
  });

  it("sin guía y sin motivo, la fila OMITE esas piezas: ni un guion, ni un «Motivo» vacío", () => {
    pintar();
    const texto = fila("Dora Ruiz").textContent ?? "";
    expect(texto).toContain("NA-1103");
    expect(texto).not.toContain("—");
    expect(texto).not.toContain("Motivo");
  });

  it("se listan TODOS, sin recorte: 19 rechazos (el máximo medido) son 19 filas y el conteo dice 19", () => {
    const diecinueve = Array.from({ length: 19 }, (_, i) =>
      rechazo({
        gestionId: `r-${i}`,
        ordenId: `o-${i}`,
        numGuia: 40000000 + i,
        numRemision: `NA-${2000 + i}`,
        destinatario: `Persona ${i}`,
      }),
    );
    pintar({ rechazos: diecinueve });
    const s = seccion();

    expect(within(s).getAllByRole("listitem")).toHaveLength(19);
    expect(within(conteo("Rechazados por la tienda")).getByText("19")).toBeInTheDocument();
    expect(within(s).getByText("Persona 0")).toBeInTheDocument();
    expect(within(s).getByText("Persona 18")).toBeInTheDocument();
    expect(
      within(s).getByText("Separar 19 órdenes para devolución, sin escanearlas."),
    ).toBeInTheDocument();
  });
});

// ── R16/R10: no es dinero y no se toca ──────────────────────────────────────────────────────

describe("ficha 425 — la sección no es dinero ni se toca (R16, R10)", () => {
  it("ni un importe, ni una columna de dinero, ni el símbolo de moneda", () => {
    pintar();
    const s = seccion();
    for (const prohibido of [
      "Cobrado",
      "Recibido",
      "Ingreso total",
      "Pago al mensajero",
      "Ganancia",
      "Ver evidencia",
    ]) {
      expect(
        within(s).queryByText(prohibido),
        `«${prohibido}» no puede estar en la sección: un rechazo de tienda no se cobra ni se paga`,
      ).toBeNull();
    }
    expect(s.textContent ?? "").not.toContain("₡");
  });

  it("R10: ni casilla de confirmación, ni botón, ni enlace, ni desplegable", () => {
    pintar();
    const s = seccion();
    expect(within(s).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(s).queryAllByRole("button")).toHaveLength(0);
    expect(within(s).queryAllByRole("link")).toHaveLength(0);
    expect(s.querySelectorAll("input, button, a, [aria-expanded]")).toHaveLength(0);
  });

  it("con los tres rechazos puestos, KPI, pestañas y pie siguen contando SÓLO las dos gestiones", () => {
    pintar();

    expect(kpi("Gestiones")).toBe("2");
    expect(kpi("Total general")).toBe("₡8.000");
    expect(kpi("Pago al mensajero")).toBe("₡1.200");

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Entregado2",
      "Reprogramado0",
      "Novedad0",
      "Devolución a origen por rechazo0",
      "Incidente0",
    ]);

    expect(
      screen.getByRole("region", { name: /^Comprobante detallado/ }).textContent ?? "",
    ).toContain("Total recaudado ₡8.000 · 2 entregas");
  });
});

// ── Singular y plural ───────────────────────────────────────────────────────────────────────

describe("ficha 425 — singular y plural, sin «orden(es)»", () => {
  it("con UNA: «1 orden», «la orden pasa sola», y ningún plural colado", () => {
    pintar({ rechazos: [TRES[1]!] });
    const s = seccion();

    expect(within(s).getByText("Separar 1 orden para devolución, sin escanearla.")).toBeInTheDocument();
    expect(
      within(s).getByText(
        "Al aprobar el cierre, la orden pasa sola a «Por devolver a tienda» (si es de zona satélite, a «Por devolver a bodega central»).",
      ),
    ).toBeInTheDocument();
    expect(within(conteo("Rechazados por la tienda")).getByText("1")).toBeInTheDocument();

    const texto = s.textContent ?? "";
    for (const colado of ["órdenes", "(es)", "pasan", "solas", "escanearlas"]) {
      expect(texto, `con una sola orden se coló «${colado}»`).not.toContain(colado);
    }
  });

  it("con TRES: «3 órdenes», «las 3 pasan solas», y ningún singular colado", () => {
    pintar();
    const texto = seccion().textContent ?? "";

    expect(texto).toContain("Separar 3 órdenes para devolución, sin escanearlas.");
    expect(texto).toContain(
      "Al aprobar el cierre, las 3 pasan solas a «Por devolver a tienda» (las de zona satélite, a «Por devolver a bodega central»).",
    );
    for (const colado of ["3 orden ", "(es)", "pasa sola", "escanearla."]) {
      expect(texto, `con tres órdenes se coló «${colado}»`).not.toContain(colado);
    }
  });
});

// ── D3: el cierre de SÓLO rechazos ──────────────────────────────────────────────────────────

describe("ficha 425 — un cierre de SÓLO rechazos se lee como revisión, no como error (D3, caso Arnel)", () => {
  it("con cero gestiones, los conteos dicen 0 «paga» y 3 «revisar», y la hoja explica los ceros", () => {
    pintar({ enCero: true });

    expect(within(conteo("Gestiones del mensajero")).getByText("0")).toBeInTheDocument();
    expect(within(conteo("Gestiones del mensajero")).getByText("paga")).toBeInTheDocument();
    expect(within(conteo("Rechazados por la tienda")).getByText("3")).toBeInTheDocument();
    expect(
      within(seccion()).getByText(
        "Este cierre no trae gestiones del mensajero: es un documento de revisión, y por eso sus totales están en cero.",
      ),
    ).toBeInTheDocument();
  });

  it("la explicación llega ANTES que las cifras: la sección precede a las tarjetas, los totales y las pestañas", () => {
    pintar({ enCero: true });
    const s = seccion();
    for (const nombre of ["Pago a tienda", "Totales del cierre", "Órdenes del cierre"]) {
      const bloque = screen.getByRole("region", { name: nombre });
      expect(
        s.compareDocumentPosition(bloque) & Node.DOCUMENT_POSITION_FOLLOWING,
        `«${nombre}» aparece antes que la sección: quien abre el cierre ve los ceros sin explicación`,
      ).toBeTruthy();
    }
  });

  it("con gestiones, esa explicación NO aparece: ese cierre no está en cero", () => {
    pintar();
    expect(
      screen.queryByText(
        "Este cierre no trae gestiones del mensajero: es un documento de revisión, y por eso sus totales están en cero.",
      ),
    ).toBeNull();
    // Autocomprobación: la sección SÍ está; si no, el `toBeNull` de arriba no probaría nada.
    expect(seccion()).toBeInTheDocument();
  });
});

// ── Sin rechazos no hay sección ─────────────────────────────────────────────────────────────

describe("ficha 425 — sin rechazos no hay sección (la hoja queda como estaba, R19)", () => {
  it("lista vacía: ni la región, ni el rótulo, ni los conteos, ni la nota", () => {
    pintar({ rechazos: [] });

    expect(screen.queryByRole("region", { name: "Rechazados por la tienda" })).toBeNull();
    expect(screen.queryByText("Rechazados por la tienda")).toBeNull();
    expect(screen.queryByText("Gestiones del mensajero")).toBeNull();
    expect(screen.queryByText("paga")).toBeNull();
    expect(screen.queryByText("revisar")).toBeNull();
    expect(
      screen.queryByText("No son gestiones del mensajero y no suman a su pago."),
    ).toBeNull();
    // Autocomprobación: la hoja SÍ se pintó; si no, todo lo de arriba pasaría sin mirar nada.
    expect(screen.getByRole("region", { name: "Totales del cierre" })).toBeInTheDocument();
  });

  it("sin la prop —los dobles que montan la hoja con lo mínimo— tampoco", () => {
    render(<CierreFacturaDetalle cierre={cabecera("admin", false)} grupos={dosEntregas()} />);
    expect(screen.queryByRole("region", { name: "Rechazados por la tienda" })).toBeNull();
    expect(screen.getByRole("region", { name: "Totales del cierre" })).toBeInTheDocument();
  });
});

// ── R14: la misma sección en el comprobante del mensajero ───────────────────────────────────

describe("ficha 425 — el comprobante del mensajero pinta LA MISMA sección (R14)", () => {
  it("con audiencia «mensajero»: mismos conteos, misma nota y mismas filas", () => {
    pintar({ audiencia: "mensajero" });
    const s = seccion();

    expect(within(conteo("Gestiones del mensajero")).getByText("paga")).toBeInTheDocument();
    expect(within(conteo("Rechazados por la tienda")).getByText("3")).toBeInTheDocument();
    expect(
      within(s).getByText("No son gestiones del mensajero y no suman a su pago."),
    ).toBeInTheDocument();
    expect(within(s).getAllByRole("listitem")).toHaveLength(3);
  });

  it("para el mismo cierre, la sección del admin y la del mensajero dicen EXACTAMENTE lo mismo", () => {
    pintar();
    const delAdmin = seccion().textContent ?? "";
    cleanup();

    pintar({ audiencia: "mensajero" });
    const delMensajero = seccion().textContent ?? "";

    // No se comparan dos cadenas vacías.
    expect(delAdmin).toContain("NA-981");
    expect(delMensajero).toBe(delAdmin);
  });
});
