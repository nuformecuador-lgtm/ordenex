// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import {
  CierreFacturaDetalle,
  type CierreFacturaCabecera,
} from "@/app/(app)/cierres-admin/_components/cierre-factura";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreOrdenSinGestion,
} from "@/lib/interfaces/services/ICierreDiaService";

/**
 * Feature 264 — LA SECCIÓN «ÓRDENES SIN GESTIONAR» DEL COMPROBANTE DETALLADO.
 *
 * Cubre R13–R18, R19, R20, R21, R28, R31, R32 y R34 (`tasks.md` F3).
 *
 * ── LAS DOS TRAMPAS QUE ESTE ARCHIVO TIENE PROHIBIDAS, escritas antes que su verde
 *
 *  1. **«Con la lista vacía los totales no cambian» NO cuenta como cobertura de R19/R20.** Es el
 *     estado de HOY: verde por construcción, protección cero (`design.md §8.3`). Por eso el
 *     cierre semilla de este archivo se pinta SIEMPRE con la lista NO VACÍA, y el dinero se
 *     compara contra LITERALES —«₡8.000», «1 entregas»— que un cambio en el componente puede
 *     desmentir. Las mutaciones M4 y M5 existen justo para comprobar que puede: si sumar las
 *     órdenes sin gestionar al pie o al KPI no pone rojo este archivo, el archivo no protege
 *     nada.
 *  2. **Ningún rótulo se compara contra la constante que lo emite.** Una aserción contra su
 *     propia fuente siempre está verde: cambiar la constante cambiaría el test con ella. Todos
 *     los textos de aquí son literales escritos a mano.
 *
 * ── LO QUE NO AFIRMA
 * jsdom no compone estilos ni resuelve cascada: nada de aquí dice «se ve bien». El contraste de
 * la sección lo sostiene `tests/unit/guards/factura-contraste.guardia.test.ts` (aritmética sobre
 * los tokens), y que la sección no se parta en papel,
 * `tests/unit/guards/impresion-flujo.guardia.test.ts`. Ninguno de los tres renderiza en un
 * navegador.
 */

// ── Semilla: UN cierre `vencido` con UNA entrega y TRES órdenes barridas ────────────────────

const TOTALES = {
  efectivo: "5000.00",
  simpe: "1500.00",
  transferencia: "1500.00",
  general: "8000.00",
};

const CABECERA: CierreFacturaCabecera = {
  cierreId: "c1000001",
  estado: "vencido",
  destinoTipo: "bodega_central",
  destinoZonaNombre: "GAM",
  mensajeroNombre: "Ana Pérez",
  totales: TOTALES,
  totalPagoMensajero: "1200.00",
  totalIngresoBodegaRechazos: "500.00",
  solicitadoAt: "2026-08-13T10:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
};

const ENTREGA: CierreDetalleGestion = {
  gestionId: "g1",
  ordenId: "o1",
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
  resultado: "entregada",
  montoRecibido: "8000.00",
  metodoPago: null,
  pagos: [],
  motivo: null,
  fechaReprogramacion: null,
  evidenciaUrl: null,
  pagoMensajero: "1200.00",
  ingresoBodegaRechazo: null,
  tarifaFaltante: false,
  esRechazoSla: false,
  desdeAyudaTienda: false,
  causaIncidente: null,
  indemnizacion: null,
};

function grupos(): CierreGrupos {
  return {
    entregada: [ENTREGA],
    reprogramada: [],
    devuelta: [],
    rechazada: [],
    incidente: [],
  };
}

function sinGestion(over: Partial<CierreOrdenSinGestion> = {}): CierreOrdenSinGestion {
  return {
    ordenId: "s1",
    numGuia: 2001,
    numRemision: "REM-S1",
    destinatario: "Beto Mora",
    producto: "Sobre acolchado",
    tiendaNombre: "Tienda Y",
    zonaNombre: "GAM",
    estatusOrigen: "en_reparto",
    ...over,
  };
}

/** Las TRES de la semilla: una desde `en_reparto`, una desde `ayuda_tienda`, una sin guía. */
const TRES: CierreOrdenSinGestion[] = [
  sinGestion(),
  sinGestion({
    ordenId: "s2",
    numGuia: 2002,
    numRemision: "REM-S2",
    destinatario: "Carla Vega",
    producto: "Bulto",
    tiendaNombre: "Tienda Z",
    estatusOrigen: "ayuda_tienda",
  }),
  sinGestion({
    ordenId: "s3",
    numGuia: null,
    numRemision: "REM-S3",
    destinatario: "Dora Ruiz",
    producto: "Caja chica",
    tiendaNombre: "Tienda W",
    estatusOrigen: null,
  }),
];

