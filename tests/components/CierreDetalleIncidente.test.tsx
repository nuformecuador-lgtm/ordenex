// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DetalleSecciones,
  INDEMNIZACION_PENDIENTE_NOTA,
  ORDEN_RESULTADOS,
  RESULTADO_LABEL,
  RESULTADO_VACIO,
  columnasPara,
} from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import { ToastProvider } from "@/providers/ToastProvider";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  IngresoOrdenexDTO,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 158 (T2.3 — R18/R17/R34/R19) — el grupo "Incidentes" en el detalle COMPARTIDO por
// los módulos de admin (`CierresAdminModule` de la 38 y los de bodega de la 40). Lo que
// protege:
//   - el grupo existe, está etiquetado en español y va AL FINAL del orden fijo (R18);
//   - sus columnas son las suyas y NO las de un rechazo: sin origen SLA/manual, sin conceptos
//     de ingreso de Ordenex, sin pago al mensajero y sin ingreso de bodega (R17);
//   - la evidencia se abre con la URL FIRMADA, como en el resto;
//   - la CAUSA se pinta traducida y nunca como slug del enum (R34/R9);
//   - el MONTO se pinta TAL CUAL (STRING) y su "—" lleva la nota de que se captura al aprobar,
//     porque un "—" pelado se leería como «esta orden no se indemniza» (R19).
//
// 📌 Historia de este archivo, que explica dos de sus casos: nació con la causa y el monto SIN
// pintar, porque el DTO no los traía, y dejó un candado de compilación + un caso que afirmaba
// el hueco. El backend extendió el DTO (el candado se puso rojo y se INVIRTIÓ) y esta fase
// pintó las columnas (el caso del hueco se puso rojo y se INVIRTIÓ también). Ninguno de los
// dos se borró: los dos siguen protegiendo el invariante, ahora en su sentido correcto.

/**
 * Feature 170 (T E.5): cada sección del detalle monta el control de descarga del `DataTable`,
 * que usa `useToast`. En la app el proveedor está en `app/(app)/layout.tsx`, encima de estas
 * pantallas; aquí se envuelve por la misma razón que ya hace `OrdenesDescarga.test.tsx` (151).
 * Cambio del ARNÉS: ninguna aserción se toca.
 */
function renderConToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

function ingreso(over: Partial<IngresoOrdenexDTO> = {}): IngresoOrdenexDTO {
  return {
    montoCobrar: "150.00",
    cobraComision: true,
    esCentral: true,
    flete: null,
    ivaFlete: null,
    fleteDevolucion: null,
    ivaFleteDevolucion: null,
    comisionCod: null,
    ivaComisionCod: null,
    fleteConIva: null,
    fleteDevolucionConIva: null,
    comisionConIva: null,
    total: "0.00",
    tarifa: null,
    ...over,
  };
}

function makeGestion(
  over: Partial<CierreDetalleGestion> & { gestionId: string; resultado: CierreResultado },
): CierreDetalleGestion {
  return {
    ordenId: `o-${over.gestionId}`,
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Beto Ruiz",
    direccion: "Calle 1",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    producto: "Caja",
    tiendaNombre: "Tienda X",
    montoRecibido: null,
    metodoPago: null,
    // Feature 212/R31: el DTO gana el desglose y CONSERVA el escalar de arriba.
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    // Feature 158/R9/R19: campos POR RAMA del incidente; los casos del incidente los
    // sobreescriben.
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

function emptyGrupos(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] };
}

function unIncidente(over: Partial<CierreDetalleGestion> = {}): CierreDetalleGestion {
  return makeGestion({
    gestionId: "gi1",
    resultado: "incidente",
    numRemision: "REM-INC",
    motivo: "Paquete robado en la parada",
    evidenciaUrl: "https://signed.example/inc.jpg?token=abc",
    ingresoOrdenex: ingreso(),
    ...over,
  });
}

/** Cabeceras de la tabla de una sección, por su nombre accesible. */
function cabecerasDe(seccion: string): (string | null)[] {
  return within(screen.getByRole("table", { name: seccion }))
    .getAllByRole("columnheader")
    .map((th) => th.textContent);
}

afterEach(() => {
  cleanup();
});

