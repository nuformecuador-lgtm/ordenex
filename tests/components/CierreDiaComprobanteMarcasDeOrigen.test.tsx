// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { CierreDiaModule } from "@/app/(app)/cierre-dia/_components/CierreDiaModule";
import {
  listarCierresPasadosPaginado,
  verCierrePasado,
} from "@/lib/actions/cierre-dia";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierrePasadoDTO,
  CierreResultado,
  CierreTotales,
} from "@/lib/interfaces/services/ICierreDiaService";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

/**
 * FICHA 414 — LA PANTALLA REAL DEL MENSAJERO (R5) Y UN SOLO TEXTO PARA LA MARCA (R9).
 *
 * Este archivo monta `CierreDiaModule`, NO el componente suelto. Su hermano
 * `ComprobanteMensajeroOrigenRechazo.test.tsx` afirma el contrato de `CierreFacturaDetalle`; aquí
 * se afirma lo que el componente suelto no puede: que ESTA pantalla le pase `audiencia="mensajero"`
 * al montarlo. Es la lección «el composition root que no inyecta» — un arreglo perfecto en el
 * componente y una superficie que no lo usa dejan la suite verde y al mensajero con la misma
 * contradicción delante.
 *
 * ── R9, Y POR QUÉ NO VALE UN `grep` NI IMPORTAR LA CONSTANTE
 * La marca «La tienda» vive ahora en el módulo PURO `cierre-labels.ts` y la leen DOS superficies:
 * la tabla EN VIVO de esta pantalla y el COMPROBANTE del cierre pasado. El rótulo y la nota se
 * teclean **una sola vez** aquí abajo y se afirman en las dos: si alguien copiara el literal en
 * `cierre-factura.tsx` con una palabra cambiada, una de las dos aserciones caería. Comparar contra
 * `GESTION_TIENDA_BADGE_*` sería una aserción contra su propia fuente —verde con las palabras
 * rotas—, y un `grep` del código fuente mediría escritura, no comportamiento.
 */

vi.mock("@/lib/actions/cierre-dia", () => ({
  solicitarCierre: vi.fn(),
  listarCierreDia: vi.fn(),
  deshacerGestion: vi.fn(),
  verCierrePasado: vi.fn(),
  listarCierresPasadosPaginado: vi.fn(),
  listarCierresPasadosCompleto: vi.fn(),
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

const verCierrePasadoMock = vi.mocked(verCierrePasado);

// ── LOS LITERALES, TECLEADOS A MANO Y UNA SOLA VEZ ──────────────────────────────────────────

/** R9: el MISMO rótulo y la MISMA nota que tienen que decir las dos superficies. */
const TIENDA_LABEL = "La tienda";
const TIENDA_NOTA =
  "Esta gestión la registró la tienda desde «Ayuda solicitada», no vos: el motivo y la foto son suyos. Cuenta en tu cierre igual.";

/** El distintivo de origen que esta audiencia ya no debe ver (R5). */
const ORIGEN_AUTOMATICO_LABEL = "Automático";
const ORIGEN_AUTOMATICO_NOTA =
  "Rechazo automático por vencerse el plazo de la devolución (no lo hizo el mensajero).";
const ORIGEN_MANUAL_LABEL = "Manual";
const ORIGEN_MANUAL_NOTA = "Rechazo registrado manualmente por el mensajero.";

/** El texto autosuficiente del motivo (408/R11), que aquí hace de control de no-vacuidad. */
const MOTIVO_LARGO =
  "Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución";

/** La cadena EXACTA que el cron de plazos vencidos deja guardada. */
const MOTIVO_GUARDADO_DEL_CRON = "escalado SLA wrong_address";

// ── Semilla ─────────────────────────────────────────────────────────────────────────────────

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

const CIERRE_PASADO: CierrePasadoDTO = {
  cierreId: "c414",
  estado: "aprobado",
  destinoTipo: "bodega_central",
  destinoZonaId: "z1",
  totales: ZERO_TOTALES,
  totalPagoMensajero: "0.00",
  totalIngresoBodegaRechazos: "1500.00",
  solicitadoAt: "2026-09-09T10:00:00.000Z",
  resueltoAt: "2026-09-09T18:00:00.000Z",
  motivoRechazo: null,
};

function emptyGrupos(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] };
}

/**
 * ⚠️ `esRechazoSla` va DESPUÉS del spread y no se puede sobrescribir: `CierreDiaRepository` lo
 * fija en `false` para TODO lo que llega a esta pantalla —en vivo y en el cierre pasado— por
 * decisión expresa de la 102/R11. Un fixture que dijera otra cosa estaría probando un estado que
 * el servidor no produce, y este archivo mide la PANTALLA REAL.
 */
function makeGestion(
  over: Omit<Partial<CierreDetalleGestion>, "esRechazoSla"> & {
    gestionId: string;
    resultado: CierreResultado;
  },
): CierreDetalleGestion {
  return {
    ordenId: `o-${over.gestionId}`,
    fechaGestion: "2026-09-09",
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
    esRechazoSla: false,
  };
}

/** El rechazo que compuso el cron, tal y como llega al comprobante de un cierre pasado. */
function rechazoDelCron(over: Omit<Partial<CierreDetalleGestion>, "esRechazoSla"> = {}) {
  return makeGestion({
    gestionId: "g-cron",
    resultado: "rechazada",
    numGuia: 5555,
    numRemision: "REM-CRON",
    motivo: MOTIVO_GUARDADO_DEL_CRON,
    ingresoBodegaRechazo: "1500.00",
    ...over,
  });
}

function renderModule(grupos: CierreGrupos = emptyGrupos()) {
  const pagina = paginaInicial([CIERRE_PASADO]);
  vi.mocked(listarCierresPasadosPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...pagina,
  });
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CierreDiaModule
        grupos={grupos}
        totales={ZERO_TOTALES}
        totalPagoMensajero="0.00"
        puedesSolicitar
        motivoBloqueo={null}
        cierresPasados={pagina}
        bloqueo={SIN_BLOQUEO}
      />
    </SWRConfig>,
  );
}

