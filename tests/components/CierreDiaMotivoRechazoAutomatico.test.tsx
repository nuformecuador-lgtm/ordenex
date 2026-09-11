// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";

import { CierreDiaModule } from "@/app/(app)/cierre-dia/_components/CierreDiaModule";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  CierreTotales,
} from "@/lib/interfaces/services/ICierreDiaService";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

// FICHA 408 (R11) — la pantalla del MENSAJERO, que es el caso que abrió la ficha.
//
// Aquí NO hay columna «Origen» y NO puede haberla: `CierreDiaRepository` fija
// `esRechazoSla: false` para esta vista por decisión expresa de la feature 102. Así que el texto
// del motivo es el ÚNICO portador de que ese rechazo no lo hizo él, y por eso la celda tiene que
// llevar el texto LARGO, entero.
//
// ⚠️ ESTE ARCHIVO EXISTE PARA CAZAR UN FALLO MUDO. Pasar `true` fijo en los llamadores de esta
// pantalla no rompe nada visible —no hay excepción, no hay hueco, no hay error de consola—:
// sólo acorta el texto, y el mensajero se queda sin saber que el rechazo no fue suyo. La
// aserción del texto completo, tecleado a mano, es lo único que lo dice.

vi.mock("@/lib/actions/cierre-dia", () => ({
  solicitarCierre: vi.fn(),
  listarCierreDia: vi.fn(),
  deshacerGestion: vi.fn(),
  listarCierresPasadosPaginado: vi.fn(async () => ({
    status: "ok" as const,
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
}));

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

/** El texto autosuficiente, COMPLETO y tecleado a mano (R11). */
const MOTIVO_LARGO =
  "Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución";

/** La variante corta, para afirmar que en ESTA pantalla no aparece nunca. */
const MOTIVO_CORTO = "Dirección errada";

/** Un motivo escrito por el propio mensajero: no es plantilla y sale intacto (R2). */
const MOTIVO_LIBRE = "El cliente no contesta el timbre";

/**
 * ⚠️ `esRechazoSla` NO se puede sobrescribir, y es a propósito: el servidor lo fija en `false`
 * para la vista del mensajero (`CierreDiaRepository`, decisión expresa de la feature 102), así
 * que un fixture que dijera otra cosa estaría probando un estado que no existe. El `Omit` lo
 * hace un error de compilación en vez de un despiste.
 */
function makeGestion(
  over: Omit<Partial<CierreDetalleGestion>, "esRechazoSla"> & {
    gestionId: string;
    resultado: CierreResultado;
  },
): CierreDetalleGestion {
  return {
    ordenId: `o-${over.gestionId}`,
    fechaGestion: "2026-07-11",
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
    montoRecibido: null,
    metodoPago: null,
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    desdeAyudaTienda: false,
    causaIncidente: null,
    indemnizacion: null,
    ...over,
    // Lo que ESTA vista recibe SIEMPRE del servidor. Va después del spread para que sea el
    // fixture, y no cada caso, quien lo garantice.
    esRechazoSla: false,
  };
}

function emptyGrupos(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] };
}

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

function renderModule(grupos: CierreGrupos) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CierreDiaModule
        grupos={grupos}
        totales={ZERO_TOTALES}
        totalPagoMensajero="0.00"
        puedesSolicitar
        motivoBloqueo={null}
        cierresPasados={{ items: [], total: 0, pageSize: 25 }}
        bloqueo={SIN_BLOQUEO}
      />
    </SWRConfig>,
  );
}

/** El texto de una celda, localizando la columna por su encabezado dentro de SU tabla. */
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

  return within(fila as HTMLElement).getAllByRole("cell")[indice]?.textContent ?? "";
}

/** La gestión sintética del cron, con la cadena EXACTA que hay guardada en producción. */
const RECHAZO_AUTOMATICO = makeGestion({
  gestionId: "g-sla",
  resultado: "rechazada",
  numRemision: "REM-SLA",
  motivo: "escalado SLA wrong_address",
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("R11 — en el cierre del día, el motivo automático se sostiene solo", () => {
  it("la celda «Motivo» lleva el texto LARGO completo", () => {
    renderModule({ ...emptyGrupos(), rechazada: [RECHAZO_AUTOMATICO] });

    expect(celdaDe("Rechazadas", "REM-SLA", "Motivo")).toBe(MOTIVO_LARGO);
  });

  it("NO se aplica aquí la variante corta del admin", () => {
    // Éste es el caso del fallo mudo: con `true` fijo en el llamador, la celda diría
    // «Dirección errada» a secas y nadie vería un error — sólo un mensajero creyendo que ese
    // motivo lo escribió él.
    renderModule({ ...emptyGrupos(), rechazada: [RECHAZO_AUTOMATICO] });

    const celda = celdaDe("Rechazadas", "REM-SLA", "Motivo");
    expect(celda).not.toBe(MOTIVO_CORTO);
    expect(celda).toContain("lo rechazó el sistema");
    expect(celda).toContain("plazo de la devolución");
  });

  it("y sigue sin sigla ni value del enum", () => {
    renderModule({ ...emptyGrupos(), rechazada: [RECHAZO_AUTOMATICO] });

    const celda = celdaDe("Rechazadas", "REM-SLA", "Motivo");
    expect(celda).not.toContain("SLA");
    expect(celda).not.toContain("wrong_address");
    expect(celda).not.toContain("escalado");
  });

  it("esta pantalla NO tiene columna «Origen»: por eso el texto tiene que decirlo todo", () => {
    // Si algún día apareciera, la decisión de §2 del diseño habría cambiado y este caso lo
    // diría antes de que el texto largo se convirtiera en un eco.
    renderModule({ ...emptyGrupos(), rechazada: [RECHAZO_AUTOMATICO] });

    const tabla = screen.getByRole("table", { name: "Rechazadas" });
    const encabezados = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(encabezados).not.toContain("Origen");
  });
});

describe("R2 y R3 en la pantalla del mensajero", () => {
  it("el motivo que él escribió sale intacto", () => {
    renderModule({
      ...emptyGrupos(),
      rechazada: [
        makeGestion({
          gestionId: "g-man",
          resultado: "rechazada",
          numRemision: "REM-MAN",
          motivo: MOTIVO_LIBRE,
        }),
      ],
    });

    expect(celdaDe("Rechazadas", "REM-MAN", "Motivo")).toBe(MOTIVO_LIBRE);
  });

  it("una DEVUELTA con la plantilla del cron también se traduce, y con el texto largo", () => {
    // La gestión sintética nace `devuelta` y se escala a `rechazada`, pero la columna «Motivo»
    // es la misma en las cuatro secciones de esta pantalla: ninguna se queda fuera.
    renderModule({
      ...emptyGrupos(),
      devuelta: [
        makeGestion({
          gestionId: "g-dev",
          resultado: "devuelta",
          numRemision: "REM-DEV",
          motivo: "escalado SLA not_found",
        }),
      ],
    });

    expect(celdaDe("Devueltas", "REM-DEV", "Motivo")).toBe(
      "Cliente no localizado · lo rechazó el sistema al vencerse el plazo de la devolución",
    );
  });

  it("un motivo ausente sigue pintando el guion", () => {
    renderModule({
      ...emptyGrupos(),
      rechazada: [
        makeGestion({
          gestionId: "g-sin",
          resultado: "rechazada",
          numRemision: "REM-SIN",
          motivo: null,
        }),
      ],
    });

    expect(celdaDe("Rechazadas", "REM-SIN", "Motivo")).toBe("—");
  });
});
