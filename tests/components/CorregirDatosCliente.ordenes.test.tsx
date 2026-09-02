// @vitest-environment jsdom
// =================================================================================================
// FICHA 312 (E3 — R6/R22/R24/R26/R27/R28/R29/R30) — LA SUPERFICIE DEL MODULO DE ORDENES.
// =================================================================================================
//
// **Que protege este archivo, en una linea:** que la pantalla no ofrezca lo que el servidor va a
// rechazar, y que lo que avisa antes de confirmar sea cierto.
//
// Los tres frentes, y por que cada uno:
//
//  · **El disparador no aparece** en los cuatro estados de la ventana cerrada (D3) ni cuando el
//    estado no se conoce (R22/R24). Un boton visible que el servidor rechaza es una invitacion al
//    error; y la AUSENCIA DE DATO no habilita nada, que es lo contrario de lo que hace un
//    `!ESTADOS.includes(x)` ingenuo —con `undefined` diria «adelante»—.
//  · **Los dos avisos son CONDICIONALES** (R27/R28). Un aviso que sale siempre no es un aviso: es
//    ruido que se aprende a ignorar, y el dia que importe nadie lo leera. Por eso cada uno se mide
//    con su par presencia/ausencia en el MISMO archivo.
//  · **Un rechazo conserva lo tecleado** (R30) y no filtra ni un identificador. El `forbidden` del
//    servidor es OPACO a proposito (R12): cuatro causas distintas devuelven el mismo objeto.
//
// ⚠️ **La Server Action va MOCKEADA** (es un modulo `"use server"`: importarlo de verdad arrastraria
// Prisma a jsdom). Lo que se mide aqui es el contrato de PANTALLA; que la accion autorice de verdad
// lo miden `corregir-datos-cliente-service.test.ts` y `corregir-datos-cliente.repo.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CorregirDatosClienteAccion,
  CORREGIR_DATOS_ACCION_LABEL,
} from "@/app/(app)/ordenes/_components/CorregirDatosClienteAccion";
import {
  CORREGIR_TITULO,
  CORREGIR_CONFIRMAR,
  CORREGIR_PROVINCIA_LABEL,
  CORREGIR_CANTON_LABEL,
  CORREGIR_DISTRITO_LABEL,
  CORREGIR_UBICACION_CARGANDO,
  CORREGIR_UBICACION_FALLO,
} from "@/app/(app)/ordenes/_components/CorregirDatosClienteModal";
import {
  AVISO_TITULO,
  AVISO_CONFIRMAR,
  AVISO_SIN_TARIFA,
  AVISO_YA_EN_UN_CIERRE,
  AVISO_COL_ACTUAL,
  AVISO_COL_PROPUESTA,
  avisoEspecialSinPacto,
} from "@/app/(app)/ordenes/_components/CorregirUbicacionAviso";
import type { AvisoCambioUbicacion } from "@/lib/interfaces/services/ICorregirDatosClienteService";
import { ESTADOS_SIN_CORRECCION } from "@/lib/types/correccion-datos-cliente";
import type { OrdenListItemDTO } from "@/lib/types/orden";

const corregirDatosClienteMock = vi.fn();
const obtenerUbicacionOrdenMock = vi.fn();
vi.mock("@/lib/actions/corregir-datos-cliente", () => ({
  corregirDatosCliente: (...args: unknown[]) => corregirDatosClienteMock(...args),
  // FICHA 327 (R31) — la PRECARGA que la ventana pide al abrirse. Si faltara del mock, vitest
  // lanzaria al resolver el import y este archivo no dejaria un caso rojo: dejaria CERO casos.
  obtenerUbicacionOrden: (...args: unknown[]) => obtenerUbicacionOrdenMock(...args),
}));

const obtenerCatalogoMock = vi.fn();
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: (...args: unknown[]) => obtenerCatalogoMock(...args),
}));

const mutateMock = vi.fn();
// `useSWR` REAL —el catalogo geografico pasa por el, con la accion ya mockeada arriba— y SOLO
// `useSWRConfig` sustituido. Mockear el modulo entero dejaria el catalogo sin cargar nunca, los
// tres desplegables vacios, y los casos de encadenamiento pasarian en verde sin medir nada.
vi.mock("swr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("swr")>()),
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  show: vi.fn(),
  dismiss: vi.fn(),
};
vi.mock("@/hooks/useToast", () => ({ useToast: () => toastMock }));

const ORDEN_ID = "0f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f";
const DISPARADOR = `${CORREGIR_DATOS_ACCION_LABEL} de la orden REM-001`;

function orden(over: Partial<OrdenListItemDTO> = {}): OrdenListItemDTO {
  return {
    id: ORDEN_ID,
    numRemision: "REM-001",
    numGuia: null,
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "8888-7777",
    producto: "Zapatos negros",
    notas: "Dejar con el guarda",
    tiendaNombre: "Tienda X",
    ...over,
  } as unknown as OrdenListItemDTO;
}

