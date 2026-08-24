// @vitest-environment jsdom
// =================================================================================================
// FEATURE 237 (T7.5 — R40) — CUANDO LA TIENDA RESUELVE, LA ORDEN SALE DEL PORTAL DEL MENSAJERO.
// =================================================================================================
//
// **Dónde vive de verdad este requisito, dicho antes que nada.** R40 se cumple en el SERVIDOR y sin
// escribir una línea nueva: `MisAsignacionesService.listarMisAsignaciones` lee EXACTAMENTE tres
// estatus (`por_recoger`, `en_reparto`, `ayuda_tienda`), así que en cuanto la tienda resuelve —y la
// orden pasa a `reprogramada` o `rechazada`— deja de leerse. Ese corte está afirmado por igualdad
// en `tests/unit/services/mis-asignaciones-service.test.ts` («pide EXACTAMENTE
// `["por_recoger","en_reparto","ayuda_tienda"]`, ni un estado más»), que ya existía y no se tocó.
//
// **Qué añade entonces este archivo, y por qué es un archivo aparte.** Que la PANTALLA no se
// invente lo que el servidor dejó de mandar: la 235 aprendió a la mala que un corte de cliente deja
// la orden viva en el mapa, en la ruta y en el panel de gestión aunque su card desaparezca («el
// corte era MAQUETACIÓN»). Aquí se comprueba lo contrario en las TRES superficies a la vez —card,
// sección y paradas del mapa— sobre el módulo real.
//
// Va en un archivo propio y no dentro de `RepartoAyuda.test.tsx` a propósito: aquel mide el reparto
// entre las dos listas de la 235 y el backend de esta ficha lo dejó constar como VERDE SIN
// MODIFICARSE en su censo de «lo que la 237 no toca» (R49). Añadirle casos invalidaría ese
// registro.
//
// ⚠️ CADA AUSENCIA CON SU PRESENCIA: el caso de «ya no está» comparte fixture con el de «sí está»,
// y la única diferencia entre los dos es qué manda el servidor.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { RepartoModule } from "@/app/(app)/mis-asignaciones/_components/RepartoModule";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn(),
  gestionar: vi.fn(),
  liberarGestion: vi.fn(),
}));

vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
}));

vi.mock("@/lib/actions/orden-notas", () => ({
  listarNotasOrden: vi
    .fn()
    .mockResolvedValue({ status: "ok", notas: [], puedeEscribir: false }),
  publicarNotaOrden: vi.fn(),
  borrarNotaOrden: vi.fn(),
}));

// El mock CAPTURA las paradas, igual que hace `RepartoAyuda.test.tsx`. Sin esto sólo se podría
// afirmar que la card no se ve, que es exactamente lo que el corte de cliente de la 235 conseguía
// mientras la orden seguía siendo parada del optimizador.
const { rutaMapaMock } = vi.hoisted(() => ({ rutaMapaMock: vi.fn() }));
vi.mock("@/app/(app)/mis-asignaciones/_components/RutaMapa", () => ({
  RutaMapa: (props: { paradas: unknown[] }) => {
    rutaMapaMock(props);
    return <div data-testid="ruta-mapa" />;
  },
}));

vi.mock("@/lib/actions/ruta-mensajero", () => ({
  sincronizarRuta: vi.fn().mockResolvedValue({ status: "ok", omitida: false }),
}));

vi.mock("@/lib/actions/orden-mensajero-meta", () => ({
  marcarGestionarLuego: vi.fn(),
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

function asignacion(
  over: Partial<MiAsignacionDTO> & { id: string },
): MiAsignacionDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Perez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: "Dejar en porteria",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San Jose",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: null,
    ...over,
  };
}

const RUTA_VIGENTE: RutaResumenDTO = {
  estado: "vigente",
  calculadaAt: null,
  origenFuente: "gps",
  // Feature 265 (R45): `null` = no consta quien ordeno las paradas. Es lo que exige el tipo,
  // no un test que fallara: sin marca, la pantalla no dice nada del orden.
  secuenciaFuente: null,
  paradasSinOptimizar: 0,
  trazado: null,
  tramoSiguiente: null,
};

/** La orden que la tienda va a resolver. */
const EN_AYUDA = asignacion({
  id: "o-ayuda",
  estatusValue: "ayuda_tienda",
  numGuia: 5555,
  numRemision: "REM-AYUDA",
  destinatario: "Bea Gomez",
});

/** Otra orden cualquiera, para que el portal NUNCA quede vacío y el caso no sea vacuo. */
const OTRA = asignacion({
  id: "o-otra",
  numGuia: 7777,
  numRemision: "REM-OTRA",
  destinatario: "Ana Perez",
});

function renderPortal(conAyuda: MiAsignacionDTO[]) {
  return render(
    <RepartoModule
      porGestionar={[OTRA]}
      conAyuda={conAyuda}
      ordenEnGestionId={null}
      ruta={RUTA_VIGENTE}
      bloqueo={SIN_BLOQUEO}
    />,
  );
}

/** La sección de abajo, por su nombre accesible. `query` para poder afirmar que NO está. */
const seccionAyuda = () =>
  screen.queryByRole("region", { name: "Con ayuda solicitada" });

/** Los ids de las paradas que llegaron al mapa en el último render. */
function paradasDelMapa(): string[] {
  const ultima = rutaMapaMock.mock.calls.at(-1)?.[0] as
    | { paradas: { id: string }[] }
    | undefined;
  return (ultima?.paradas ?? []).map((p) => p.id);
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("237/R40 — la orden resuelta por la tienda desaparece del portal del mensajero", () => {
  it("ANTES: mientras la tienda no ha resuelto, la orden está en el apartado de ayuda", () => {
    renderPortal([EN_AYUDA]);

    const seccion = seccionAyuda();
    expect(seccion).not.toBeNull();
    expect(
      within(seccion as HTMLElement).getByRole("article", { name: /REM-AYUDA/ }),
    ).toBeTruthy();
  });

  it("DESPUÉS: el servidor deja de mandarla y no queda ni en la sección, ni en la lista", () => {
    // Lo único que cambia respecto del caso de arriba es el dato: la orden salió de `ayuda_tienda`
    // hacia `reprogramada`/`rechazada`, y el portal —que lee tres estatus— ya no la trae.
    renderPortal([]);

    // La sección entera se va: no queda un encabezado vacío que sugiera que hay algo pendiente.
    expect(seccionAyuda()).toBeNull();
    // Y la orden no reaparece en el listado principal: el módulo pinta lo que le dan y no reparte
    // nada por su cuenta. Si alguien volviera a derivar el corte en el cliente, aquí saldría.
    expect(screen.queryByRole("article", { name: /REM-AYUDA/ })).toBeNull();
    expect(screen.queryByText("Bea Gomez")).toBeNull();
    // ANTI-VACUIDAD: el portal SÍ pintó algo. Sin esto, las tres ausencias de arriba pasarían
    // igual con el módulo roto y la pantalla en blanco.
    expect(screen.getByRole("article", { name: /REM-OTRA/ })).toBeInTheDocument();
  });

  it("y tampoco vuelve a ser parada del mapa (que es donde la 235 se quemó)", () => {
    renderPortal([]);

    const paradas = paradasDelMapa();
    expect(paradas).not.toContain("o-ayuda");
    // El par positivo: la orden que sigue en reparto SÍ es parada. Sin él, «no está en el mapa»
    // pasaría igual con un mapa que no recibió ninguna parada.
    expect(paradas).toContain("o-otra");
  });
});
