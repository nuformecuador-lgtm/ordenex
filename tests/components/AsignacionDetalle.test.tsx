// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { AsignacionDetalle } from "@/app/(app)/mis-asignaciones/_components/AsignacionDetalle";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 227 (R25) — la nota de la TIENDA (`orden.notas`, columna `orden.notas` del
// schema) es un dato AJENO al hilo de notas que introduce esta feature y al retiro de la
// nota privada del mensajero (R21). El requisito exige literalmente que "su presentación
// actual en el detalle del mensajero se conserva": el detalle sigue pintando el campo con
// su etiqueta.
//
// La mitad de SERVICIO de R25 ("publicar en el hilo no altera la nota de la tienda") vive
// en `tests/unit/services/orden-nota-service.test.ts`. Este archivo cubre la mitad de UI.
//
// `AsignacionDetalle` es un componente de presentación puro (sin fetch, sin router), así
// que se monta en aislado sin mocks.

function makeOrden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "o1",
    numGuia: 1001,
    numRemision: "REM-1",
    estatusValue: "en_reparto",
    destinatario: "Ana",
    telefonoDest: "70001111",
    direccion: "200m sur de la iglesia",
    producto: "Caja",
    peso: 1.2,
    montoCobrar: 25000,
    latitud: 9.93,
    longitud: -84.08,
    notas: null,
    tiendaNombre: "Tienda Norte",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    secuenciaRuta: 1,
    marcarLuego: false,
    intentosEntrega: 0,
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

describe("AsignacionDetalle — nota de la tienda (feature 227/R25)", () => {
  it("R25: el detalle del mensajero sigue mostrando la nota de la TIENDA con su etiqueta", () => {
    const orden = makeOrden({ notas: "Entregar en recepción, preguntar por Marta" });

    render(<AsignacionDetalle orden={orden} />);

    // La etiqueta es un <dt> con su valor en el <dd> hermano: se afirma la PAREJA, no la
    // mera presencia del texto suelto, para que el test muerda si se separan o se renombra
    // el campo.
    const etiqueta = screen.getByText("Notas");
    expect(etiqueta.tagName).toBe("DT");

    const valor = etiqueta.nextElementSibling;
    expect(valor?.tagName).toBe("DD");
    expect(valor).toHaveTextContent("Entregar en recepción, preguntar por Marta");
  });

  it("R25: sin nota de la tienda, el campo se conserva con el marcador de vacío", () => {
    render(<AsignacionDetalle orden={makeOrden({ notas: null })} />);

    const etiqueta = screen.getByText("Notas");
    expect(etiqueta.tagName).toBe("DT");
    expect(etiqueta.nextElementSibling).toHaveTextContent("—");
  });
});