// -------------------------------------------------------------------------------------------------
// FICHA 327 — LOS FIXTURES DE LA UBICACION
// -------------------------------------------------------------------------------------------------
//
// La geografia se declara con DOS provincias, TRES cantones y CUATRO distritos a proposito: con una
// sola rama, «elegir provincia recorta los cantones» pasaria en verde con un componente que no
// recorta nada. El encadenamiento solo se puede medir si hay algo que dejar fuera.

const PROVINCIAS = [
  { id: "prov-sj", nombre: "San José" },
  { id: "prov-al", nombre: "Alajuela" },
];
const CANTONES = [
  { id: "can-escazu", nombre: "Escazú", padreId: "prov-sj" },
  { id: "can-desamp", nombre: "Desamparados", padreId: "prov-sj" },
  { id: "can-alajuela", nombre: "Alajuela centro", padreId: "prov-al" },
];
const DISTRITOS = [
  { id: "dis-san-rafael", nombre: "San Rafael", padreId: "can-escazu" },
  { id: "dis-san-antonio", nombre: "San Antonio", padreId: "can-escazu" },
  { id: "dis-patarra", nombre: "Patarrá", padreId: "can-desamp" },
  { id: "dis-la-garita", nombre: "La Garita", padreId: "can-alajuela" },
];

const CATALOGO_OK = {
  status: "ok" as const,
  catalogo: {
    zonas: [],
    tiendas: [],
    mensajeros: [],
    provincias: PROVINCIAS,
    cantones: CANTONES,
    distritos: DISTRITOS,
  },
};

/** Los NUEVE valores actuales que devuelve la precarga (R31). */
function ubicacion(over: Record<string, unknown> = {}) {
  return {
    status: "ok" as const,
    orden: {
      ordenId: ORDEN_ID,
      destinatario: "Ana Pérez",
      telefonoDest: "8888-7777",
      producto: "Zapatos negros",
      notas: "Dejar con el guarda",
      direccion: "Av. Central 120, portón verde",
      peso: 1.5,
      provinciaId: "prov-sj",
      cantonId: "can-escazu",
      distritoId: "dis-san-rafael",
      zonaNombre: "GAM Oeste",
      distritoNombre: "San Rafael",
      numGuia: null,
      yaEnUnCierre: false,
      ...over,
    },
  };
}

/**
 * 💰 El aviso del servidor. Los importes llevan CENTIMOS a proposito: asi el caso deja escrito, en
 * el propio test, como se pinta en esta pantalla un importe con cola decimal.
 */
function aviso(over: Partial<AvisoCambioUbicacion> = {}): AvisoCambioUbicacion {
  return {
    actual: {
      zonaId: "zona-oeste",
      zonaNombre: "GAM Oeste",
      distritoNombre: "San Rafael",
      esCentral: true,
      esZonaEspecial: false,
      tarifa: "resuelta",
      fleteConIva: "2825.40",
      comisionConIva: "1130.00",
      fleteOrigen: "normal",
    },
    propuesta: {
      zonaId: "zona-cartago",
      zonaNombre: "Cartago",
      distritoNombre: "Patarrá",
      esCentral: false,
      esZonaEspecial: false,
      tarifa: "resuelta",
      fleteConIva: "4520.00",
      comisionConIva: "1130.00",
      fleteOrigen: "normal",
    },
    yaEnUnCierre: false,
    ...over,
  };
}

/**
 * Abre la ventana sobre esa orden y devuelve el `user` para seguir tecleando.
 *
 * ⚠️ **ESPERA A QUE LA PRECARGA TERMINE** (R31). Sin esta espera, los casos tocarian el formulario
 * mientras los controles de ubicacion siguen deshabilitados, y la respuesta que llega despues
 * pisaria lo tecleado — un flake que solo aparece bajo carga, que es la peor clase.
 */
async function abrir(over: Partial<OrdenListItemDTO> = {}, onSuccess?: () => void) {
  const user = userEvent.setup();
  render(<CorregirDatosClienteAccion orden={orden(over)} onSuccess={onSuccess} />);
  await user.click(screen.getByRole("button", { name: DISPARADOR }));
  expect(await screen.findByText(CORREGIR_TITULO)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(CORREGIR_UBICACION_CARGANDO)).toBeNull());
  return user;
}

function campo(nombre: RegExp): HTMLInputElement | HTMLTextAreaElement {
  return screen.getByLabelText(nombre) as HTMLInputElement | HTMLTextAreaElement;
}

function combo(nombre: string): HTMLElement {
  return screen.getByRole("combobox", { name: nombre });
}

/** Elige una opción en uno de los tres desplegables encadenados. */
async function elegir(
  user: ReturnType<typeof userEvent.setup>,
  nombre: string,
  opcion: string,
) {
  await user.click(combo(nombre));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: opcion }));
}

/** Cambia el distrito a uno de OTRO cantón: el gesto que dispara el gate del dinero. */
async function cambiarDistrito(user: ReturnType<typeof userEvent.setup>) {
  await elegir(user, CORREGIR_CANTON_LABEL, "Desamparados");
  await elegir(user, CORREGIR_DISTRITO_LABEL, "Patarrá");
}

