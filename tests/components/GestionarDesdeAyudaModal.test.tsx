// @vitest-environment jsdom
// =================================================================================================
// FEATURE 237 (T7.2/T7.4) — LA VENTANA CON LA QUE LA TIENDA RESUELVE UNA ORDEN EN AYUDA.
// =================================================================================================
//
// **Qué protege este archivo y ningún test de backend puede proteger.** El servicio ya sabe
// rechazar un envío sin foto, sin motivo o con una fecha de hoy; lo que no puede saber es si la
// tienda LLEGÓ A ENTERARSE de lo que estaba firmando. Esta ventana dispara una gestión atribuida al
// mensajero: entra en su cierre del día, suma un intento de entrega y mueve el mismo dinero — y ese
// dinero son DOS IMPORTES CON DUEÑOS DISTINTOS. Los hasta ₡1.000 de un rechazo (`cobroRechazado`;
// media ₡400 sobre las 5 tarifas, `progress/impl_237.md` §M3, 2026-08-20) NO se le cobran a la
// tienda: son **ingreso de bodega** y caen en el **cierre del mensajero**, y en la billetera de la
// tienda no hay apunte por ese concepto (`progress/recorrido_237.md` paso 8). A la tienda un rechazo
// **sí** le cuesta, pero por OTRA VÍA Y OTRA TARIFA: el **flete de devolución** (hasta ₡2.600
// —₡2.200 en GAM— más IVA 13 %, `progress/medicion_240.md` §M4). Por eso el aviso del precio (D7)
// tiene su propio caso: es el que evita que la tienda firme sin saberlo un movimiento de dinero que
// no es suyo del todo — dispara ingreso de bodega en el cierre de otra persona y un cargo a su
// propia tienda por otra vía.
//
// ⚠️ **FICHA 309 (2026-08-28) — TODO ESO ES DEL MODO `rechazar`, Y HASTA HOY EL AVISO LO DECÍA
// TAMBIÉN AL REPROGRAMAR.** Era un literal único para los dos modos, con la frase «mueve el dinero
// igual». Reprogramar no mueve nada —los tres sitios que deciden el dinero de una gestión dan cero
// para `reprogramada`— así que la pantalla estaba disuadiendo de la acción barata y empujando hacia
// la única que sí cobra. Este archivo lo tenía FIJADO como contrato («y también al REPROGRAMAR») y
// el caso pasaba en verde: no bastaba con que los literales estuvieran escritos a mano, había que
// escribir el contrato POR MODO. La asimetría vive ahora en cinco casos emparejados: los dos
// literales completos, las consecuencias de cada uno, y la ausencia/presencia de la palabra
// «dinero» sobre el diálogo entero.
//
// ⚠️ **LOS TEXTOS SE ESCRIBEN AQUÍ A MANO, NUNCA CONTRA LA CONSTANTE IMPORTADA.** Comparar el
// aviso contra `GESTION_AYUDA_AVISO_PRECIO` estaría verde con cualquier contenido, incluido el día
// que alguien lo vacíe o le quite la palabra «dinero». En esta misma rama se acaban de arreglar dos
// avisos que mentían porque su test se comparaba consigo mismo. Lo que SÍ se importa son las
// constantes que sirven de SELECTOR (el rótulo del botón que hay que pulsar), y sólo después de
// haber fijado su literal en el caso de los rótulos.
//
// ⚠️ **CADA AUSENCIA, CON SU PRESENCIA.** Afirmar que la fecha «no está» pasa en verde también si
// el modal no renderizó nada. Todas las negativas de este archivo van emparejadas con el caso donde
// sí aparece.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  GestionarDesdeAyudaModal,
  type ModoGestionDesdeAyuda,
} from "@/app/(app)/novedades/_components/GestionarDesdeAyudaModal";
import { gestionarDesdeAyuda } from "@/lib/actions/gestion-desde-ayuda";
// Feature 261 (F7, R32): los mensajes del SERVICIO, para afirmar que la frase que sube al padre es
// la MISMA que el servidor emite. El literal de cada caso sigue escrito a mano.
import { MENSAJES_GESTION_DESDE_AYUDA } from "@/lib/services/GestionDesdeAyudaService";
import { mananaCalendarioCR } from "@/lib/utils/fecha-cr";
import type { NovedadDTO } from "@/lib/types/novedad";

