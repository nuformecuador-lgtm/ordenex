// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DetalleSecciones,
  ORDEN_RESULTADOS,
  RESULTADO_LABEL,
  RESULTADO_VACIO,
  columnasPara,
} from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  IngresoOrdenexDTO,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 158 (T2.3 — R18/R17) — el grupo "Incidentes" en el detalle COMPARTIDO por los
// módulos de admin (`CierresAdminModule` de la 38 y los de bodega de la 40). Lo que protege:
//   - el grupo existe, está etiquetado en español y va AL FINAL del orden fijo (R18);
//   - sus columnas son las suyas y NO las de un rechazo: sin origen SLA/manual, sin conceptos
//     de ingreso de Ordenex, sin pago al mensajero y sin ingreso de bodega (R17);
//   - la evidencia se abre con la URL FIRMADA, como en el resto.
//
// ⚠️ Deuda declarada (ver `progress/impl_158_frontend.md`): la CAUSA tipificada y el MONTO de
// la indemnización NO se pintan porque no viajan en `CierreDetalleGestion`. Exponerlos es
// trabajo de backend (DTO + repo + service) y esta fase no toca `lib/`. Hay un caso abajo que
// FIJA el hueco, para que aparezca en rojo el día que el DTO los traiga y nadie los pinte.

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
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
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
    render(
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
    render(<DetalleSecciones grupos={emptyGrupos()} onVerEvidencia={() => {}} />);
    expect(screen.queryByRole("region", { name: "Incidentes" })).toBeNull();
  });

  it("la evidencia se abre con la URL FIRMADA que llega del servidor", async () => {
    const user = userEvent.setup();
    let abierta: string | null = null;
    render(
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
    render(
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
    render(
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
      "motivo",
      "evidencia",
    ]);
  });
});

// --- Deuda declarada: la causa tipificada y el monto de la indemnización ---
//
// `tasks.md` T2.3 pide además las columnas de CAUSA y de MONTO. No se pueden pintar: el DTO
// `CierreDetalleGestion` no las trae (igual que tampoco trae la `causaDevolucion` de la 73),
// y poblarlas exige tocar repo + service, que es backend y no es el alcance de esta fase.
//
// El candado NO es una nota en un comentario: es el compilador. Si el DTO gana cualquiera de
// los dos campos, estos alias pasan a `never` y `pnpm run typecheck` —que corre en
// `./init.sh`— ROMPE, obligando a completar las columnas en vez de dejar el dato invisible.
type _SinCausaEnElDto = "causaIncidente" extends keyof CierreDetalleGestion ? never : true;
type _SinMontoEnElDto = "indemnizacion" extends keyof CierreDetalleGestion ? never : true;
const _sinCausa: _SinCausaEnElDto = true;
const _sinMonto: _SinMontoEnElDto = true;

describe("Deuda declarada — causa y monto de la indemnización todavía no viajan en el DTO", () => {
  it("el hueco está fijado por tipos: si el DTO los gana, el build rompe", () => {
    expect(_sinCausa).toBe(true);
    expect(_sinMonto).toBe(true);
    // Y mientras no viajen, tampoco se inventa una columna vacía que parecería un dato
    // ausente en vez de un dato que no existe.
    const columnas = columnasPara("incidente", () => {}).map((c) => c.id);
    expect(columnas).not.toContain("causaIncidente");
    expect(columnas).not.toContain("indemnizacion");
  });
});
