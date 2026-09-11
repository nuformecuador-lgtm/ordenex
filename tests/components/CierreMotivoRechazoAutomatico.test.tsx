// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { DetalleSecciones } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import { ToastProvider } from "@/providers/ToastProvider";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";

// FICHA 408 (R8, R9) — la fila de un rechazo AUTOMÁTICO en el detalle del ADMIN, que es la
// superficie donde la columna «Origen» SÍ existe.
//
// Lo que este archivo protege:
//   - R9: la celda «Motivo» dice la causa y NADA más — ni la palabra «automático», ni la frase
//     del marcador. Ahí al lado hay una columna que ya responde esa pregunta, y repetirla sería
//     la tercera vez que la misma fila cuenta lo mismo.
//   - R8: el marcador de origen NO se ha tocado: sigue diciendo «Automático» y sigue llevando su
//     nota accesible palabra por palabra.
//   - R2 en la pantalla real: el motivo que escribió el mensajero sale INTACTO.
//
// ⚠️ Los literales están tecleados a mano, incluida la nota del marcador. Compararlos contra
// `RECHAZO_SLA_BADGE_NOTA` o contra `motivoGestionLegible` los dejaría verdes aunque el texto se
// rompiera entero.

/** El texto corto de la causa, tal y como lo aprobó la feature 73 el 2026-07-15. */
const DIRECCION_ERRADA = "Dirección errada";

/** La nota accesible del marcador de origen, completa y sin recortar (R8). */
const NOTA_MARCADOR_AUTOMATICO =
  "Rechazo automático por vencerse el plazo de la devolución (no lo hizo el mensajero).";

/** El motivo que un mensajero escribió a mano: no es plantilla y no se traduce (R2). */
const MOTIVO_LIBRE = "El cliente no contesta el timbre";

function renderConToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

function makeGestion(
  over: Partial<CierreDetalleGestion> & { gestionId: string; resultado: CierreResultado },
): CierreDetalleGestion {
  return {
    ordenId: `o-${over.gestionId}`,
    fechaGestion: "2026-07-11",
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
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    desdeAyudaTienda: false,
    causaIncidente: null,
    indemnizacion: null,
    ingresoOrdenex: null,
    ...over,
  };
}

function emptyGrupos(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] };
}

/** La gestión sintética del cron de plazos vencidos, con la cadena EXACTA de producción. */
const RECHAZO_AUTOMATICO = makeGestion({
  gestionId: "g-sla",
  resultado: "rechazada",
  numRemision: "REM-SLA",
  esRechazoSla: true,
  motivo: "escalado SLA wrong_address",
});

/** Un rechazo del mensajero, con su motivo escrito a mano. */
const RECHAZO_MANUAL = makeGestion({
  gestionId: "g-manual",
  resultado: "rechazada",
  numRemision: "REM-MAN",
  esRechazoSla: false,
  motivo: MOTIVO_LIBRE,
});

/**
 * El texto de una celda de la fila cuyo «Nº Remisión» se indica, buscando la columna por su
 * encabezado. Se localiza por posición dentro de SU tabla: la cabecera y el cuerpo comparten el
 * mismo número de celdas, así que el índice del `<th>` es el índice del `<td>`.
 */
function celdaDe(seccion: string, numRemision: string, encabezado: string): string {
  const tabla = screen.getByRole("table", { name: seccion });
  const encabezados = within(tabla)
    .getAllByRole("columnheader")
    .map((th) => th.textContent);
  const indice = encabezados.indexOf(encabezado);
  expect(indice, `la tabla «${seccion}» no tiene la columna «${encabezado}»`).toBeGreaterThan(-1);

  const fila = within(tabla)
    .getAllByRole("row")
    .find((tr) => within(tr).queryByText(numRemision) !== null);
  expect(fila, `no hay fila con ${numRemision}`).toBeDefined();

  const celdas = within(fila as HTMLElement).getAllByRole("cell");
  return celdas[indice]?.textContent ?? "";
}

afterEach(() => {
  cleanup();
});