vi.mock("@/lib/actions/gestion-desde-ayuda", () => ({
  gestionarDesdeAyuda: vi.fn(),
}));

const gestionarMock = vi.mocked(gestionarDesdeAyuda);

// --- Los literales, escritos a mano. Son el contrato visible de D7. ------------------------------

const TITULO = "Resolver la orden por tu cuenta";
/**
 * FICHA 309 (2026-08-28) — SON DOS AVISOS, UNO POR MODO, Y ESA ASIMETRÍA ES EL CONTRATO.
 *
 * Hasta hoy había UN literal para los dos modos y decía «mueve el dinero igual» también al
 * reprogramar, donde no se mueve ni un colón: `pagoPorResultado` sólo paga `entregada`,
 * `ingresoBodegaPorResultado` sólo cobra en `rechazada` y `derivarIngresoOrden` sólo emite
 * conceptos para esas dos desde la ficha 301. Quien reprogramaba leía en rojo que le iban a cobrar.
 *
 * Los dos literales van A MANO, como todos los de este archivo, y NO se importa
 * `GESTION_AYUDA_AVISO`: compararlos contra la constante que los produce estaría verde el día que
 * alguien vuelva a poner la frase del dinero en el modo reprogramar, que es exactamente la recaída
 * que estos casos existen para cazar.
 */
const AVISO_RECHAZAR =
  "Esto cuenta como una gestión del mensajero: entra en su cierre del día, suma un intento de entrega y mueve el dinero igual. Por eso pide foto y motivo.";
const AVISO_REPROGRAMAR =
  "Esto cuenta como una gestión del mensajero: entra en su cierre del día y suma un intento de entrega. Reprogramar no cobra nada. Por eso pide foto y motivo.";
const LABEL_FOTOS = "Fotos de evidencia";
const LABEL_MOTIVO = "Motivo";
const LABEL_FECHA = "Nueva fecha";

function novedad(over: Partial<NovedadDTO> = {}): NovedadDTO {
  return {
    id: "o1",
    numGuia: 12345,
    numRemision: "REM-001",
    estatusValue: "ayuda_tienda",
    intentosContacto: 1,
    mensajeroNombre: "Marta Mensajera",
    destinatario: "Ana Cliente",
    telefonoDest: "88887777",
    direccion: "Av. Central 120",
    producto: "Zapatos",
    peso: 1.5,
    montoCobrar: 24500,
    latitud: 9.9281,
    longitud: -84.0907,
    notas: null,
    tiendaNombre: "Tienda Demo",
    zonaNombre: "GAM Oeste",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    secuenciaRuta: null,
    causa: null,
    intentosEntrega: 1,
    ...over,
  };
}

function foto(nombre: string): File {
  return new File(["x"], nombre, { type: "image/jpeg" });
}

function montar(modo: ModoGestionDesdeAyuda, onResuelto = vi.fn()) {
  render(
    <GestionarDesdeAyudaModal
      orden={novedad()}
      modo={modo}
      onOpenChange={vi.fn()}
      onResuelto={onResuelto}
    />,
  );
  return onResuelto;
}

/** Adjunta N fotos y espera a que las N previsualizaciones estén en el árbol. */
async function subirFotos(user: ReturnType<typeof userEvent.setup>, cuantas: number) {
  await user.upload(
    screen.getByLabelText(LABEL_FOTOS),
    Array.from({ length: cuantas }, (_, i) => foto(`f${i}.jpg`)),
  );
  await waitFor(() =>
    expect(
      within(
        screen.getByRole("list", { name: "Fotos de evidencia seleccionadas" }),
      ).getAllByRole("img"),
    ).toHaveLength(cuantas),
  );
}

function escribirMotivo(texto: string) {
  fireEvent.change(screen.getByLabelText(LABEL_MOTIVO), { target: { value: texto } });
}

function confirmar(modo: ModoGestionDesdeAyuda) {
  return screen.getByRole("button", {
    name: modo === "reprogramar" ? "Reprogramar" : "Rechazar",
  });
}

