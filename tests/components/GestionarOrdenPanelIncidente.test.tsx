// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GestionarOrdenPanel } from "@/app/(app)/mis-asignaciones/_components/GestionarOrdenPanel";
import { CAUSA_INCIDENTE_OPTIONS } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 158 (T2.1 — R33/R12/R9/R10/R11) — el QUINTO resultado del panel del mensajero:
// "Reportar incidente". Se prueba el panel AISLADO (la Server Action `gestionar`, el toast y
// el router se mockean) para afirmar la UI y el FormData sin DB ni sesión.
//
// Lo que este archivo protege y no protege ningún test de backend:
//   - que la opción EXISTE y está DIFERENCIADA de los cuatro desenlaces normales (R33);
//   - que el gate de verificación de guía sigue siendo la puerta de entrada, también para el
//     incidente (R12) — el gate es 100 % frontend, no tiene contraparte en `lib/`;
//   - que la foto se exige en las TRES causas (Q-B) y que el copy dice QUÉ fotografiar cuando
//     no hay paquete: la decisión del humano tiene un coste y la UI no puede disimularlo;
//   - que un envío inválido NO llega a la action (validación en cliente con el MISMO schema).
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  gestionar: vi.fn(),
}));

// El panel monta `NotaPrivadaMensajero` (router + Server Actions con Prisma detrás).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/actions/notas-privadas-mensajero", () => ({
  guardarNotaPrivada: vi.fn(),
  limpiarNotaPrivada: vi.fn(),
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

const NUM_GUIA = 1001;
const BOTON_INCIDENTE = "Reportar incidente";
const LABEL_FOTO_INCIDENTE = "Foto de evidencia del incidente";
const GRUPO_CAUSA = "Causa del incidente";

function makeOrden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "g1",
    numGuia: NUM_GUIA,
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

/** File-imagen pequeño (el compresor lo devuelve tal cual por tamaño). */
function foto(nombre: string): File {
  return new File(["x"], nombre, { type: "image/jpeg" });
}

/** Monta el panel. `yaActiva` = puntero 1-a-1 ya fijado (arranca en los resultados). */
function montar(yaActiva: boolean, onGestionarPedido = vi.fn().mockResolvedValue(true)) {
  render(
    <GestionarOrdenPanel
      orden={makeOrden()}
      yaActiva={yaActiva}
      onGestionarPedido={onGestionarPedido}
      onCancelarGestion={vi.fn()}
      onSuccess={vi.fn()}
      count={1}
    />,
  );
  return onGestionarPedido;
}

/** Monta con el puntero fijado y abre la rama `incidente`. */
async function abrirIncidente(user: ReturnType<typeof userEvent.setup>) {
  montar(true);
  await user.click(await screen.findByRole("button", { name: BOTON_INCIDENTE }));
}

/** Rellena la rama de incidente; cada parte es opcional para poder aislar el error. */
async function rellenar(
  user: ReturnType<typeof userEvent.setup>,
  opts: { causa?: string; motivo?: string; fotos?: number } = {},
) {
  if (opts.causa) {
    await user.click(screen.getByRole("radio", { name: opts.causa }));
  }
  if (opts.fotos) {
    await user.upload(
      screen.getByLabelText(LABEL_FOTO_INCIDENTE),
      Array.from({ length: opts.fotos }, (_, i) => foto(`f${i}.jpg`)),
    );
    await vi.waitFor(() =>
      expect(
        within(
          screen.getByRole("list", { name: "Fotos de evidencia seleccionadas" }),
        ).getAllByRole("img"),
      ).toHaveLength(opts.fotos as number),
    );
  }
  if (opts.motivo) {
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: opts.motivo } });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  gestionarMock.mockResolvedValue({ status: "ok", ordenId: "g1", estado: "incidente" });
});

afterEach(() => {
  cleanup();
});