/**
 * La hoja completa del ADMIN con la semilla. `ordenes`/`registrado` son lo único que varía entre
 * casos: todo lo demás —y sobre todo el dinero— es idéntico en los tres estados de la sección,
 * que es lo que hace comparables los literales de R19/R20.
 */
function pintar(
  ordenes: CierreOrdenSinGestion[] = TRES,
  registrado = true,
): HTMLElement {
  render(
    <CierreFacturaDetalle
      cierre={CABECERA}
      grupos={grupos()}
      totalesIngreso={{
        montoCobrar: "8000.00",
        fleteConIva: "2260.00",
        fleteDevolucionConIva: "0.00",
        comisionConIva: "800.00",
        total: "3060.00",
        // El detalle separado no se pinta en ningún panel; viaja para poder auditar cuánto de
        // cada agrupado es IVA. Se siembra cuadrado (2000 + 260 = 2260; 707,96 + 92,04 = 800)
        // para que nadie que lea esta semilla la use de ejemplo de una aritmética imposible.
        flete: "2000.00",
        ivaFlete: "260.00",
        fleteDevolucion: "0.00",
        ivaFleteDevolucion: "0.00",
        comisionCod: "707.96",
        ivaComisionCod: "92.04",
      }}
      desgloseIngresoBodegaRechazos={{
        sla: "300.00",
        manual: "200.00",
        total: "500.00",
      }}
      ganancia="-400.00"
      pagoTienda="4940.00"
      ordenesSinGestion={ordenes}
      sinGestionRegistrado={registrado}
    />,
  );
  return screen.getByRole("region", {
    name: "Comprobante detallado del cierre de Ana Pérez",
  });
}

/** La sección nueva, localizada por su NOMBRE ACCESIBLE (nunca por una clase). */
function seccion(): HTMLElement {
  return screen.getByRole("region", { name: "Órdenes sin gestionar" });
}

/**
 * La rejilla de KPI de la cabecera. Se ancla en «Gestiones», que sólo existe ahí: los otros tres
 * rótulos («Total general», «Total Ordenex», «Pago al mensajero») se repiten más abajo en los
 * renglones y en la caja de pago, así que buscarlos en toda la hoja devuelve varios.
 */
function rejillaKpi(hoja: HTMLElement): HTMLElement {
  const ancla = within(hoja).getByText("Gestiones");
  return ancla.parentElement!.parentElement as HTMLElement;
}

/** El valor del KPI cuyo rótulo es `label`, leído de su propia tarjeta. */
function kpi(hoja: HTMLElement, label: string): string {
  const tarjeta = within(rejillaKpi(hoja)).getByText(label, {
    selector: "span",
  }).parentElement;
  return (tarjeta?.textContent ?? "").slice(label.length).trim();
}

afterEach(() => {
  cleanup();
});

// ── R13, R14, R16, R17, R18 ─────────────────────────────────────────────────────────────────

