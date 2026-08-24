// @vitest-environment jsdom
// =================================================================================================
// FEATURE 276 (T11 — R8/R9/R10) — EL PANEL DEL MENSAJERO CUANDO A LA ORDEN LE QUEDA EL ÚLTIMO
// INTENTO.
// =================================================================================================
//
// **Qué protege este archivo y ningún test de servidor puede proteger.** La guarda de verdad ya
// existe y está medida: `MisAsignacionesService.gestionar` rechaza `reprogramada` y `devuelta` en
// el tope antes de subir una sola foto (R1/R5/R11, `mis-asignaciones-tope-intentos.test.ts`). Lo
// que el servidor no puede evitar es que el mensajero —de pie en la calle, con el paquete en la
// mano— elija «Reprogramar», teclee la fecha, escriba el motivo y se coma un error. Eso se decide
// aquí, y por eso esto se prueba aquí.
//
// ⚠️ **CADA AUSENCIA, CON SU PRESENCIA.** Afirmar que «Reprogramar» no está pasa en verde también
// si el panel no renderizó nada —o si el paso ni siquiera es el de los resultados—. Todos los casos
// negativos de este archivo comprueban EN EL MISMO CASO que los botones que SÍ deben estar están.
//
// ⚠️ **EL TEXTO DE R9 SE ESCRIBE A MANO, NO CONTRA LA CONSTANTE.** Compararlo contra
// `TOPE_INTENTOS_NOTA` estaría verde el día que alguien lo vacíe o le meta el número del umbral.
// Lo que sí se importa del código es la LISTA compartida (`RESULTADOS_PERMITIDOS_EN_EL_TOPE`), y
// sólo en el caso que afirma que la pantalla y la guarda del servidor leen la misma: ese caso es
// justamente el que denuncia una divergencia, así que ahí importarla es el punto.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GestionarOrdenPanel } from "@/app/(app)/mis-asignaciones/_components/GestionarOrdenPanel";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import {
  RESULTADOS_PERMITIDOS_EN_EL_TOPE,
  permitidoEnElTope,
} from "@/lib/types/tope-intentos";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

vi.mock("@/lib/actions/mis-asignaciones", () => ({
  gestionar: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const gestionarMock = vi.mocked(gestionar);

// --- Los cinco rótulos, escritos a mano. Son el contrato visible del paso 2. --------------------

const ENTREGAR = "Entregar";
const RECHAZAR = "Rechazar";
const REPROGRAMAR = "Reprogramar";
const DEVOLVER = "Devolver";
const INCIDENTE = "Reportar incidente";

/** Los cinco, en el orden en que se pintan. */
const LOS_CINCO = [ENTREGAR, RECHAZAR, REPROGRAMAR, DEVOLVER, INCIDENTE];

/** Rótulo visible de cada `resultado` del contrato. Escrito a mano, a propósito. */
const ROTULO_POR_RESULTADO: Record<string, string> = {
  entregada: ENTREGAR,
  rechazada: RECHAZAR,
  reprogramada: REPROGRAMAR,
  devuelta: DEVOLVER,
  incidente: INCIDENTE,
};

/** La nota de R9, palabra por palabra. */
const NOTA_TOPE =
  "A esta orden le queda el último intento de entrega: ya no se puede reprogramar ni devolver. Registra cómo terminó ahora — entregada o rechazada. Si el paquete se dañó, se perdió o te lo robaron, repórtalo como incidente.";

function makeOrden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "g1",
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: "Dejar en portería",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: 1,
    ...over,
  };
}

/** Monta el panel con el puntero YA FIJADO: arranca directo en el paso de los resultados. */
function montar(over: Partial<MiAsignacionDTO> = {}) {
  render(
    <GestionarOrdenPanel
      orden={makeOrden(over)}
      yaActiva
      onGestionarPedido={vi.fn().mockResolvedValue(true)}
      onCancelarGestion={vi.fn()}
      onSuccess={vi.fn()}
      onAbrirChat={vi.fn()}
      count={1}
    />,
  );
}

/** Los rótulos de los botones de desenlace que hay AHORA en el árbol, en orden de aparición. */
function desenlacesVisibles(): string[] {
  return LOS_CINCO.filter(
    (label) => screen.queryByRole("button", { name: label }) !== null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  gestionarMock.mockResolvedValue({ status: "ok", ordenId: "g1", estado: "entregada" });
});

afterEach(() => {
  cleanup();
});

// =================================================================================================
// R8 — la pantalla no ofrece lo que el servidor va a rechazar
// =================================================================================================

describe("276/R8 — en el tope faltan «Reprogramar» y «Devolver», y sólo esos dos", () => {
  it("con `enElTope: true` no están en el DOM, y los otros TRES sí", async () => {
    montar({ enElTope: true });
    // Control positivo PRIMERO: si el panel no hubiera renderizado el paso de los resultados,
    // este `findByRole` cae y las ausencias de abajo no llegarían a mentir en verde.
    expect(await screen.findByRole("button", { name: ENTREGAR })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: RECHAZAR })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: INCIDENTE })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: REPROGRAMAR })).toBeNull();
    expect(screen.queryByRole("button", { name: DEVOLVER })).toBeNull();
  });

  it("«Reportar incidente» SIGUE VISIBLE: es la decisión 3 del humano, no un desenlace de entrega", async () => {
    montar({ enElTope: true });
    // Y sigue donde estaba (feature 158/R33): en su grupo aparte, no colado en la grilla.
    const grupo = await screen.findByRole("group", {
      name: "Reportar un incidente con el paquete",
    });
    expect(within(grupo).getByRole("button", { name: INCIDENTE })).toBeInTheDocument();
    // Su aviso propio sigue ahí: el bloque no se quedó con el botón y sin la explicación.
    expect(grupo).toHaveTextContent(
      "El paquete ya no se puede entregar ni devolver: está dañado, perdido o robado.",
    );
  });

  it("NO-REGRESIÓN: con `enElTope: false` están los CINCO", async () => {
    montar({ enElTope: false });
    await screen.findByRole("button", { name: ENTREGAR });
    expect(desenlacesVisibles()).toEqual(LOS_CINCO);
  });

  it("NO-REGRESIÓN: con el campo AUSENTE (fixture viejo) también están los cinco", async () => {
    // El DTO lo declara opcional por el patrón aditivo del repo. Ausente NO puede significar
    // «en el tope»: dejaría a media flota sin poder reprogramar el día que un fixture se olvide.
    montar({});
    await screen.findByRole("button", { name: ENTREGAR });
    expect(desenlacesVisibles()).toEqual(LOS_CINCO);
  });

  it("la orden en el tope SIGUE pudiendo terminarse: «Rechazar» abre su formulario", async () => {
    const user = userEvent.setup();
    montar({ enElTope: true });
    await user.click(await screen.findByRole("button", { name: RECHAZAR }));
    // El paso 3 titula con el rótulo del resultado elegido: la vía terminal no quedó rota.
    expect(
      screen.getByRole("heading", { name: RECHAZAR, level: 3 }),
    ).toBeInTheDocument();
  });
});