describe("R18 — `incidente` es un grupo propio del detalle de admin", () => {
  it("está etiquetado en español y va AL FINAL del orden fijo de secciones", () => {
    expect(RESULTADO_LABEL.incidente).toBe("Incidentes");
    expect(RESULTADO_VACIO.incidente).toBe("No hay incidentes.");
    expect(ORDEN_RESULTADOS).toContain("incidente");
    expect(ORDEN_RESULTADOS[ORDEN_RESULTADOS.length - 1]).toBe("incidente");
    // Los cuatro previos conservan su orden exacto (no regresión, R35).
    expect(ORDEN_RESULTADOS.slice(0, 4)).toEqual([
      "entregada",
      "reprogramada",
      "devuelta",
      "rechazada",
    ]);
  });

  it("se pinta como región propia con su conteo y su motivo", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), incidente: [unIncidente()] }}
        onVerEvidencia={() => {}}
      />,
    );

    const region = screen.getByRole("region", { name: "Incidentes" });
    expect(within(region).getByRole("heading", { name: /Incidentes/ })).toHaveTextContent("(1)");
    expect(within(region).getByText("REM-INC")).toBeInTheDocument();
    expect(within(region).getByText("Paquete robado en la parada")).toBeInTheDocument();
  });

  it("el grupo vacío NO se pinta", () => {
    renderConToast(<DetalleSecciones grupos={emptyGrupos()} onVerEvidencia={() => {}} />);
    expect(screen.queryByRole("region", { name: "Incidentes" })).toBeNull();
  });

  it("la evidencia se abre con la URL FIRMADA que llega del servidor", async () => {
    const user = userEvent.setup();
    let abierta: string | null = null;
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), incidente: [unIncidente()] }}
        onVerEvidencia={(url) => {
          abierta = url;
        }}
      />,
    );

    const region = screen.getByRole("region", { name: "Incidentes" });
    await user.click(within(region).getByRole("button", { name: "Ver evidencia" }));

    expect(abierta).toBe("https://signed.example/inc.jpg?token=abc");
  });
});

describe("R17 — el incidente NO trae las columnas de dinero de un rechazo", () => {
  it("sin origen SLA/manual, sin conceptos de ingreso, sin pago ni ingreso de bodega", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), incidente: [unIncidente({ pagoMensajero: "0.00" })] }}
        onVerEvidencia={() => {}}
      />,
    );

    const cabeceras = cabecerasDe("Incidentes");
    for (const ausente of [
      "Origen", // 102/R9: un incidente no es un rechazo escalado
      "Pago mensajero", // R17: no se paga
      "Ingreso bodega", // R17: no hay ingreso de bodega por rechazo
      "Flete devolución + IVA", // el incidente no deriva ningún concepto
      "Total Ordenex",
    ]) {
      expect(cabeceras, `sobra la columna "${ausente}"`).not.toContain(ausente);
    }
    // Lo que SÍ debe estar: la identificación de la orden, su COD y el rastro del reporte.
    for (const presente of ["Nº Guía", "Nº Remisión", "A cobrar", "Motivo", "Evidencia"]) {
      expect(cabeceras, `falta la columna "${presente}"`).toContain(presente);
    }
  });

  it("un RECHAZO conserva exactamente sus columnas (no regresión, R35)", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{
          ...emptyGrupos(),
          rechazada: [
            makeGestion({
              gestionId: "gr",
              resultado: "rechazada",
              ingresoOrdenex: ingreso(),
              ingresoBodegaRechazo: "5.00",
            }),
          ],
        }}
        onVerEvidencia={() => {}}
      />,
    );

    const cabeceras = cabecerasDe("Rechazadas");
    for (const presente of [
      "Origen",
      "Pago mensajero",
      "Ingreso bodega",
      "Flete devolución + IVA",
      "Total Ordenex",
      "Evidencia",
    ]) {
      expect(cabeceras, `el rechazo perdió la columna "${presente}"`).toContain(presente);
    }
  });

  it("las columnas del incidente son un conjunto EXPLÍCITO, no la rama por defecto", () => {
    const delIncidente = columnasPara("incidente", () => {}).map((c) => c.id);
    const delRechazo = columnasPara("rechazada", () => {}).map((c) => c.id);
    expect(delIncidente).not.toEqual(delRechazo);
    expect(delIncidente).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tiendaNombre",
      "montoCobrar",
      "causaIncidente", // feature 158/R34 (T2.3, 2026-07-30)
      "motivo",
      "evidencia",
      "indemnizacion", // feature 158/R19/R22 (T2.3, 2026-07-30)
    ]);
  });
});

// --- El candado de la deuda, INVERTIDO el 2026-07-30 (no borrado) ---
//
// La fase frontend dejó aquí un candado de compilación: mientras `CierreDetalleGestion` NO
// trajera `causaIncidente` ni `indemnizacion`, dos alias de tipo valían `true`; el día que el
// DTO los ganara pasaban a `never` y `pnpm run typecheck` ROMPÍA, para que nadie añadiera el
// dato al backend y lo dejara invisible.
//
// **Ese día llegó y el candado hizo exactamente su trabajo**: al extender el DTO, `typecheck`
// se puso en rojo. Aquí se INVIERTE, no se borra — pasa a exigir lo contrario con la misma
// fuerza: los dos campos DEBEN estar en el DTO. Si alguien los quitara (por ejemplo
// "simplificando" el `select` del repo), estos alias vuelven a `never` y el build rompe.
type _ConCausaEnElDto = "causaIncidente" extends keyof CierreDetalleGestion ? true : never;
type _ConMontoEnElDto = "indemnizacion" extends keyof CierreDetalleGestion ? true : never;
const _conCausa: _ConCausaEnElDto = true;
const _conMonto: _ConMontoEnElDto = true;