describe("feature 264 — la sección existe, dice cuántas son y explica que no hay dinero", () => {
  it("R13: pinta una sección propia con su nombre accesible, FUERA del grupo de pestañas", () => {
    pintar();
    const s = seccion();
    expect(s).toBeInTheDocument();

    // «Fuera del grupo de pestañas» de verdad: no cuelga de la sección de las pestañas ni
    // contiene ninguna. Si fuera una sexta pestaña, las dos cosas fallarían.
    const pestanas = screen.getByRole("region", { name: "Órdenes del cierre" });
    expect(pestanas.contains(s)).toBe(false);
    expect(within(s).queryAllByRole("tab")).toHaveLength(0);
  });

  it("R14: el tablist sigue teniendo EXACTAMENTE cinco pestañas", () => {
    pintar();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });

  it("R16: la sección dice cuántas órdenes contiene", () => {
    pintar();
    const s = seccion();
    // El conteo VISIBLE, no la longitud del array: es lo que lee quien mira la pantalla.
    expect(within(s).getByText("3")).toBeInTheDocument();
    // Y la lista de verdad trae tres filas, no un número suelto que nadie respalda.
    expect(within(s).getAllByRole("listitem")).toHaveLength(3);
  });

  it("R17: lleva la nota que explica que el corte las cerró sin gestión y que no tienen dinero", () => {
    pintar();
    expect(
      within(seccion()).getByText(
        "El corte del día las cerró sin gestión. No tienen dinero asociado.",
      ),
    ).toBeInTheDocument();
  });

  it("R18: tres columnas —Guía, Destinatario, Tienda— y NINGUNA de dinero", () => {
    pintar();
    const s = seccion();

    for (const columna of ["Guía", "Destinatario", "Tienda"]) {
      expect(
        within(s).getByText(columna),
        `falta la columna «${columna}»`,
      ).toBeInTheDocument();
    }

    // Las cinco que no pueden estar. No es una lista de deseos: son los rótulos EXACTOS que la
    // hoja usa para el dinero y la evidencia en la sección de gestiones de al lado, así que si
    // alguna apareciera aquí sería porque alguien copió esa fila entera.
    for (const prohibido of [
      "Cobrado",
      "Recibido",
      "Ingreso total",
      "Pago al mensajero",
      "Ver evidencia",
    ]) {
      expect(
        within(s).queryByText(prohibido),
        `«${prohibido}» no puede estar en la sección: estas órdenes no tienen gestión, así que ` +
          "no tienen ese dato. Una columna vacía al 100 % se lee como «este dato falta».",
      ).toBeNull();
    }

    // Y ni un símbolo de moneda en toda la sección: es la comprobación que no depende de qué
    // rótulo se le ponga a una columna de dinero.
    expect(s.textContent ?? "").not.toContain("₡");
  });

  it("las filas traen la guía, el destinatario, la remisión, el producto y la tienda", () => {
    pintar();
    const s = seccion();
    const fila = within(s).getByText("Beto Mora").closest('[role="listitem"]');
    expect(fila).not.toBeNull();
    const texto = (fila as HTMLElement).textContent ?? "";
    expect(texto).toContain("2001");
    expect(texto).toContain("Beto Mora");
    expect(texto).toContain("REM-S1");
    expect(texto).toContain("Sobre acolchado");
    expect(texto).toContain("Tienda Y");
  });

  it("la orden sin guía pinta «—» en su celda de guía: ese dato existe y está vacío", () => {
    pintar();
    const fila = within(seccion())
      .getByText("Dora Ruiz")
      .closest('[role="listitem"]');
    expect((fila as HTMLElement).textContent ?? "").toContain("—");
  });
});

// ── R15 y R28: «ninguna» y «no lo sabemos» son DOS pantallas distintas ──────────────────────

describe("feature 264 — «ninguna» y «no lo sabemos» no se pintan igual (R15, R28)", () => {
  it("R15: registrado y sin ninguna orden ⇒ la sección NO está en el DOM", () => {
    pintar([], true);
    expect(
      screen.queryByRole("region", { name: "Órdenes sin gestionar" }),
      "con la marca en `true` y cero órdenes, la lectura correcta es «no hubo ninguna» y eso se " +
        "dice callando: la sección no se pinta",
    ).toBeNull();
  });

  it("R28: NO registrado ⇒ aparece el aviso, con su texto literal", () => {
    pintar([], false);
    const s = seccion();
    expect(
      within(s).getByText(
        "Este cierre es anterior al registro de órdenes sin gestionar: no se conserva la lista.",
      ),
    ).toBeInTheDocument();
  });

  it("R28: el aviso NO se acompaña de nada que sugiera «no hubo ninguna»", () => {
    pintar([], false);
    const s = seccion();
    const texto = s.textContent ?? "";

    // Ni la nota que describe una lista que aquí no existe…
    expect(texto).not.toContain(
      "El corte del día las cerró sin gestión. No tienen dinero asociado.",
    );
    // …ni una píldora de conteo con un cero, que es el «ninguna» escrito con un número.
    expect(within(s).queryByText("0")).toBeNull();
    // …ni una lista vacía, que se lee igual.
    expect(within(s).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(s).queryByRole("list")).toBeNull();
  });

  it("R28: el DOM del cierre NO REGISTRADO y el del cierre SIN ÓRDENES son distintos", () => {
    // Ésta es la feature entera de Q3, hecha ejecutable: si el componente ignorase la marca, los
    // dos casos producirían el mismo DOM y este caso sería el único que lo notaría.
    pintar([], false);
    const conAviso = seccion().outerHTML;
    cleanup();

    pintar([], true);
    const sinSeccion = screen.queryByRole("region", {
      name: "Órdenes sin gestionar",
    });

    expect(
      sinSeccion,
      "«no lo sabemos» se está pintando igual que «no hubo ninguna»: el silencio ambiguo volvió",
    ).toBeNull();
    expect(conAviso.length).toBeGreaterThan(0);
  });

  it("R28: con la marca en `false` manda el AVISO, aunque llegaran órdenes", () => {
    pintar(TRES, false);
    const s = seccion();
    expect(
      within(s).getByText(
        "Este cierre es anterior al registro de órdenes sin gestionar: no se conserva la lista.",
      ),
    ).toBeInTheDocument();
    expect(within(s).queryAllByRole("listitem")).toHaveLength(0);
  });
});