// =================================================================================================
// R8 — y la lista no se reescribió aquí: es la MISMA que usa la guarda del servidor
// =================================================================================================

describe("276/R8 — la pantalla lee la lista compartida, no una copia", () => {
  it("los desenlaces visibles en el tope son EXACTAMENTE los de la lista de inclusión", async () => {
    montar({ enElTope: true });
    await screen.findByRole("button", { name: ENTREGAR });

    const esperados = LOS_CINCO.filter((label) =>
      RESULTADOS_PERMITIDOS_EN_EL_TOPE.some((r) => ROTULO_POR_RESULTADO[r] === label),
    );
    expect(desenlacesVisibles()).toEqual(esperados);
  });

  it("y los que faltan son EXACTAMENTE los que la lista niega", async () => {
    montar({ enElTope: true });
    await screen.findByRole("button", { name: ENTREGAR });

    const negados = (["entregada", "rechazada", "reprogramada", "devuelta", "incidente"] as const)
      .filter((r) => !permitidoEnElTope(r))
      .map((r) => ROTULO_POR_RESULTADO[r]);
    // Hoy son dos; el día que la lista cambie, este caso y el de arriba se mueven juntos —y el
    // literal de `tope-intentos.test.ts` obliga a que ese cambio sea una decisión, no un descuido.
    expect(negados).toEqual([REPROGRAMAR, DEVOLVER]);
    for (const label of negados) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });
});

// =================================================================================================
// R9 — y se dice por qué
// =================================================================================================

describe("276/R9 — el hueco se explica con palabras, no con un color", () => {
  it("en el tope aparece la nota, TAL CUAL", async () => {
    montar({ enElTope: true });
    await screen.findByRole("button", { name: ENTREGAR });
    expect(screen.getByRole("note")).toHaveTextContent(NOTA_TOPE);
  });

  it("dice las dos cosas que hacen falta: qué ya no se puede y qué sí se puede registrar", async () => {
    montar({ enElTope: true });
    const nota = await screen.findByRole("note");
    // No es una fórmula vaga («no disponible»): nombra los dos desenlaces retirados y los tres
    // que quedan. Si alguien lo cambia por «Acción no permitida», estas cinco caen.
    expect(nota).toHaveTextContent("ya no se puede reprogramar ni devolver");
    expect(nota).toHaveTextContent("entregada o rechazada");
    expect(nota).toHaveTextContent("repórtalo como incidente");
  });

  it("y NO aparece cuando la orden no está en el tope (control positivo al lado)", async () => {
    montar({ enElTope: false });
    // La presencia que demuestra que el paso 2 SÍ se renderizó...
    expect(await screen.findByRole("button", { name: REPROGRAMAR })).toBeInTheDocument();
    // ...y sólo entonces, la ausencia.
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/último intento de entrega/)).toBeNull();
  });
});

// =================================================================================================
// R10 — el umbral no cruza al cliente
// =================================================================================================

describe("276/R10 — la nota no lleva el número del umbral, ni de lejos", () => {
  it("no contiene NINGUNA cifra (ni «3», ni «2 de 3», ni «te queda 1»)", async () => {
    montar({ enElTope: true });
    const nota = await screen.findByRole("note");
    expect(nota.textContent ?? "").not.toMatch(/\d/);
  });

  it("contrato: el panel no importa ni nombra la configuración del umbral", () => {
    // Mismo molde que `intentos-entrega.test.tsx:166` (feature 160/R20). Un `import` de
    // `reintentosConfig` en un Client Component se lleva la configuración al navegador.
    const fuente = readFileSync(
      resolve(
        process.cwd(),
        "app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx",
      ),
      "utf8",
    );
    expect(fuente).not.toContain("reintentosConfig");
    expect(fuente).not.toContain("MIN_INTENTOS_ENTREGA");
    expect(fuente).not.toContain("lib/config/reintentos");
  });
});