describe("R9 — donde está el marcador, la columna «Motivo» no lo repite", () => {
  it("la celda «Motivo» de un rechazo automático es exactamente «Dirección errada»", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), rechazada: [RECHAZO_AUTOMATICO] }}
        onVerEvidencia={() => {}}
      />,
    );

    expect(celdaDe("Rechazadas", "REM-SLA", "Motivo")).toBe(DIRECCION_ERRADA);
  });

  it("esa celda NO dice «automático» ni repite la nota del marcador", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), rechazada: [RECHAZO_AUTOMATICO] }}
        onVerEvidencia={() => {}}
      />,
    );

    const celda = celdaDe("Rechazadas", "REM-SLA", "Motivo");
    expect(celda.toLowerCase()).not.toContain("automático");
    expect(celda).not.toContain(NOTA_MARCADOR_AUTOMATICO);
    expect(celda).not.toContain("plazo");
    // Y tampoco la jerga que abrió la ficha.
    expect(celda).not.toContain("SLA");
    expect(celda).not.toContain("wrong_address");
  });

  it("el dato crudo no queda pintado en ninguna parte de la fila", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), rechazada: [RECHAZO_AUTOMATICO] }}
        onVerEvidencia={() => {}}
      />,
    );

    const tabla = screen.getByRole("table", { name: "Rechazadas" });
    expect(within(tabla).queryByText("escalado SLA wrong_address")).toBeNull();
  });
});

describe("R8 — el marcador de origen sigue diciendo lo que decía", () => {
  it("la fila mantiene el badge «Automático» con su nota accesible completa", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), rechazada: [RECHAZO_AUTOMATICO] }}
        onVerEvidencia={() => {}}
      />,
    );

    expect(celdaDe("Rechazadas", "REM-SLA", "Origen")).toBe("Automático");

    const tabla = screen.getByRole("table", { name: "Rechazadas" });
    const badge = within(tabla).getByLabelText(NOTA_MARCADOR_AUTOMATICO);
    expect(badge).toHaveTextContent("Automático");
    expect(badge).toHaveAttribute("title", NOTA_MARCADOR_AUTOMATICO);
  });

  it("un rechazo del mensajero sigue marcado «Manual»", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), rechazada: [RECHAZO_MANUAL] }}
        onVerEvidencia={() => {}}
      />,
    );

    expect(celdaDe("Rechazadas", "REM-MAN", "Origen")).toBe("Manual");
  });
});

describe("R2 — el motivo que escribió el mensajero sale intacto en la misma tabla", () => {
  it("las dos filas conviven: una traducida y la otra literal", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{ ...emptyGrupos(), rechazada: [RECHAZO_AUTOMATICO, RECHAZO_MANUAL] }}
        onVerEvidencia={() => {}}
      />,
    );

    expect(celdaDe("Rechazadas", "REM-SLA", "Motivo")).toBe(DIRECCION_ERRADA);
    expect(celdaDe("Rechazadas", "REM-MAN", "Motivo")).toBe(MOTIVO_LIBRE);
  });

  it("una DEVUELTA con motivo libre tampoco se toca (la sección sin columna «Origen»)", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{
          ...emptyGrupos(),
          devuelta: [
            makeGestion({
              gestionId: "g-dev",
              resultado: "devuelta",
              numRemision: "REM-DEV",
              motivo: MOTIVO_LIBRE,
            }),
          ],
        }}
        onVerEvidencia={() => {}}
      />,
    );

    expect(celdaDe("Devueltas", "REM-DEV", "Motivo")).toBe(MOTIVO_LIBRE);
  });

  it("un motivo ausente sigue pintando el guion de pantalla", () => {
    renderConToast(
      <DetalleSecciones
        grupos={{
          ...emptyGrupos(),
          rechazada: [
            makeGestion({
              gestionId: "g-sin",
              resultado: "rechazada",
              numRemision: "REM-SIN",
              motivo: null,
            }),
          ],
        }}
        onVerEvidencia={() => {}}
      />,
    );

    // El `?? "—"` vive en el render, no dentro del traductor: en la hoja descargada esta misma
    // celda va VACÍA (R3).
    expect(celdaDe("Rechazadas", "REM-SIN", "Motivo")).toBe("—");
  });
});