// ── R31 y R32: consulta, y nada de guiones permanentes ──────────────────────────────────────

describe("feature 264 — la sección es de consulta y no rellena lo que no sabe", () => {
  it("R31: ni un botón, ni un enlace, ni un desplegable dentro de la sección", () => {
    pintar();
    const s = seccion();
    expect(within(s).queryAllByRole("button")).toHaveLength(0);
    expect(within(s).queryAllByRole("link")).toHaveLength(0);
    expect(s.querySelectorAll("a")).toHaveLength(0);
    expect(s.querySelectorAll("[aria-expanded]")).toHaveLength(0);
    expect(s.querySelectorAll("button")).toHaveLength(0);
  });

  it("R32: el estado de origen se pinta traducido cuando consta", () => {
    pintar();
    const s = seccion();
    const desdeReparto = within(s)
      .getByText("Beto Mora")
      .closest('[role="listitem"]');
    const desdeAyuda = within(s)
      .getByText("Carla Vega")
      .closest('[role="listitem"]');

    expect((desdeReparto as HTMLElement).textContent).toContain("En reparto");
    expect((desdeAyuda as HTMLElement).textContent).toContain(
      "Ayuda de la tienda",
    );
  });

  it("R32: sin estado de origen la pieza se OMITE — la fila no pinta un guion en su lugar", () => {
    // La fila de la orden SIN origen conocido lleva guía (2003), así que si aparece un «—» en su
    // texto sólo puede venir del hueco del estado. Se compara el texto de ESA fila, no el de la
    // sección: en la sección hay otra fila que sí lleva «—» legítimo (la que no tiene guía).
    pintar([
      sinGestion({
        ordenId: "s9",
        numGuia: 2003,
        numRemision: "REM-S9",
        destinatario: "Elsa Núñez",
        producto: "Paquete",
        tiendaNombre: "Tienda V",
        estatusOrigen: null,
      }),
    ]);
    const fila = within(seccion())
      .getByText("Elsa Núñez")
      .closest('[role="listitem"]');
    const texto = (fila as HTMLElement).textContent ?? "";

    expect(texto).toContain("2003");
    expect(
      texto,
      "apareció un marcador de ausencia donde debería no haber nada: un «—» permanente es el " +
        "mismo silencio ambiguo de R28 en pequeño",
    ).not.toContain("—");
  });
});

// ── R34: todas, sin recorte ─────────────────────────────────────────────────────────────────

describe("feature 264 — se listan TODAS, sin recorte (R34)", () => {
  it("con 60 órdenes sembradas se pintan 60 filas y el conteo dice 60", () => {
    const sesenta = Array.from({ length: 60 }, (_, i) =>
      sinGestion({
        ordenId: `s-${i}`,
        numGuia: 3000 + i,
        numRemision: `REM-${i}`,
        destinatario: `Persona ${i}`,
      }),
    );
    pintar(sesenta);
    const s = seccion();

    expect(
      within(s).getAllByRole("listitem"),
      "una lista truncada en silencio se lee como una lista completa",
    ).toHaveLength(60);
    expect(within(s).getByText("60")).toBeInTheDocument();
    // Las dos puntas: la primera y la última tienen que estar, que es lo que un `slice` rompe.
    expect(within(s).getByText("Persona 0")).toBeInTheDocument();
    expect(within(s).getByText("Persona 59")).toBeInTheDocument();
  });
});