/** Lo que salió hacia la Server Action, ya como `FormData`. */
function envio(): FormData {
  expect(gestionarMock).toHaveBeenCalledTimes(1);
  return gestionarMock.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  gestionarMock.mockResolvedValue({
    status: "ok",
    ordenId: "o1",
    resultado: "rechazada",
  });
});
afterEach(cleanup);

// =================================================================================================
// D7 — EL AVISO QUE DICE EL PRECIO
// =================================================================================================

describe("237/D7 — el aviso del precio, que es lo que evita cobrar ₡1.000 sin saberlo", () => {
  it("se lee TAL CUAL, palabra por palabra, al RECHAZAR", () => {
    montar("rechazar");
    // El literal, a mano. Dice las tres consecuencias: el cierre AJENO, el intento y el dinero.
    expect(screen.getByText(AVISO_RECHAZAR)).toBeInTheDocument();
  });

  it("y también al REPROGRAMAR hay aviso: no es un aviso del rechazo, es de las dos", () => {
    // Reprogramar desde ayuda también entra en el cierre de OTRA persona y suma un intento. Si no
    // hubiera aviso al reprogramar, sería la acción barata y sin advertencia — que es exactamente
    // lo que D2 y D7 vinieron a impedir. Por eso la ficha 309 cambió la FRASE, no el aviso.
    montar("reprogramar");
    expect(screen.getByText(AVISO_REPROGRAMAR)).toBeInTheDocument();
  });

  it("nombra las TRES consecuencias al RECHAZAR, no una fórmula vaga", () => {
    // Anti-degradación: un «esta acción tiene consecuencias» pasaría el caso de arriba si alguien
    // reescribiera el texto, pero no éste. Las tres cosas que la tienda no puede deducir de la
    // pantalla son: en el cierre de OTRA persona, un intento MÁS, y DINERO.
    montar("rechazar");
    const aviso = screen.getByText(AVISO_RECHAZAR);
    expect(aviso).toHaveTextContent("cierre del día");
    expect(aviso).toHaveTextContent("suma un intento de entrega");
    expect(aviso).toHaveTextContent("mueve el dinero igual");
  });

  it("y al REPROGRAMAR nombra las DOS que sí son ciertas, sin la del dinero", () => {
    // 309: el cierre ajeno y el intento SIGUEN, porque siguen siendo verdad en los dos modos. Lo
    // que desaparece es la tercera. Sin este caso, «arreglar» el aviso vaciándolo pasaría.
    montar("reprogramar");
    const aviso = screen.getByText(AVISO_REPROGRAMAR);
    expect(aviso).toHaveTextContent("cierre del día");
    expect(aviso).toHaveTextContent("suma un intento de entrega");
    // Y lo dice EN POSITIVO, que es la mitad de la ficha: no basta con callar el cobro, hay que
    // desmentirlo, porque el modo hermano de la misma ventana sí cobra.
    expect(aviso).toHaveTextContent("Reprogramar no cobra nada");
  });

  it("💰 EL CASO DE LA FICHA 309: reprogramar NO menciona dinero en ninguna parte de la ventana", () => {
    // ⚠️ ESTE ES EL CASO QUE MUERDE, y va sobre el diálogo ENTERO y no sobre el `<p>` del aviso: si
    // mañana alguien vuelve a colar la frase del cobro —en el aviso, en la ayuda del motivo o en la
    // de las fotos—, se pone rojo igual. Verificado contra el código el 2026-08-28:
    // `pagoPorResultado` (pago-mensajero.ts:22) y `ingresoBodegaPorResultado` (ingreso-bodega.ts:23)
    // devuelven "0.00" para `reprogramada`, y `derivarIngresoOrden` (ingreso-ordenex.ts:185-186) no
    // le emite ningún concepto. Anunciar un cobro que no existe no es un texto feo: es la pantalla
    // disuadiendo de la acción BARATA y empujando hacia la que sí cuesta ₡2.600 más IVA.
    montar("reprogramar");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("dinero");
  });

  it("el ESPEJO: al rechazar sí lo menciona, porque ahí el dinero sí se mueve", () => {
    // La presencia que empareja la ausencia de arriba (regla de este archivo): sin ella, el caso
    // anterior seguiría verde el día que el aviso desapareciera de los dos modos.
    montar("rechazar");
    expect(screen.getByRole("dialog")).toHaveTextContent("mueve el dinero igual");
  });

  it("está SIEMPRE visible, no escondido tras un tooltip ni tras un despliegue", () => {
    // `role="note"` en el cuerpo del modal, sin `hidden` y sin control que lo revele. El precio no
    // se descubre pasando el puntero: en una pantalla táctil no hay puntero que pasar.
    montar("rechazar");
    const notas = screen.getAllByRole("note").map((n) => n.textContent);
    expect(notas).toContain(AVISO_RECHAZAR);
  });

  it("y al reprogramar también es `note` y también está siempre visible", () => {
    // El par del caso de arriba en el otro modo: la ficha 309 no podía dejar el aviso del modo
    // reprogramar degradado a un texto suelto sin rol.
    montar("reprogramar");
    const notas = screen.getAllByRole("note").map((n) => n.textContent);
    expect(notas).toContain(AVISO_REPROGRAMAR);
  });

  it("y el título NO usa el verbo «gestionar», que es el del mensajero (236/D6)", () => {
    montar("rechazar");
    expect(screen.getByRole("dialog")).toHaveTextContent(TITULO);
  });
});