/** Abre el comprobante del cierre pasado y devuelve su región. */
async function abrirComprobante(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^Ver del cierre/ }));
  return screen.findByRole("region", { name: "Comprobante detallado de tu cierre" });
}

/** Despliega la fila de una orden DENTRO del comprobante: el bloque sólo existe abierto. */
async function desplegarFila(comprobante: HTMLElement, numRemision: string) {
  const user = userEvent.setup();
  await user.click(
    within(comprobante).getByRole("button", {
      name: `Detalle de la orden ${numRemision} · Ana Pérez`,
    }),
  );
}

/** La `<tr>` de la tabla EN VIVO que lleva ese número de guía. */
function filaEnVivoDeGuia(guia: string): HTMLElement {
  const fila = screen.getByText(guia).closest("tr");
  expect(fila, `no hay ninguna fila en vivo con la guía ${guia}`).not.toBeNull();
  return fila as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ── R5 ──────────────────────────────────────────────────────────────────────────────────────

describe("R5 — el mensajero, en su pantalla, ya no lee la contradicción", () => {
  beforeEach(() => {
    verCierrePasadoMock.mockResolvedValue({
      status: "ok",
      cierre: CIERRE_PASADO,
      grupos: { ...emptyGrupos(), rechazada: [rechazoDelCron()] },
      ordenesSinGestion: [],
      sinGestionRegistrado: true,
    });
  });

  it("la fila del rechazo del cron no lleva el distintivo de origen ni sus notas", async () => {
    renderModule();
    const comprobante = await abrirComprobante();
    await desplegarFila(comprobante, "REM-CRON");

    // Control de no-vacuidad: el bloque desplegado vive dentro de `{open ? … : null}`, así que
    // afirmar una ausencia sin la fila abierta pasaría verde SIN el arreglo.
    expect(
      within(comprobante).getByText(MOTIVO_LARGO),
      "la fila no está desplegada: afirmar una ausencia aquí no probaría nada",
    ).toBeInTheDocument();

    expect(within(comprobante).queryAllByText(ORIGEN_MANUAL_LABEL)).toHaveLength(0);
    expect(within(comprobante).queryAllByText(ORIGEN_AUTOMATICO_LABEL)).toHaveLength(0);
    expect(within(comprobante).queryAllByLabelText(ORIGEN_MANUAL_NOTA)).toHaveLength(0);
    expect(within(comprobante).queryAllByLabelText(ORIGEN_AUTOMATICO_NOTA)).toHaveLength(0);
  });

  it("y la frase que le atribuía el rechazo tampoco queda escondida en un `title`", async () => {
    renderModule();
    const comprobante = await abrirComprobante();
    await desplegarFila(comprobante, "REM-CRON");
    expect(within(comprobante).getByText(MOTIVO_LARGO)).toBeInTheDocument();

    for (const nodo of Array.from(comprobante.querySelectorAll("[title]"))) {
      expect(nodo.getAttribute("title")).not.toBe(ORIGEN_MANUAL_NOTA);
      expect(nodo.getAttribute("title")).not.toBe(ORIGEN_AUTOMATICO_NOTA);
    }
  });

  it("lo que SÍ sigue leyendo es el motivo entero, que se sostiene solo", async () => {
    // Es lo que la 408 dejó puesto y esta ficha no reabre: sin distintivo al lado, el texto del
    // motivo es el ÚNICO portador de que el rechazo no fue suyo.
    renderModule();
    const comprobante = await abrirComprobante();
    await desplegarFila(comprobante, "REM-CRON");

    const rotulo = within(comprobante).getByText("Motivo:");
    const fila = rotulo.parentElement as HTMLElement;
    expect((fila.textContent ?? "").replace("Motivo:", "").trim()).toBe(MOTIVO_LARGO);
  });
});

// ── R9 ──────────────────────────────────────────────────────────────────────────────────────

describe("R9 — la tabla en vivo y el comprobante dicen la marca con las mismas palabras", () => {
  it("el MISMO rótulo y la MISMA nota, en las dos superficies del mismo montaje", async () => {
    // La gestión de la tabla EN VIVO y la del COMPROBANTE son distintas a propósito: lo que se
    // compara no son dos pinturas del mismo dato, son las dos superficies que leen el texto.
    verCierrePasadoMock.mockResolvedValue({
      status: "ok",
      cierre: CIERRE_PASADO,
      grupos: {
        ...emptyGrupos(),
        rechazada: [rechazoDelCron({ desdeAyudaTienda: true })],
      },
      ordenesSinGestion: [],
      sinGestionRegistrado: true,
    });
    renderModule({
      ...emptyGrupos(),
      rechazada: [
        makeGestion({
          gestionId: "g-viva",
          resultado: "rechazada",
          numGuia: 7777,
          numRemision: "REM-VIVA",
          motivo: "La tienda la resolvió desde su portal",
          desdeAyudaTienda: true,
        }),
      ],
    });

    // 1) La tabla EN VIVO, donde la marca existe desde la 237.
    const marcaEnVivo = within(filaEnVivoDeGuia("7777")).getByText(TIENDA_LABEL);
    expect(marcaEnVivo).toHaveAttribute("title", TIENDA_NOTA);
    expect(marcaEnVivo).toHaveAttribute("aria-label", TIENDA_NOTA);

    // 2) El COMPROBANTE del cierre pasado, donde la estrena esta ficha.
    const comprobante = await abrirComprobante();
    await desplegarFila(comprobante, "REM-CRON");

    const marcaEnComprobante = within(comprobante).getByText(TIENDA_LABEL);
    expect(marcaEnComprobante).toHaveAttribute("title", TIENDA_NOTA);
    expect(marcaEnComprobante).toHaveAttribute("aria-label", TIENDA_NOTA);
  });

  it("y en el comprobante la marca convive con el motivo, sin el distintivo de origen", async () => {
    // Las tres piezas de la fila, juntas: la marca dice QUIÉN, el motivo dice POR QUÉ, y el
    // distintivo que mentía ya no está.
    verCierrePasadoMock.mockResolvedValue({
      status: "ok",
      cierre: CIERRE_PASADO,
      grupos: {
        ...emptyGrupos(),
        rechazada: [rechazoDelCron({ desdeAyudaTienda: true })],
      },
      ordenesSinGestion: [],
      sinGestionRegistrado: true,
    });
    renderModule();

    const comprobante = await abrirComprobante();
    await desplegarFila(comprobante, "REM-CRON");

    expect(within(comprobante).getByText(TIENDA_LABEL)).toBeInTheDocument();
    expect(within(comprobante).getByText(MOTIVO_LARGO)).toBeInTheDocument();
    expect(within(comprobante).queryAllByText(ORIGEN_MANUAL_LABEL)).toHaveLength(0);
    expect(within(comprobante).queryAllByText(ORIGEN_AUTOMATICO_LABEL)).toHaveLength(0);
  });
});