describe("R33 — la opción de incidente existe y está DIFERENCIADA de los 4 desenlaces", () => {
  it("ofrece 'Reportar incidente' junto a los cuatro resultados existentes", async () => {
    montar(true);
    await screen.findByRole("button", { name: "Entregar" });

    for (const label of ["Entregar", "Rechazar", "Reprogramar", "Devolver", BOTON_INCIDENTE]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("el incidente vive FUERA del bloque de desenlaces normales, en su propio grupo", async () => {
    montar(true);
    const grupo = await screen.findByRole("group", {
      name: "Reportar un incidente con el paquete",
    });
    // El botón del incidente está DENTRO de ese grupo...
    expect(within(grupo).getByRole("button", { name: BOTON_INCIDENTE })).toBeInTheDocument();
    // ...y ninguno de los cuatro desenlaces normales lo está (si alguien lo mete en la
    // grilla, este caso se pone rojo).
    for (const label of ["Entregar", "Rechazar", "Reprogramar", "Devolver"]) {
      expect(within(grupo).queryByRole("button", { name: label })).toBeNull();
    }
  });

  it("la diferencia NO se comunica sólo por color: hay texto que explica cuándo aplica", async () => {
    montar(true);
    const grupo = await screen.findByRole("group", {
      name: "Reportar un incidente con el paquete",
    });
    expect(grupo).toHaveTextContent(
      "El paquete ya no se puede entregar ni devolver: está dañado, perdido o robado.",
    );
  });
});

describe("R12 — el gate de verificación de guía sigue siendo la puerta, también del incidente", () => {
  it("sin verificar la guía NO se ofrece ningún resultado, tampoco el incidente", async () => {
    montar(false);
    // El panel arranca en el paso "detalle": sólo el gate.
    expect(
      await screen.findByRole("region", {
        name: "Verificar la guía del paquete antes de gestionar",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BOTON_INCIDENTE })).toBeNull();
    for (const label of ["Entregar", "Rechazar", "Reprogramar", "Devolver"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });

  it("una guía que NO coincide deja el incidente inaccesible (no se fija el puntero)", async () => {
    const user = userEvent.setup();
    const onGestionarPedido = montar(false);

    fireEvent.change(screen.getByLabelText("Número de guía"), {
      target: { value: String(NUM_GUIA + 1) },
    });
    await user.click(screen.getByRole("button", { name: "Gestionar" }));

    expect(onGestionarPedido).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: BOTON_INCIDENTE })).toBeNull();
  });

  it("con la guía CORRECTA el incidente queda disponible", async () => {
    const user = userEvent.setup();
    const onGestionarPedido = montar(false);

    fireEvent.change(screen.getByLabelText("Número de guía"), {
      target: { value: String(NUM_GUIA) },
    });
    await user.click(screen.getByRole("button", { name: "Gestionar" }));

    await vi.waitFor(() => expect(onGestionarPedido).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", { name: BOTON_INCIDENTE }),
    ).toBeInTheDocument();
  });
});

describe("R9 — la causa es una lista CERRADA de 3, con etiqueta en español", () => {
  it("muestra exactamente las 3 causas del SEED, con su etiqueta y sin slugs crudos", async () => {
    const user = userEvent.setup();
    await abrirIncidente(user);

    const grupo = screen.getByRole("radiogroup", { name: GRUPO_CAUSA });
    expect(within(grupo).getAllByRole("radio")).toHaveLength(CAUSA_INCIDENTE_SEED.length);
    expect(CAUSA_INCIDENTE_SEED).toHaveLength(3);
    for (const { label } of CAUSA_INCIDENTE_OPTIONS) {
      expect(within(grupo).getByRole("radio", { name: label })).toBeInTheDocument();
    }
    // Las etiquetas llevan su acentuación y NINGUNA es el value crudo del enum. Se comprueba
    // con el value SIN tilde (`danado`), que es el único que difiere textualmente de su
    // etiqueta: `perdido`/`robado` aparecen DENTRO de "Paquete perdido"/"Paquete robado", así
    // que buscarlos sueltos daría un falso rojo.
    expect(grupo).toHaveTextContent("Paquete dañado");
    expect(grupo.textContent).not.toMatch(/danado/);
    for (const { value, label } of CAUSA_INCIDENTE_OPTIONS) {
      expect(label, `la etiqueta de ${value} es el slug crudo`).not.toBe(value);
    }
  });

  it("sin causa elegida NO llama a la action y marca el campo de la causa", async () => {
    const user = userEvent.setup();
    await abrirIncidente(user);
    // Motivo y foto válidos: así el único error posible es la causa.
    await rellenar(user, { motivo: "El paquete llegó aplastado", fotos: 1 });

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    expect(gestionarMock).not.toHaveBeenCalled();
    expect(screen.getByRole("radiogroup", { name: GRUPO_CAUSA })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getAllByRole("alert").some((a) => /causa requerida/i.test(a.textContent ?? "")),
    ).toBe(true);
  });

  it("cambiar de resultado y volver al incidente NO arrastra la causa anterior", async () => {
    const user = userEvent.setup();
    await abrirIncidente(user);
    await user.click(screen.getByRole("radio", { name: "Paquete robado" }));
    expect(screen.getByRole("radio", { name: "Paquete robado" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Atrás" }));
    await user.click(await screen.findByRole("button", { name: BOTON_INCIDENTE }));

    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
  });

  it("el selector de causa del incidente NO aparece en los otros cuatro resultados", async () => {
    for (const rama of ["Entregar", "Reprogramar", "Rechazar", "Devolver"]) {
      const user = userEvent.setup();
      montar(true);
      await user.click(await screen.findByRole("button", { name: rama }));
      expect(screen.queryByRole("radiogroup", { name: GRUPO_CAUSA })).toBeNull();
      cleanup();
    }
  });
});

describe("R10 (Q-B) — la foto se exige en las TRES causas, también sin paquete", () => {
  it.each(CAUSA_INCIDENTE_OPTIONS.map((o) => [o.value, o.label] as const))(
    "causa `%s`: sin ninguna foto NO llama a la action y marca el campo",
    async (_value, label) => {
      const user = userEvent.setup();
      await abrirIncidente(user);
      await rellenar(user, { causa: label, motivo: "Reporte del incidente" });

      await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

      expect(gestionarMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText(LABEL_FOTO_INCIDENTE)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      cleanup();
    },
  );

  it("el copy dice QUÉ fotografiar cuando no hay paquete (perdido/robado)", async () => {
    const user = userEvent.setup();
    await abrirIncidente(user);

    const input = screen.getByLabelText(LABEL_FOTO_INCIDENTE);
    const ayudaId = input.getAttribute("aria-describedby");
    expect(ayudaId, "el input de fotos no describe su ayuda").toBeTruthy();
    const ayuda = document.getElementById(ayudaId as string);
    const texto = ayuda?.textContent ?? "";

    // No basta con "campo requerido": el mensajero está en la calle y necesita saber qué
    // se espera de él. Se exige que el copy nombre alternativas concretas.
    expect(texto).toMatch(/perdi|rob/i);
    expect(texto).toMatch(/veh[íi]culo|compartimento/i);
    expect(texto).toMatch(/gu[íi]a|etiqueta/i);
    expect(texto).toMatch(/denuncia|lugar/i);
  });

  it("acepta varias fotos (1..N), igual que el resto de resultados con evidencia", async () => {
    const user = userEvent.setup();
    await abrirIncidente(user);
    expect(screen.getByLabelText(LABEL_FOTO_INCIDENTE)).toHaveAttribute("multiple");

    await rellenar(user, { causa: "Paquete dañado", motivo: "Caja rota", fotos: 2 });
    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.getAll("evidencia")).toHaveLength(2);
  });
});

describe("R11 — el motivo libre sigue obligatorio y APARTE de la causa", () => {
  it("sin motivo NO llama a la action, aunque la causa y la foto estén", async () => {
    const user = userEvent.setup();
    await abrirIncidente(user);
    await rellenar(user, { causa: "Paquete perdido", fotos: 1 });

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    expect(gestionarMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Motivo")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("R33 — el envío válido manda el FormData esperado", () => {
  it("envía resultado, causa, motivo y las fotos; SIN campos de recaudo", async () => {
    const user = userEvent.setup();
    await abrirIncidente(user);

    // Un incidente no recauda: la rama no ofrece método de pago (la orden del fixture SÍ
    // tiene `montoCobrar`, así que el selector aparecería si la rama fuese la de entrega).
    expect(screen.queryByLabelText("Método de pago")).toBeNull();

    await rellenar(user, {
      causa: "Paquete robado",
      motivo: "Asalto en la parada; se levantó la denuncia",
      fotos: 1,
    });
    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("ordenId")).toBe("g1");
    expect(fd.get("resultado")).toBe("incidente");
    // El value que viaja es el del SEED (español, sin tilde), NO la etiqueta visible.
    expect(fd.get("causaIncidente")).toBe("robado");
    expect(fd.get("motivo")).toBe("Asalto en la parada; se levantó la denuncia");
    expect(fd.getAll("evidencia")).toHaveLength(1);
    expect(fd.get("montoRecibido")).toBeNull();
    expect(fd.get("metodoPago")).toBeNull();
    expect(successMock).toHaveBeenCalled();
  });

  it("los `validation_error` del servidor se pintan por campo, sin perderse en un toast", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { causaIncidente: ["causa requerida"] },
    });
    await abrirIncidente(user);
    await rellenar(user, { causa: "Paquete dañado", motivo: "Caja rota", fotos: 1 });

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(
        screen.getAllByRole("alert").some((a) => /causa requerida/i.test(a.textContent ?? "")),
      ).toBe(true),
    );
  });
});

describe("R33 — cliente y servidor validan con el MISMO esquema", () => {
  const RAIZ = path.join(__dirname, "..", "..");

  it("el panel valida con `gestionarSchema`, el mismo módulo que parsea el borde", () => {
    const panel = fs.readFileSync(
      path.join(RAIZ, "app", "(app)", "mis-asignaciones", "_components", "GestionarOrdenPanel.tsx"),
      "utf8",
    );
    const action = fs.readFileSync(
      path.join(RAIZ, "lib", "actions", "mis-asignaciones.ts"),
      "utf8",
    );

    // Los dos importan del MISMO módulo de tipos y los dos lo usan para validar.
    expect(panel).toMatch(/import \{ gestionarSchema \} from "@\/lib\/types\/gestion-orden"/);
    expect(panel).toMatch(/gestionarSchema\.safeParse\(/);
    expect(action).toMatch(/from "@\/lib\/types\/gestion-orden"/);
    expect(action).toMatch(/gestionarSchema\.(parse|safeParse)\(/);

    // Y el panel NO define un schema paralelo para el incidente: si alguien duplica las
    // reglas en el cliente, cliente y servidor pueden divergir en silencio.
    expect(panel).not.toMatch(/z\.object\(|z\.enum\(/);
  });
});