// =================================================================================================
// D7 — LOS RÓTULOS
// =================================================================================================

describe("237/D7 — los rótulos son «Reprogramar» y «Rechazar», sin más palabras", () => {
  it("el confirmar del modo reprogramar se llama «Reprogramar»", () => {
    montar("reprogramar");
    expect(screen.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    // Y no la alternativa descartada, que alarga el rótulo sin añadir nada.
    expect(screen.queryByRole("button", { name: "Reprogramar entrega" })).toBeNull();
  });

  it("el del modo rechazar se llama «Rechazar»", () => {
    montar("rechazar");
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rechazar entrega" })).toBeNull();
  });
});

// =================================================================================================
// T7.2 — EL ENVÍO ESTÁ BLOQUEADO, Y EL MOTIVO DEL BLOQUEO SE LEE CON PALABRAS
// =================================================================================================

describe("237/T7.2 — sin motivo, sin foto o sin fecha no se puede enviar, y se dice por qué", () => {
  it("con el formulario vacío el confirmar está bloqueado y enumera lo que falta", () => {
    montar("rechazar");
    expect(confirmar("rechazar")).toBeDisabled();
    // Con palabras, no sólo con un botón apagado: un botón gris dice QUE no se puede, no POR QUÉ.
    expect(screen.getByText("Falta completar: el motivo, al menos una foto.")).toBeInTheDocument();
  });

  it("al reprogramar la lista incluye la fecha si se borra el valor por defecto", () => {
    montar("reprogramar");
    fireEvent.change(screen.getByLabelText(LABEL_FECHA), { target: { value: "" } });
    expect(
      screen.getByText("Falta completar: la nueva fecha, el motivo, al menos una foto."),
    ).toBeInTheDocument();
  });

  it("con foto pero sin motivo sigue bloqueado, y lo dice", async () => {
    const user = userEvent.setup();
    montar("rechazar");
    await subirFotos(user, 1);

    expect(confirmar("rechazar")).toBeDisabled();
    expect(screen.getByText("Falta completar: el motivo.")).toBeInTheDocument();
  });

  it("un motivo de sólo espacios NO cuenta como motivo", async () => {
    const user = userEvent.setup();
    montar("rechazar");
    await subirFotos(user, 1);
    escribirMotivo("    ");

    // La mutación que un `!== ""` a secas dejaría pasar, y la que convierte el requisito en un
    // trámite: tres espacios de motivo delante de un cobro de ₡1.000.
    expect(confirmar("rechazar")).toBeDisabled();
    expect(screen.getByText("Falta completar: el motivo.")).toBeInTheDocument();
  });

  it("con motivo y foto se DESBLOQUEA y el aviso de lo que falta desaparece", async () => {
    // El positivo del par. Sin él, todos los «está bloqueado» de arriba pasarían igual con un
    // botón deshabilitado para siempre.
    const user = userEvent.setup();
    montar("rechazar");
    await subirFotos(user, 1);
    escribirMotivo("El cliente ya no quiere el pedido");

    expect(confirmar("rechazar")).toBeEnabled();
    expect(screen.queryByText(/^Falta completar:/)).toBeNull();
  });
});

// =================================================================================================
// D2 — LA FOTO ES OBLIGATORIA TAMBIÉN AL REPROGRAMAR
// =================================================================================================

describe("237/D2 — la evidencia se exige en LOS DOS desenlaces", () => {
  it("al REPROGRAMAR, con fecha y motivo pero SIN foto, sigue bloqueado", async () => {
    montar("reprogramar");
    escribirMotivo("El cliente pidió que se lo llevemos el jueves");

    // Ésta es la asimetría firmada con el panel del mensajero, que reprograma sin foto. Si esta
    // regla se relaja, la reprogramación de la tienda queda como la única gestión con efecto
    // contable y sin ningún respaldo.
    expect(confirmar("reprogramar")).toBeDisabled();
    expect(screen.getByText("Falta completar: al menos una foto.")).toBeInTheDocument();
  });

  it("y con la foto se desbloquea (el par positivo de la regla)", async () => {
    const user = userEvent.setup();
    montar("reprogramar");
    escribirMotivo("El cliente pidió que se lo llevemos el jueves");
    await subirFotos(user, 1);

    expect(confirmar("reprogramar")).toBeEnabled();
  });

  it("el texto de ayuda dice QUÉ fotografiar, porque la tienda no tiene el paquete delante", () => {
    montar("reprogramar");
    // Un «campo requerido» seco dejaría a la tienda sin saber qué se espera de ella: no está en la
    // calle ni tiene el paquete. Se le nombran las pruebas que sí puede aportar.
    const ayuda = screen.getByText(/La foto es obligatoria también al reprogramar/);
    expect(ayuda).toHaveTextContent("la captura de la conversación con el cliente");
  });
});

// =================================================================================================
// T7.2 — LA FECHA: SÓLO AL REPROGRAMAR, Y NUNCA ANTES DE MAÑANA
// =================================================================================================

describe("237/R14 — la fecha de reprogramación", () => {
  it("existe al reprogramar, arranca en MAÑANA y no admite nada anterior", () => {
    montar("reprogramar");
    const fecha = screen.getByLabelText(LABEL_FECHA);
    const manana = mananaCalendarioCR();
    expect(fecha).toHaveValue(manana);
    // El `min` del selector es la primera barrera; el schema la revalida en cliente y el servidor
    // otra vez. Lo que este caso fija es que la barrera existe y apunta a mañana, no a hoy.
    expect(fecha).toHaveAttribute("min", manana);
  });

  it("y NO existe al rechazar: un rechazo no tiene fecha que elegir", () => {
    // La ausencia, emparejada con la presencia del caso de arriba.
    montar("rechazar");
    expect(screen.queryByLabelText(LABEL_FECHA)).toBeNull();
  });

  it("la fecha de HOY no pasa la validación de cliente y NO llega a la Server Action", async () => {
    const user = userEvent.setup();
    montar("reprogramar");
    await subirFotos(user, 1);
    escribirMotivo("El cliente pidió otro día");
    // Hoy en el calendario de Costa Rica: el `min` del navegador no lo impide en jsdom, así que
    // esto ejerce el schema, que es la barrera que de verdad viaja.
    const hoy = new Date(
      new Date(`${mananaCalendarioCR()}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    fireEvent.change(screen.getByLabelText(LABEL_FECHA), { target: { value: hoy } });

    await user.click(confirmar("reprogramar"));

    expect(gestionarMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("la fecha debe ser mañana o posterior");
  });
});

// =================================================================================================
// T7.2 — QUÉ VIAJA: N FOTOS COMO N VALORES DE `evidencia`, Y EL RESULTADO CORRECTO
// =================================================================================================

describe("237/T7.2 — la forma del envío", () => {
  it("💰 el modo RECHAZAR envía `resultado = rechazada`", async () => {
    const user = userEvent.setup();
    montar("rechazar");
    await subirFotos(user, 1);
    escribirMotivo("El cliente ya no quiere el pedido");

    await user.click(confirmar("rechazar"));

    // El literal, a mano. Es la mutación de dinero de esta ventana: invertir el mapa modo →
    // resultado cobraría un rechazo cuando la tienda pulsó «Reprogramar».
    await waitFor(() => expect(envio().get("resultado")).toBe("rechazada"));
    expect(envio().get("ordenId")).toBe("o1");
    expect(envio().get("motivo")).toBe("El cliente ya no quiere el pedido");
    // Un rechazo no lleva fecha: la clave ni se crea.
    expect(envio().get("fechaReprogramacion")).toBeNull();
  });

  it("💰 el modo REPROGRAMAR envía `resultado = reprogramada` y su fecha", async () => {
    const user = userEvent.setup();
    montar("reprogramar");
    await subirFotos(user, 1);
    escribirMotivo("El cliente pidió el jueves");

    await user.click(confirmar("reprogramar"));

    await waitFor(() => expect(envio().get("resultado")).toBe("reprogramada"));
    expect(envio().get("fechaReprogramacion")).toBe(mananaCalendarioCR());
  });

  it("N fotos viajan como N valores de la MISMA clave `evidencia`", async () => {
    const user = userEvent.setup();
    montar("rechazar");
    await subirFotos(user, 3);
    escribirMotivo("El cliente ya no quiere el pedido");

    await user.click(confirmar("rechazar"));

    await waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    // `append`, no `set`: el borde las lee con `getAll("evidencia")` y reconstruye la lista en el
    // orden en que se enviaron. Con `set` sólo llegaría la última y las otras dos se perderían sin
    // ningún error.
    expect(envio().getAll("evidencia")).toHaveLength(3);
  });

  it("el motivo viaja RECORTADO, sin los espacios de los bordes", async () => {
    const user = userEvent.setup();
    montar("rechazar");
    await subirFotos(user, 1);
    escribirMotivo("  El cliente ya no quiere el pedido  ");

    await user.click(confirmar("rechazar"));

    await waitFor(() =>
      expect(envio().get("motivo")).toBe("El cliente ya no quiere el pedido"),
    );
  });

  it("mientras el envío está en vuelo el botón se bloquea: no hay segunda gestión", async () => {
    // Un segundo clic sobre una orden que ya salió de ayuda no crearía una segunda gestión (la
    // guarda del `updateMany` del repositorio es la barrera real, R28), pero sí un segundo lote de
    // fotos huérfanas en el bucket y un segundo viaje. El `Modal` lo impide con su fase pendiente,
    // y esto lo afirma sobre ESTA ventana en vez de darlo por hecho.
    const user = userEvent.setup();
    let resolver: (v: { status: "ok"; ordenId: string; resultado: "rechazada" }) => void = () => {};
    gestionarMock.mockReturnValue(
      new Promise((res) => {
        resolver = res;
      }) as ReturnType<typeof gestionarDesdeAyuda>,
    );
    montar("rechazar");
    await subirFotos(user, 1);
    escribirMotivo("El cliente ya no quiere el pedido");
    const boton = confirmar("rechazar");

    await user.click(boton);

    // Deshabilitado y diciéndolo: el botón no parece muerto, dice que está trabajando.
    expect(boton).toBeDisabled();
    expect(boton).toHaveTextContent("Procesando…");
    await user.click(boton);
    expect(gestionarMock).toHaveBeenCalledTimes(1);

    resolver({ status: "ok", ordenId: "o1", resultado: "rechazada" });
  });
});

// =================================================================================================
// T7.2 — UN `validation_error` DEL SERVIDOR SE PINTA SIN PERDER LO CAPTURADO
// =================================================================================================

describe("237/R13 — el borde manda, y su rechazo no borra el formulario", () => {
  it("pinta el error del campo y CONSERVA motivo y fotos", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { motivo: ["motivo requerido"] },
    });
    const onResuelto = montar("rechazar");
    await subirFotos(user, 2);
    escribirMotivo("El cliente ya no quiere el pedido");

    await user.click(confirmar("rechazar"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("motivo requerido"),
    );
    // Lo capturado sigue ahí: las dos fotos costarían volver a elegirse una por una, y el modal
    // sigue abierto (`closeOnConfirm={false}`).
    expect(screen.getByLabelText(LABEL_MOTIVO)).toHaveValue(
      "El cliente ya no quiere el pedido",
    );
    expect(
      within(
        screen.getByRole("list", { name: "Fotos de evidencia seleccionadas" }),
      ).getAllByRole("img"),
    ).toHaveLength(2);
    // Y el padre NO se entera: un `validation_error` no es un desenlace de la orden.
    expect(onResuelto).not.toHaveBeenCalled();
  });

  it("el ESPEJO: un `ok` sí llega al padre, con su resultado", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "ok",
      ordenId: "o1",
      resultado: "rechazada",
    });
    const onResuelto = montar("rechazar");
    await subirFotos(user, 1);
    escribirMotivo("El cliente ya no quiere el pedido");

    await user.click(confirmar("rechazar"));

    await waitFor(() =>
      expect(onResuelto).toHaveBeenCalledWith({
        status: "ok",
        ordenId: "o1",
        resultado: "rechazada",
      }),
    );
  });
});

// =================================================================================================
// T7.4 — LA CARRERA PERDIDA (R25): LA VENTANA NO AFIRMA LO QUE NO PASÓ
// =================================================================================================

describe("237/R25 — un `conflict` sube al padre TAL CUAL, sin traducirlo a éxito", () => {
  it("el motivo del servidor viaja intacto", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "conflict",
      motivo: "Esta orden ya no está esperando tu respuesta.",
    });
    const onResuelto = montar("rechazar");
    await subirFotos(user, 1);
    escribirMotivo("El cliente ya no quiere el pedido");

    await user.click(confirmar("rechazar"));

    // El texto lo redacta el SERVIDOR y la pantalla no lo reescribe: dos redacciones de la misma
    // carrera son dos verdades. Y el `status` llega distinto de `ok`, que es lo que impide que el
    // módulo diga «la orden quedó rechazada» sobre una orden que nadie movió (236/D8).
    await waitFor(() =>
      expect(onResuelto).toHaveBeenCalledWith({
        status: "conflict",
        motivo: "Esta orden ya no está esperando tu respuesta.",
      }),
    );
  });

  // FEATURE 261 (F7, R32) — EL SEGUNDO RECHAZO QUE VIAJA POR ESTE MISMO CABLE: la orden reservada
  // para un día de reparto posterior. Decisión humana P2 (2026-08-22): si el problema es que se
  // registre un resultado en un día que no es, da igual quién lo registre.
  //
  // ⚠️ EL CONTROL NO SE DESHABILITA — decisión firmada (261/design §5.4, alternativa A13): la
  // tienda está en un escritorio y el rechazo es instantáneo; el mensajero está en la calle con el
  // paquete y por eso a él sí se le apaga el botón de antemano. Aquí se ofrece y se explica.
  it("261/R32: la reserva se rechaza con SU DÍA, y el confirmar nunca estuvo apagado por eso", async () => {
    const user = userEvent.setup();
    // El literal, a mano. La aserción de al lado es la que prueba que ES el del servidor: la
    // frase sale de `dia-reparto-textos` y el servicio la re-exporta, no la copia (R15).
    const AVISO_22 =
      "Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.";
    expect(MENSAJES_GESTION_DESDE_AYUDA.reservadaParaOtroDia("2026-08-22")).toBe(AVISO_22);

    gestionarMock.mockResolvedValue({ status: "conflict", motivo: AVISO_22 });
    const onResuelto = montar("rechazar");
    await subirFotos(user, 1);
    escribirMotivo("El cliente ya no quiere el pedido");

    // La asimetría, fijada donde vive: el botón se OFRECE. Si un día alguien lo apagara «ya que
    // estamos», este caso se pone rojo y obliga a reabrir la decisión en vez de deslizarla.
    expect(confirmar("rechazar")).toBeEnabled();

    await user.click(confirmar("rechazar"));

    await waitFor(() =>
      expect(onResuelto).toHaveBeenCalledWith({ status: "conflict", motivo: AVISO_22 }),
    );
  });
});