beforeEach(() => {
  vi.clearAllMocks();
  corregirDatosClienteMock.mockResolvedValue({ status: "ok", cambios: ["destinatario"] });
  obtenerUbicacionOrdenMock.mockResolvedValue(ubicacion());
  obtenerCatalogoMock.mockResolvedValue(CATALOGO_OK);
});
afterEach(cleanup);

// =================================================================================================
// R22 / R24 — LA VENTANA DE ESTADO, EN LA PANTALLA
// =================================================================================================

describe("312/R22 — el disparador sólo aparece donde el servidor aceptaría", () => {
  it.each([...ESTADOS_SIN_CORRECCION])(
    "en `%s` NO renderiza NADA (ni un botón deshabilitado)",
    (estado) => {
      const { container } = render(
        <CorregirDatosClienteAccion orden={orden({ estatusValue: estado })} />,
      );
      expect(screen.queryByRole("button")).toBeNull();
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("R24 — FALLO CERRADO: sin `estatusValue` tampoco renderiza nada", () => {
    // La ausencia de dato NO habilita. Es el caso que un `!ESTADOS.includes(x)` ingenuo dejaría
    // pasar: con `undefined` diría «adelante» sobre una orden de la que no se sabe el estado.
    const { container } = render(
      <CorregirDatosClienteAccion orden={orden({ estatusValue: undefined })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("y el CONTROL POSITIVO: en `en_reparto` sí se ofrece", () => {
    // Sin esto, las cinco ausencias de arriba pasarían igual con el componente devolviendo `null`
    // siempre — que es exactamente cómo se cuela un disparador muerto.
    render(<CorregirDatosClienteAccion orden={orden({ estatusValue: "en_reparto" })} />);
    expect(screen.getByRole("button", { name: DISPARADOR })).toBeInTheDocument();
  });

  it("la superficie puede negarla aunque el estado la admita (rol sin acceso)", () => {
    // `disponible={false}` es el criterio de ROL, que vive en la página. Se combina con `&&`: el
    // estado se consulta SIEMPRE, y ninguno de los dos puede saltarse al otro.
    const { container } = render(
      <CorregirDatosClienteAccion orden={orden({ estatusValue: "en_reparto" })} disponible={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// =================================================================================================
// R26 / R6 — LO QUE LA VENTANA TRAE DENTRO
// =================================================================================================

describe("312/R26 — la ventana abre con los cuatro valores actuales", () => {
  it("precarga destinatario, teléfono, producto y notas de ESA orden", async () => {
    await abrir();
    expect(campo(/^Destinatario$/).value).toBe("Ana Pérez");
    expect(campo(/Teléfono/).value).toBe("8888-7777");
    expect(campo(/^Producto$/).value).toBe("Zapatos negros");
    expect(campo(/^Notas$/).value).toBe("Dejar con el guarda");
  });

  it("R6: un producto de 5.000 caracteres NO produce error de cliente", async () => {
    // P3, cerrada el 2026-08-28: sin tope propio, igual que la carga masiva. Un tope que la carga
    // no tiene produciría el caso absurdo «se pudo cargar pero no se puede corregir».
    const user = await abrir();
    const largo = "x".repeat(5000);
    fireEvent.change(campo(/^Producto$/), { target: { value: largo } });
    expect(campo(/^Producto$/).value).toHaveLength(5000);

    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(corregirDatosClienteMock).toHaveBeenCalledTimes(1));
    // Llegó ENTERO al servidor: ni recortado por la pantalla ni rechazado antes de salir.
    expect(corregirDatosClienteMock.mock.calls[0][0].producto).toHaveLength(5000);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("el campo obligatorio vacío bloquea el envío CON TEXTO, no sólo con el botón apagado", async () => {
    const user = await abrir();
    await user.clear(campo(/^Destinatario$/));

    expect(screen.getByRole("button", { name: CORREGIR_CONFIRMAR })).toBeDisabled();
    expect(screen.getByText(/Falta completar: el destinatario\./)).toBeInTheDocument();
    // Y no se llama a la acción: el handler no depende del bloqueo visual.
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));
    expect(corregirDatosClienteMock).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// R27 / R28 — LOS DOS AVISOS, CADA UNO CON SU PAR PRESENCIA/AUSENCIA
// =================================================================================================

describe("312/R27 + 327/R36 — el aviso de la etiqueta ya impresa", () => {
  it("con guía asignada avisa, NOMBRA la guía y —desde la 327— NOMBRA LA DIRECCIÓN", async () => {
    // ⚠️ EL LITERAL CAMBIA A PROPOSITO CON LA 327 (R36). La 312 decia «los datos anteriores» a
    // secas, y con la direccion fuera del alcance eso bastaba. Ahora la direccion SI se corrige y
    // es justo el dato que el papel lleva impreso: sin nombrarlo, quien lee el aviso no sabe si la
    // etiqueta se queda vieja en lo unico que importa para entregar el paquete.
    await abrir({ numGuia: 8123 });
    expect(
      screen.getByText(
        /la etiqueta pegada al paquete seguirá mostrando la dirección y los datos anteriores/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/guía 8123/)).toBeInTheDocument();
  });

  it("SIN guía NO avisa: no hay ningún papel impreso que pueda quedarse viejo", async () => {
    // El par de la presencia de arriba. Sin este caso, pintar el aviso SIEMPRE pasaría en verde.
    await abrir({ numGuia: null });
    expect(screen.queryByText(/etiqueta/i)).toBeNull();
  });

  it("P4: la ventana NO ofrece reimprimir, ni con guía", async () => {
    // Respuesta del humano el 2026-08-28: R27 avisa y nada más. Reimprimir ya es un gesto propio
    // de la fila del listado (`EtiquetaOrdenAccion`) y esta ficha no lo duplica aquí dentro.
    await abrir({ numGuia: 8123 });
    expect(screen.queryByRole("button", { name: /reimprimir|imprimir|etiqueta/i })).toBeNull();
  });
});

describe("312/R28 — el aviso de la conversación de WhatsApp", () => {
  it("aparece en cuanto el teléfono cambia respecto del precargado", async () => {
    const user = await abrir();
    await user.clear(campo(/Teléfono/));
    await user.type(campo(/Teléfono/), "8888-9999");

    expect(
      screen.getByText(/La conversación anterior se conserva, pero no se traslada/i),
    ).toBeInTheDocument();
    // Y dice lo que SÍ pasa, no sólo lo que no: los mensajes nuevos van al número corregido.
    expect(screen.getByText(/Los mensajes nuevos irán al número corregido/i)).toBeInTheDocument();
  });

  it("sin tocar el teléfono NO aparece", async () => {
    const user = await abrir();
    // Se toca OTRO campo: así el caso mide «el teléfono no cambió» y no «no se escribió nada».
    await user.type(campo(/^Destinatario$/), " Mora");
    expect(screen.queryByText(/La conversación anterior/i)).toBeNull();
  });
});

// =================================================================================================
// R29 / R30 — EL DESENLACE
// =================================================================================================

describe("312/R29 — el éxito relee del SERVIDOR", () => {
  it("cierra la ventana y revalida el listado por su prefijo de key SWR", async () => {
    const user = await abrir({ numGuia: 8123 });
    await user.clear(campo(/^Destinatario$/));
    await user.type(campo(/^Destinatario$/), "Ana Mora");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
    // El predicado de la key se ejerce de verdad: revalida el listado de órdenes y NADA más. Si
    // alguien lo cambiara por `mutate()` a secas —que revalida el mundo— o por otra key, esto cae.
    const predicado = mutateMock.mock.calls[0][0] as (key: unknown) => boolean;
    expect(predicado(["ordenes:list", 1, 10])).toBe(true);
    expect(predicado(["novedades:list", 1])).toBe(false);
    expect(mutateMock.mock.calls[0][2]).toMatchObject({ revalidate: true });
    // La ventana se cierra: el dato que se verá viene de la relectura, no de lo tecleado.
    await waitFor(() => expect(screen.queryByText(CORREGIR_TITULO)).toBeNull());
  });

  it("el `onSuccess` de la superficie sustituye a la revalidación por defecto", async () => {
    const onSuccess = vi.fn();
    const user = await abrir({}, onSuccess);
    await user.type(campo(/^Destinatario$/), " Mora");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("R4: «no había nada que cambiar» también es un éxito, y se dice distinto", async () => {
    corregirDatosClienteMock.mockResolvedValue({ status: "ok", cambios: [] });
    const user = await abrir();
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(toastMock.success.mock.calls[0][0]).toMatch(/nada que cambiar/i);
  });
});

describe("312/R30 — el rechazo conserva lo tecleado y no filtra nada", () => {
  it("`forbidden`: la ventana sigue abierta, con el borrador intacto y un motivo accionable", async () => {
    corregirDatosClienteMock.mockResolvedValue({ status: "forbidden" });
    const user = await abrir();
    await user.clear(campo(/^Destinatario$/));
    await user.type(campo(/^Destinatario$/), "Ana Mora");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    const motivo = await screen.findByRole("alert");
    // ACCIONABLE: dice qué hacer, no sólo que no se pudo.
    expect(motivo.textContent).toMatch(/actualiza la lista/i);
    // OPACO (R12): no dice cuál de las cuatro causas fue —ni permiso, ni inexistente, ni ajena—.
    expect(motivo.textContent).not.toMatch(/permiso|no existe|otra tienda|borrada/i);
    // Y NO expone identificadores internos.
    expect(motivo.textContent).not.toContain(ORDEN_ID);
    expect(document.body.textContent).not.toContain(ORDEN_ID);
    // El borrador sigue ahí: volver a escribirlo es justo el coste que R30 evita.
    expect(campo(/^Destinatario$/).value).toBe("Ana Mora");
    expect(screen.getByText(CORREGIR_TITULO)).toBeInTheDocument();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("`validation_error`: el motivo se pinta JUNTO al campo que lo tiene", async () => {
    corregirDatosClienteMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { telefonoDest: ["Numero de telefono no utilizable"] },
    });
    const user = await abrir();
    await user.clear(campo(/Teléfono/));
    await user.type(campo(/Teléfono/), "abc");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    expect(await screen.findByText("Numero de telefono no utilizable")).toBeInTheDocument();
    expect(campo(/Teléfono/)).toHaveAttribute("aria-invalid", "true");
    expect(campo(/Teléfono/).value).toBe("abc");
  });

  it("`conflict`: dice que NO se guardó nada, sin afirmar un cambio a medias", async () => {
    corregirDatosClienteMock.mockResolvedValue({ status: "conflict" });
    const user = await abrir();
    await user.type(campo(/^Destinatario$/), " Mora");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    const motivo = await screen.findByRole("alert");
    expect(motivo.textContent).toMatch(/no se guardó nada/i);
  });
});

// =================================================================================================
// D4 — LA VENTANA NO PROMETE NINGUN RASTRO
// =================================================================================================

describe("312/D4 — ningún texto anuncia un registro que no existe", () => {
  it("no dice que se registre quién corrigió, ni qué cambió", async () => {
    // Decisión humana del 2026-08-28: corregir no deja rastro. El único es el `updated_at` de la
    // fila. Una promesa falsa en la pantalla es peor que el silencio, y este caso es lo que impide
    // que alguien la escriba «para tranquilizar» a quien corrige.
    await abrir({ numGuia: 8123 });
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/quedará registrado|se registrará|queda registrado|auditoría/i);
    expect(texto).not.toMatch(/historial de cambios|quién lo cambió/i);
    // CONTROL POSITIVO de que había texto que mirar (si no, las cuatro ausencias no dirían nada).
    expect(texto).toContain(CORREGIR_TITULO);
  });
});

// =================================================================================================
// FICHA 327 / R31 — LOS NUEVE CAMPOS PRECARGADOS, Y LOS TRES SELECTORES ENCADENADOS
// =================================================================================================

describe("327/R31 — la ventana abre con los NUEVE valores actuales", () => {
  it("los cuatro de la 312 más dirección, peso y la geografía SELECCIONADA", async () => {
    await abrir();
    expect(campo(/^Destinatario$/).value).toBe("Ana Pérez");
    expect(campo(/Teléfono/).value).toBe("8888-7777");
    expect(campo(/^Producto$/).value).toBe("Zapatos negros");
    expect(campo(/^Notas$/).value).toBe("Dejar con el guarda");
    expect(campo(/^Dirección$/).value).toBe("Av. Central 120, portón verde");
    expect(campo(/^Peso/).value).toBe("1.5");
    // Los tres desplegables no llegan vacíos: llegan CON LO QUE LA ORDEN TIENE HOY. Un editor que
    // los abriera en blanco convertiría «corregir la dirección» en «volver a elegir la ubicación
    // entera», y el primer despiste dejaría la orden en otra zona — que es dinero.
    expect(combo(CORREGIR_PROVINCIA_LABEL).textContent).toContain("San José");
    expect(combo(CORREGIR_CANTON_LABEL).textContent).toContain("Escazú");
    expect(combo(CORREGIR_DISTRITO_LABEL).textContent).toContain("San Rafael");
  });

  it("y la precarga se pide POR ESA ORDEN, no por cualquiera", async () => {
    // Control de que el fixture no está midiendo la nada: la lectura lleva el id de la fila.
    await abrir();
    expect(obtenerUbicacionOrdenMock).toHaveBeenCalledTimes(1);
    expect(obtenerUbicacionOrdenMock.mock.calls[0][0]).toEqual({ ordenId: ORDEN_ID });
  });

  it("NO hay selector de zona: la deriva el servidor del distrito (R5)", async () => {
    // Un desplegable de zonas aquí abriría a mano la puerta que la ficha cierra por tipo: el
    // `.strict()` del schema rechaza `zonaId`, así que ese control sería un botón que el servidor
    // rechaza siempre.
    await abrir();
    expect(screen.queryByRole("combobox", { name: /zona/i })).toBeNull();
  });
});

describe("327/R31 — los tres selectores están ENCADENADOS por `padreId`", () => {
  it("elegir provincia recorta los cantones a los suyos", async () => {
    const user = await abrir();
    await elegir(user, CORREGIR_PROVINCIA_LABEL, "Alajuela");

    await user.click(combo(CORREGIR_CANTON_LABEL));
    const lista = await screen.findByRole("listbox");
    const etiquetas = within(lista)
      .getAllByRole("option")
      .map((o) => o.textContent?.trim());
    expect(etiquetas).toEqual(["Alajuela centro"]);
    // El par del recorte: los de la OTRA provincia ya no se ofrecen. Sin esta línea, un componente
    // que no filtrara nada pasaría el caso de arriba en cuanto la lista tuviera un solo elemento.
    expect(etiquetas).not.toContain("Escazú");
    expect(etiquetas).not.toContain("Desamparados");
  });

  it("elegir cantón recorta los distritos, y sin cantón el distrito ni se puede tocar", async () => {
    const user = await abrir();
    await elegir(user, CORREGIR_PROVINCIA_LABEL, "Alajuela");
    // Cambiar de provincia LIMPIA el cantón y el distrito: dejarlos colgados produciría justo la
    // geografía incoherente que el servidor rechaza (R6).
    expect(combo(CORREGIR_DISTRITO_LABEL)).toBeDisabled();

    await elegir(user, CORREGIR_CANTON_LABEL, "Alajuela centro");
    await user.click(combo(CORREGIR_DISTRITO_LABEL));
    const lista = await screen.findByRole("listbox");
    const etiquetas = within(lista)
      .getAllByRole("option")
      .map((o) => o.textContent?.trim());
    expect(etiquetas).toEqual(["La Garita"]);
    expect(etiquetas).not.toContain("San Rafael");
  });
});

// =================================================================================================
// 💰 FICHA 327 / R33 — EL GATE DEL DINERO: NO SE GUARDA SIN HABER VISTO LOS IMPORTES
// =================================================================================================

describe("327/R33 — cambiar el distrito no se guarda hasta confirmar", () => {
  it("guardar enseña la comparación con LAS DOS columnas y NO escribe nada", async () => {
    corregirDatosClienteMock.mockResolvedValueOnce({
      status: "confirmacion_requerida",
      aviso: aviso(),
    });
    const user = await abrir();
    await cambiarDistrito(user);
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    expect(await screen.findByText(AVISO_TITULO)).toBeInTheDocument();
    // Las DOS columnas, con sus rótulos: enseñar sólo el importe nuevo obligaría a quien mira a
    // recordar el viejo, que es exactamente lo que este panel existe para evitar.
    expect(screen.getByText(AVISO_COL_ACTUAL)).toBeInTheDocument();
    expect(screen.getByText(AVISO_COL_PROPUESTA)).toBeInTheDocument();
    expect(screen.getByText("GAM Oeste")).toBeInTheDocument();
    expect(screen.getByText("Cartago")).toBeInTheDocument();
    expect(screen.getByText("₡2.825,40")).toBeInTheDocument();
    expect(screen.getByText("₡4.520")).toBeInTheDocument();
    expect(screen.getAllByText("₡1.130")).toHaveLength(2);

    // 💰 LA PRIMERA PETICIÓN NO CONFIRMA NADA. Este literal es la mitad de pantalla de R33: si el
    // botón de guardar mandara `true`, el servidor escribiría sin que nadie hubiera visto un solo
    // importe — y ni un caso de este archivo se enteraría salvo éste.
    expect(corregirDatosClienteMock).toHaveBeenCalledTimes(1);
    expect(corregirDatosClienteMock.mock.calls[0][0].confirmaCambioDeUbicacion).toBe(false);
    // Y nada se dio por guardado: ni toast de éxito, ni relectura del listado.
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByText(CORREGIR_TITULO)).toBeInTheDocument();
  });

  it("y sólo el botón del panel reenvía CONFIRMANDO, con el distrito nuevo", async () => {
    corregirDatosClienteMock.mockResolvedValueOnce({
      status: "confirmacion_requerida",
      aviso: aviso(),
    });
    const user = await abrir();
    await cambiarDistrito(user);
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));
    await screen.findByText(AVISO_TITULO);

    await user.click(screen.getByRole("button", { name: AVISO_CONFIRMAR }));

    await waitFor(() => expect(corregirDatosClienteMock).toHaveBeenCalledTimes(2));
    const segunda = corregirDatosClienteMock.mock.calls[1][0];
    expect(segunda.confirmaCambioDeUbicacion).toBe(true);
    // Confirma LO QUE SE ENSEÑÓ: el mismo distrito, no otro.
    expect(segunda.distritoId).toBe("dis-patarra");
    expect(segunda.cantonId).toBe("can-desamp");
    expect(segunda.provinciaId).toBe("prov-sj");
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
  });

  it("el botón «Guardar cambios» NO manda la confirmación NUNCA, ni al segundo intento", async () => {
    // El caso que cierra el atajo: alguien podría «arreglar» el segundo clic para que confirme
    // solo, y el flujo se vería igual de bien en pantalla. Aquí el servidor pide confirmación las
    // dos veces y las dos peticiones tienen que llegar sin ella.
    corregirDatosClienteMock.mockResolvedValue({
      status: "confirmacion_requerida",
      aviso: aviso(),
    });
    const user = await abrir();
    await cambiarDistrito(user);
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));
    await screen.findByText(AVISO_TITULO);
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(corregirDatosClienteMock).toHaveBeenCalledTimes(2));
    for (const llamada of corregirDatosClienteMock.mock.calls) {
      expect(llamada[0].confirmaCambioDeUbicacion).toBe(false);
    }
  });

  it("corregir SÓLO la dirección no dispara ningún aviso (el gate mira el distrito)", async () => {
    // El par del caso de arriba. El servidor decide, y con la dirección cambiada devuelve `ok`:
    // la ventana no puede inventarse un panel de confirmación por su cuenta.
    const user = await abrir();
    await user.clear(campo(/^Dirección$/));
    await user.type(campo(/^Dirección$/), "Av. Segunda 45");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(corregirDatosClienteMock).toHaveBeenCalledTimes(1));
    expect(corregirDatosClienteMock.mock.calls[0][0].direccion).toBe("Av. Segunda 45");
    expect(screen.queryByText(AVISO_TITULO)).toBeNull();
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
  });
});

// =================================================================================================
// 💰 FICHA 327 / R13 — «SIN TARIFA» NO ES «CERO»
// =================================================================================================

describe("327/R13 — la pantalla ramifica por el DISCRIMINANTE, no por el importe", () => {
  async function conAviso(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<void> {
    await cambiarDistrito(user);
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));
    await screen.findByText(AVISO_TITULO);
  }

  it("con `sin_tarifa` dice «sin tarifa configurada» y NO pinta ₡0", async () => {
    const base = aviso();
    corregirDatosClienteMock.mockResolvedValueOnce({
      status: "confirmacion_requerida",
      aviso: aviso({
        propuesta: {
          ...base.propuesta,
          tarifa: "sin_tarifa",
          // El servidor manda "0.00" en los DOS importes cuando no hay tarifa: es literalmente lo
          // que devuelve `costosListadoOrden` sin tarifa resuelta.
          fleteConIva: "0.00",
          comisionConIva: "0.00",
        },
      }),
    });
    const user = await abrir();
    await conAviso(user);

    // Las dos celdas de la columna propuesta: flete y comisión.
    expect(screen.getAllByText(AVISO_SIN_TARIFA)).toHaveLength(2);
    // Y NO hay ningún cero pintado como importe. `"0.00"` no significa «gratis», significa «nadie
    // configuró la tarifa de ese par (tienda, zona)»: enseñarlo como precio sería mentir.
    expect(document.body.textContent).not.toContain("₡0");
    // La columna «Ahora» sigue con sus importes: el hueco es del par NUEVO, no de la orden.
    expect(screen.getByText("₡2.825,40")).toBeInTheDocument();
  });

  it("EL CASO QUE MATA LA MUTACIÓN: tarifa RESUELTA con importe cero SÍ pinta ₡0", async () => {
    // Una orden que no cobra comisión (`cobraComision: false`) trae `comisionConIva: "0.00"` con la
    // tarifa PERFECTAMENTE resuelta, y es un caso corriente en producción. Quien ramifique por el
    // importe —`if (importe === "0.00")`— pintaría aquí «sin tarifa configurada», que es falso: la
    // tarifa existe y la comisión vale cero. El caso de arriba, por sí solo, deja pasar esa
    // mutación, porque allí el discriminante y el importe dicen lo mismo.
    const base = aviso();
    corregirDatosClienteMock.mockResolvedValueOnce({
      status: "confirmacion_requerida",
      aviso: aviso({
        actual: { ...base.actual, comisionConIva: "0.00" },
        propuesta: { ...base.propuesta, comisionConIva: "0.00" },
      }),
    });
    const user = await abrir();
    await conAviso(user);

    expect(screen.queryByText(AVISO_SIN_TARIFA)).toBeNull();
    expect(screen.getAllByText("₡0")).toHaveLength(2);
    expect(screen.getByText("₡2.825,40")).toBeInTheDocument();
    expect(screen.getByText("₡4.520")).toBeInTheDocument();
  });
});

// =================================================================================================
// FICHA 327 / R14 y R16 — LAS DOS SEÑALES, CADA UNA CON SU PAR PRESENCIA/AUSENCIA
// =================================================================================================

describe("327/R14 — el flete que sale de la normal por falta de pacto se SEÑALA", () => {
  async function avisoCon(over: Partial<AvisoCambioUbicacion>) {
    corregirDatosClienteMock.mockResolvedValueOnce({
      status: "confirmacion_requerida",
      aviso: aviso(over),
    });
    const user = await abrir();
    await cambiarDistrito(user);
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));
    await screen.findByText(AVISO_TITULO);
  }

  it("con `especial_sin_pacto` en la propuesta aparece la señal, y nombra su columna", async () => {
    // El importe es IDÉNTICO al de una orden corriente: sin esta línea no hay forma de distinguir
    // «cobra la normal porque le toca» de «cobra la normal porque falta configurar el pacto».
    const base = aviso();
    await avisoCon({
      propuesta: { ...base.propuesta, esZonaEspecial: true, fleteOrigen: "especial_sin_pacto" },
    });
    expect(screen.getByText(avisoEspecialSinPacto(AVISO_COL_PROPUESTA))).toBeInTheDocument();
    expect(screen.queryByText(avisoEspecialSinPacto(AVISO_COL_ACTUAL))).toBeNull();
  });

  it("con `normal` en las dos, la señal NO aparece", async () => {
    await avisoCon({});
    expect(screen.queryByText(/no tiene monto pactado/i)).toBeNull();
  });
});

describe("327/R16 — el aviso de la orden que ya entró en un cierre", () => {
  async function avisoCon(yaEnUnCierre: boolean) {
    corregirDatosClienteMock.mockResolvedValueOnce({
      status: "confirmacion_requerida",
      aviso: aviso({ yaEnUnCierre }),
    });
    const user = await abrir();
    await cambiarDistrito(user);
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));
    await screen.findByText(AVISO_TITULO);
  }

  it("con `yaEnUnCierre: true` avisa —y AVISA, no bloquea: el botón de confirmar sigue ahí", async () => {
    await avisoCon(true);
    expect(screen.getByText(AVISO_YA_EN_UN_CIERRE)).toBeInTheDocument();
    // Lo ya facturado no cambia (la fila de `cierre_detail` es inmutable) y el importe nuevo rige
    // de la próxima gestión en adelante. Bloquear aquí condenaría a re-intentarse con la ubicación
    // equivocada justo a la orden que esta ficha existe para arreglar.
    expect(screen.getByRole("button", { name: AVISO_CONFIRMAR })).toBeEnabled();
  });

  it("con `false` NO aparece: un aviso que sale siempre no es un aviso", async () => {
    await avisoCon(false);
    expect(screen.queryByText(AVISO_YA_EN_UN_CIERRE)).toBeNull();
  });
});

// =================================================================================================
// FICHA 327 / R34 — EL RECHAZO DE LA GEOGRAFÍA, JUNTO A SU CAMPO
// =================================================================================================

describe("327/R34 — `validation_error` en el distrito", () => {
  it("pinta el motivo junto al desplegable, conserva el borrador y no filtra identificadores", async () => {
    corregirDatosClienteMock.mockResolvedValueOnce({
      status: "validation_error",
      fieldErrors: { distritoId: ["El distrito no pertenece al cantón indicado"] },
    });
    const user = await abrir();
    await user.clear(campo(/^Dirección$/));
    await user.type(campo(/^Dirección$/), "Calle 7, casa azul");
    await cambiarDistrito(user);
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    expect(
      await screen.findByText("El distrito no pertenece al cantón indicado"),
    ).toBeInTheDocument();
    expect(combo(CORREGIR_DISTRITO_LABEL)).toHaveAttribute("aria-invalid", "true");
    // El borrador entero sigue ahí: volver a teclearlo es justo el coste que R34 evita.
    expect(campo(/^Dirección$/).value).toBe("Calle 7, casa azul");
    expect(screen.getByText(CORREGIR_TITULO)).toBeInTheDocument();
    // Y no se cuela ningún identificador interno en la pantalla.
    expect(document.body.textContent).not.toContain(ORDEN_ID);
    expect(mutateMock).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// FICHA 327 / R31 — LA DEGRADACIÓN: SI LA PRECARGA FALLA, LA VENTANA NO SE MUERE
// =================================================================================================

describe("327/R31 — precarga caída: la ventana sigue sirviendo para lo demás", () => {
  it("lo DICE, apaga los controles de ubicación y deja corregir los cuatro de la 312", async () => {
    obtenerUbicacionOrdenMock.mockResolvedValue({ status: "forbidden" });
    const user = await abrir();

    expect(screen.getByText(CORREGIR_UBICACION_FALLO)).toBeInTheDocument();
    expect(campo(/^Dirección$/)).toBeDisabled();
    expect(campo(/^Peso/)).toBeDisabled();
    expect(combo(CORREGIR_PROVINCIA_LABEL)).toBeDisabled();
    expect(combo(CORREGIR_DISTRITO_LABEL)).toBeDisabled();

    await user.clear(campo(/^Destinatario$/));
    await user.type(campo(/^Destinatario$/), "Ana Mora");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(corregirDatosClienteMock).toHaveBeenCalledTimes(1));
    const entrada = corregirDatosClienteMock.mock.calls[0][0];
    expect(entrada.destinatario).toBe("Ana Mora");
    // R3 — los tres de geografía viajan JUNTOS o no viajan. Con la precarga caída no viaja ninguno
    // de los cinco, y el servidor deja la ubicación exactamente como estaba. Mandar una geografía
    // a medias —o una dirección vacía— sería peor que no mandar nada.
    expect(entrada.direccion).toBeUndefined();
    expect(entrada.provinciaId).toBeUndefined();
    expect(entrada.cantonId).toBeUndefined();
    expect(entrada.distritoId).toBeUndefined();
    expect(entrada.peso).toBeUndefined();
  });
});

// =================================================================================================
// FICHA 327 / R35 — EL PANEL DEL AVISO TAMPOCO PROMETE NINGÚN RASTRO
// =================================================================================================

describe("327/R35 — ni el panel del importe anuncia un registro que no existe", () => {
  it("barrido del texto con la comparación montada", async () => {
    corregirDatosClienteMock.mockResolvedValueOnce({
      status: "confirmacion_requerida",
      aviso: aviso({ yaEnUnCierre: true }),
    });
    const user = await abrir({ numGuia: 8123 });
    await cambiarDistrito(user);
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));
    await screen.findByText(AVISO_TITULO);

    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/quedará registrado|se registrará|queda registrado|auditoría/i);
    expect(texto).not.toMatch(/historial de cambios|quién lo cambió/i);
    // Vocabulario (pedido humano): nada de «SLA» en la pantalla.
    expect(texto).not.toMatch(/\bSLA\b/);
    // CONTROL POSITIVO de que había texto que mirar, y del más comprometido: el panel del dinero.
    expect(texto).toContain(AVISO_TITULO);
    expect(texto).toContain(AVISO_YA_EN_UN_CIERRE);
  });
});