describe("El dato viaja en el DTO y AHORA SÍ se pinta (T2.3 cerrada el 2026-07-30)", () => {
  it("`CierreDetalleGestion` lleva la causa y el monto (si se quitan, el build rompe)", () => {
    expect(_conCausa).toBe(true);
    expect(_conMonto).toBe(true);
  });

  it("una gestión `incidente` del detalle puede llevar causa y monto con sus tipos correctos", () => {
    // Money-safe: el monto cruza como STRING, igual que `montoRecibido` y `pagoMensajero`.
    const g = unIncidente({ causaIncidente: "robado", indemnizacion: "12500.75" });
    expect(g.causaIncidente).toBe("robado");
    expect(typeof g.indemnizacion).toBe("string");
    // `null` cuando no aplica (cierre aún sin aprobar) o cuando el resultado no es incidente.
    expect(unIncidente().indemnizacion).toBeNull();
    expect(makeGestion({ gestionId: "ge", resultado: "entregada" }).causaIncidente).toBeNull();
  });

  // Este caso nació afirmando lo contrario («las columnas aún NO se pintan»), a propósito, para
  // ponerse ROJO el día que se añadieran y obligar a revisarlas en vez de cerrar el hueco en
  // silencio. **Ese día llegó**: se INVIERTE, con la misma fuerza y sin borrar nada — ahora
  // exige que las dos columnas ESTÉN. Quitarlas vuelve a poner esto en rojo.
  it("T2.3: las columnas de causa y monto SÍ se pintan (antes exigía lo contrario)", () => {
    const columnas = columnasPara("incidente", () => {}).map((c) => c.id);
    expect(columnas).toContain("causaIncidente");
    expect(columnas).toContain("indemnizacion");
  });
});

describe("R34/R9 — la CAUSA se pinta traducida, nunca el slug del enum", () => {
  it.each([
    ["danado", "Paquete dañado"],
    ["perdido", "Paquete perdido"],
    ["robado", "Paquete robado"],
  ] as const)("causa `%s` se muestra como «%s»", (value, etiqueta) => {
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), incidente: [unIncidente({ causaIncidente: value })] }}
        onVerEvidencia={() => {}}
      />,
    );

    const tabla = screen.getByRole("table", { name: "Incidentes" });
    expect(within(tabla).getByText(etiqueta)).toBeInTheDocument();
    // El value crudo del enum no aparece por ninguna parte (se comprueba con `danado`, el
    // único que difiere textualmente de su etiqueta acentuada).
    expect(tabla.textContent).not.toMatch(/danado/);
    cleanup();
  });

  it("la etiqueta sale del MISMO catálogo que usa el panel del mensajero", () => {
    // Si las dos pantallas tuvieran cadenas propias, podrían divergir sin que nada avisara.
    expect(CAUSA_INCIDENTE_LABEL.robado).toBe("Paquete robado");
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), incidente: [unIncidente({ causaIncidente: "robado" })] }}
        onVerEvidencia={() => {}}
      />,
    );
    const tabla = screen.getByRole("table", { name: "Incidentes" });
    expect(within(tabla).getByText(CAUSA_INCIDENTE_LABEL.robado)).toBeInTheDocument();
  });
});

describe("R19/R22 — el MONTO de la indemnización, y el '—' que NO es cero", () => {
  it("un incidente indemnizado con once dígitos se redondea EXACTO (sin parseFloat)", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{
          ...emptyGrupos(),
          incidente: [unIncidente({ indemnizacion: "12345678901.99" })],
        }}
        onVerEvidencia={() => {}}
      />,
    );

    const tabla = screen.getByRole("table", { name: "Incidentes" });
    // Feature 230: sin céntimos, pero el caso sigue midiendo lo mismo. El monto
    // no cabe exacto en un `double`; que el `,99` suba a `…902` solo pasa si el
    // camino es dígito a dígito, y un `parseFloat` intermedio lo rompería.
    expect(within(tabla).getByText("₡12.345.678.902")).toBeInTheDocument();
  });

  it("sin monto todavía muestra '—' CON la nota de que se captura al aprobar", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), incidente: [unIncidente({ indemnizacion: null })] }}
        onVerEvidencia={() => {}}
      />,
    );

    const tabla = screen.getByRole("table", { name: "Incidentes" });
    // Un "—" pelado se leería como «esta orden no se indemniza», que es lo contrario de lo
    // que pasa: el monto todavía no se capturó (R19: lo pone el admin AL APROBAR).
    const celda = within(tabla).getByLabelText(INDEMNIZACION_PENDIENTE_NOTA);
    expect(celda).toHaveTextContent("—");
    expect(celda).toHaveAttribute("title", INDEMNIZACION_PENDIENTE_NOTA);
    expect(INDEMNIZACION_PENDIENTE_NOTA).toMatch(/aprobar/i);
  });

  it("la columna del monto NO aparece en los otros cuatro resultados", () => {
    for (const resultado of ["entregada", "reprogramada", "devuelta", "rechazada"] as const) {
      const ids = columnasPara(resultado, () => {}).map((c) => c.id);
      expect(ids, `${resultado} no debería tener la columna`).not.toContain("indemnizacion");
      expect(ids, `${resultado} no debería tener la columna`).not.toContain("causaIncidente");
    }
  });
});