// ── R19, R20, R21: EL DINERO NO SE MUEVE ────────────────────────────────────────────────────

describe("feature 264 — el dinero del comprobante no se mueve por la sección (R19, R20, R21)", () => {
  /**
   * ⚠️ Los tres casos de aquí abajo se pintan con la lista NO VACÍA (las tres órdenes de la
   * semilla). Escribirlos con `[]` los volvería verdes por construcción —sería el estado de
   * hoy— y la protección del dinero sería CERO (`design.md §8.3`).
   *
   * Los importes se comparan contra literales tecleados a mano («₡8.000»), no contra
   * `cierre.totales.general` ni contra `money(...)`: comparar un valor con la función que lo
   * genera es una aserción contra su propia fuente y no puede ponerse roja.
   */

  it("R19: el pie sigue diciendo el mismo total recaudado y las MISMAS entregas", () => {
    const hoja = pintar();
    expect(
      hoja.textContent ?? "",
      "el pie es una lectura de DINERO y de ENTREGAS. Una orden sin gestionar no recaudó nada y " +
        "no se entregó: no puede mover ninguno de los dos números",
    ).toContain("Total recaudado ₡8.000 · 1 entregas");
  });

  it("R21: el KPI de conteo dice 1 —no 4— y se rotula «Gestiones»", () => {
    const hoja = pintar();

    // El rótulo es parte del requisito: «Órdenes: 1» con tres órdenes listadas debajo es el
    // error de lectura que R21 prohíbe. Se comprueba por texto visible, no por la constante.
    expect(within(hoja).getByText("Gestiones")).toBeInTheDocument();
    expect(within(hoja).queryByText("Órdenes")).toBeNull();
    expect(kpi(hoja, "Gestiones")).toBe("1");
  });

  it("R20: los KPI y los renglones de dinero valen exactamente lo mismo", () => {
    const hoja = pintar();

    // KPI de dinero de la cabecera.
    expect(kpi(hoja, "Total general")).toBe("₡8.000");
    expect(kpi(hoja, "Total Ordenex")).toBe("₡3.060");
    expect(kpi(hoja, "Pago al mensajero")).toBe("₡1.200");

    // Las dos tarjetas de totales de la empresa.
    expect(
      within(screen.getByRole("region", { name: "Pago a tienda" })).getByText(
        "₡4.940",
      ),
    ).toBeInTheDocument();
    const bodega = screen.getByRole("region", {
      name: "Ingreso de bodega por rechazos del cierre",
    });
    expect(within(bodega).getByText("₡500")).toBeInTheDocument();
    expect(within(bodega).getByText("₡300")).toBeInTheDocument();
    expect(within(bodega).getByText("₡200")).toBeInTheDocument();

    // Los renglones, bloque a bloque, por su nombre accesible.
    const texto = (nombre: string) =>
      screen.getByRole("region", { name: nombre }).textContent ?? "";

    expect(texto("Totales del cierre")).toContain("Efectivo₡5.000");
    expect(texto("Totales del cierre")).toContain("SINPE₡1.500");
    expect(texto("Totales del cierre")).toContain("Transferencia₡1.500");
    expect(texto("Totales del cierre")).toContain("Total general₡8.000");

    expect(texto("Ingreso de Ordenex")).toContain("Flete + IVA₡2.260");
    expect(texto("Ingreso de Ordenex")).toContain("Comisión + IVA₡800");
    expect(texto("Ingreso de Ordenex")).toContain("Flete devolución + IVA₡0");
    expect(texto("Ingreso de Ordenex")).toContain("Total Ordenex₡3.060");

    // La ganancia NEGATIVA (la deuda de Ordenex con el mensajero).
    expect(texto("Liquidación")).toContain("-₡400");
  });

  it("R19/R20: las píldoras de las cinco pestañas siguen contando SOLO gestiones", () => {
    pintar();
    const pestanas = screen.getAllByRole("tab");
    // «Entregadas 1» y las otras cuatro en cero. Concatenar las órdenes sin gestionar a
    // `grupos.entregada` —la otra mitad de M4— movería la primera.
    expect(pestanas.map((t) => t.textContent)).toEqual([
      "Entregadas1",
      "Reprogramadas0",
      "Devueltas0",
      "Rechazadas0",
      "Incidentes0",
    ]);
  });
});
