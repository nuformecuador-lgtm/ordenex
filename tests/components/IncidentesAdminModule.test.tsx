// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import {
  IncidentesAdminModule,
  TITULO_PENDIENTES,
  TITULO_HISTORICO,
  VACIO_PENDIENTES,
  VACIO_HISTORICO,
  SIN_ZONA_AVISO,
  APROBAR_CONFIRMAR,
  RECHAZAR_CONFIRMAR,
  MONTO_LABEL,
  MONTO_EXCEDE,
  MONTO_FORMATO,
  MOTIVO_RECHAZO_LABEL,
  MOTIVO_RECHAZO_REQUERIDO,
  INDEMNIZACION_PENDIENTE_NOTA,
} from "@/app/(app)/incidentes/_components/IncidentesAdminModule";
import {
  verIncidente,
  aprobarIncidente,
  rechazarIncidente,
  listarHistoricoIncidentesPaginado,
  listarPendientesIncidentesPaginado,
} from "@/lib/actions/incidentes";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import { RECHAZADO_BLOQUEANTE_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";
import { montoValido } from "@/components/shared/monto-cliente";
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

// Feature 158 (T2.8 — R49/R50/R54/R55, camino del ADMIN) — la cola de aprobación de
// incidentes de `/incidentes`, espejo de `CierresAdminModule` (38).
//
// Lo que este archivo protege y NINGÚN test de backend puede proteger:
//   - que las DOS colas se pintan y que el histórico es de SOLO LECTURA (R49);
//   - que no se puede aprobar con un monto inválido, con el MISMO criterio que el servidor
//     —incluido el TOPE— y que el monto viaja STRING TAL CUAL, sin `parseFloat` (R50/R55);
//   - que no se puede rechazar sin motivo (R54);
//   - que la causa se pinta TRADUCIDA y nunca como slug, con el catálogo compartido;
//   - que un incidente `rechazado` NO hereda el marcador «bloqueante hasta re-solicitud» de
//     los cierres, que aquí sería FALSO.
vi.mock("@/lib/actions/incidentes", () => ({
  verIncidente: vi.fn(),
  aprobarIncidente: vi.fn(),
  rechazarIncidente: vi.fn(),
  retractarIncidente: vi.fn(),
  listarIncidentes: vi.fn(),
  reportarIncidente: vi.fn(),
  // Feature 170 — FASE 2 (T I.2): el histórico llega paginado del servidor.
  listarHistoricoIncidentesPaginado: vi.fn(),
  // Feature 170 — FASE 2 (T J.2): la COLA de pendientes también.
  listarPendientesIncidentesPaginado: vi.fn(),
}));

const { successMock, errorMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  refreshMock: vi.fn(),
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const verMock = vi.mocked(verIncidente);
const aprobarMock = vi.mocked(aprobarIncidente);
const rechazarMock = vi.mocked(rechazarIncidente);

function makeIncidente(
  over: Partial<IncidenteAdminDTO> & { incidenteId: string },
): IncidenteAdminDTO {
  return {
    ordenId: `o-${over.incidenteId}`,
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Beto Ruiz",
    zonaNombre: "GAM",
    estatusValue: "incidente",
    causa: "danado",
    motivo: "Caja aplastada en el estante 3",
    estado: "solicitado",
    indemnizacion: null,
    reportadoPorNombre: "Ana Admin",
    resueltoPorNombre: null,
    resueltoAt: null,
    motivoRechazo: null,
    createdAt: "2026-07-30T10:00:00.000Z",
    evidenciaUrls: ["https://signed.example/1?token=abc"],
    esPropio: false,
    ...over,
  };
}

/**
 * Feature 170 — FASE 2 (T I.2 el histórico, T J.2 la cola): las DOS tablas dejan de recibir un
 * array y reciben la PÁGINA que pre-carga el Server Component. El helper sigue recibiendo los
 * arrays para no reescribir cada caso, y ADEMÁS programa las dos Server Actions paginadas con
 * esas mismas páginas (SWR revalida al montar).
 */
function montar(
  props: Partial<{
    pendientes: IncidenteAdminDTO[];
    historico: IncidenteAdminDTO[];
    sinZona: boolean;
  }> = {},
) {
  const cola = paginaInicial(props.pendientes ?? []);
  const pagina = paginaInicial(props.historico ?? []);
  vi.mocked(listarPendientesIncidentesPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...cola,
  });
  vi.mocked(listarHistoricoIncidentesPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...pagina,
  });
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <IncidentesAdminModule
        pendientes={cola}
        historico={pagina}
        sinZona={props.sinZona ?? false}
      />
    </SWRConfig>,
  );
}

/** Abre el detalle del incidente `i` desde la cola de pendientes. */
async function abrirDetalle(
  user: ReturnType<typeof userEvent.setup>,
  i: IncidenteAdminDTO,
) {
  verMock.mockResolvedValue({ status: "ok", incidente: i });
  await user.click(
    screen.getByRole("button", {
      name: `Ver o decidir el incidente de la orden ${i.numRemision}`,
    }),
  );
  return screen.findByText("Detalle del incidente");
}

beforeEach(() => {
  vi.clearAllMocks();
  aprobarMock.mockResolvedValue({
    status: "ok",
    incidenteId: "i1",
    estado: "aprobado",
  });
  rechazarMock.mockResolvedValue({
    status: "ok",
    incidenteId: "i1",
    estado: "rechazado",
  });
});
afterEach(cleanup);

describe("Feature 158 (T2.8) — R49: las DOS colas", () => {
  it("pinta «Pendientes de decisión» y «Histórico», con sus tablas", () => {
    montar({
      pendientes: [makeIncidente({ incidenteId: "i1" })],
      historico: [
        makeIncidente({
          incidenteId: "i2",
          estado: "aprobado",
          numRemision: "REM-002",
          indemnizacion: "12500.00",
          resueltoPorNombre: "Carla Admin",
          resueltoAt: "2026-07-30T12:00:00.000Z",
        }),
      ],
    });
    expect(screen.getByRole("table", { name: TITULO_PENDIENTES })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: TITULO_HISTORICO })).toBeInTheDocument();
    expect(
      within(screen.getByRole("table", { name: TITULO_PENDIENTES })).getByText("REM-001"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("table", { name: TITULO_HISTORICO })).getByText("REM-002"),
    ).toBeInTheDocument();
  });

  it("la cabecera de pendientes lleva el RECUENTO", () => {
    montar({
      pendientes: [
        makeIncidente({ incidenteId: "i1" }),
        makeIncidente({ incidenteId: "i2", numRemision: "REM-002" }),
      ],
    });
    expect(
      screen.getByRole("heading", { name: `${TITULO_PENDIENTES} (2)` }),
    ).toBeInTheDocument();
  });

  it("sin datos, cada cola dice lo suyo (no un vacío mudo)", () => {
    montar();
    expect(screen.getByText(VACIO_PENDIENTES)).toBeInTheDocument();
    expect(screen.getByText(VACIO_HISTORICO)).toBeInTheDocument();
  });

  it("R48: un adminSatelite SIN zona ve un aviso accionable y NINGUNA cola", () => {
    montar({ sinZona: true, pendientes: [makeIncidente({ incidenteId: "i1" })] });
    expect(screen.getByRole("alert")).toHaveTextContent(SIN_ZONA_AVISO);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("el histórico es de SOLO LECTURA: su fila no ofrece decidir", async () => {
    const user = userEvent.setup();
    const resuelto = makeIncidente({
      incidenteId: "i2",
      estado: "aprobado",
      indemnizacion: "12500.00",
    });
    montar({ historico: [resuelto] });
    verMock.mockResolvedValue({ status: "ok", incidente: resuelto });
    await user.click(
      screen.getByRole("button", { name: "Ver el incidente de la orden REM-001" }),
    );
    await screen.findByText("Detalle del incidente");
    // Sin sección de decisión: un incidente ya resuelto no se vuelve a decidir (R53/R59).
    expect(screen.queryByRole("button", { name: "Aprobar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull();
  });
});

describe("Feature 158 (T2.8) — R45/R49: la causa se lee traducida, nunca el slug", () => {
  it.each(["danado", "perdido", "robado"] as const)(
    "la causa `%s` se pinta con su etiqueta del catálogo compartido",
    (causa) => {
      montar({ pendientes: [makeIncidente({ incidenteId: "i1", causa })] });
      const tabla = screen.getByRole("table", { name: TITULO_PENDIENTES });
      expect(within(tabla).getByText(CAUSA_INCIDENTE_LABEL[causa])).toBeInTheDocument();
      expect(within(tabla).queryByText(causa)).toBeNull();
    },
  );
});

describe("Feature 158 (T2.8) — el detalle trae lo que hace falta para decidir", () => {
  it("muestra causa, motivo, quién reportó, el estado de la orden y la evidencia FIRMADA", async () => {
    const user = userEvent.setup();
    const i = makeIncidente({ incidenteId: "i1" });
    montar({ pendientes: [i] });
    await abrirDetalle(user, i);

    const datos = screen.getByRole("region", { name: "Datos del incidente" });
    expect(within(datos).getByText(/Caja aplastada en el estante 3/)).toBeInTheDocument();
    expect(within(datos).getByText("Ana Admin")).toBeInTheDocument();
    expect(within(datos).getByText(CAUSA_INCIDENTE_LABEL.danado)).toBeInTheDocument();
    // El estado de la ORDEN va traducido con el mismo catálogo que el listado (29/R17).
    expect(within(datos).getByText("Incidente")).toBeInTheDocument();
    const evidencias = screen.getByRole("button", { name: "Ver evidencia 1" });
    expect(within(evidencias).getByRole("img")).toHaveAttribute(
      "src",
      "https://signed.example/1?token=abc",
    );
  });

  it("pide el detalle al SERVIDOR al abrirlo (URLs firmadas frescas, R46)", async () => {
    const user = userEvent.setup();
    const i = makeIncidente({ incidenteId: "i1" });
    montar({ pendientes: [i] });
    await abrirDetalle(user, i);
    expect(verMock).toHaveBeenCalledWith({ incidenteId: "i1" });
  });

  it("el «—» del monto pendiente lleva su NOTA: no significa «no se indemniza»", async () => {
    const user = userEvent.setup();
    const i = makeIncidente({ incidenteId: "i1", indemnizacion: null });
    montar({ pendientes: [i] });
    await abrirDetalle(user, i);
    expect(
      screen.getByLabelText(`Indemnización: ${INDEMNIZACION_PENDIENTE_NOTA}`),
    ).toHaveTextContent("—");
  });

  it("un incidente que ya no está → aviso y refresco, sin abrir un detalle vacío", async () => {
    const user = userEvent.setup();
    const i = makeIncidente({ incidenteId: "i1" });
    montar({ pendientes: [i] });
    verMock.mockResolvedValue({ status: "no_encontrada" });
    await user.click(
      screen.getByRole("button", { name: "Ver o decidir el incidente de la orden REM-001" }),
    );
    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(screen.queryByText("Detalle del incidente")).toBeNull();
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("Feature 158 (T2.8) — R50/R55: no se aprueba con un monto inválido", () => {
  async function abrirAprobacion(user: ReturnType<typeof userEvent.setup>) {
    const i = makeIncidente({ incidenteId: "i1" });
    montar({ pendientes: [i] });
    await abrirDetalle(user, i);
    await user.click(screen.getByRole("button", { name: "Aprobar" }));
    return screen.findByRole("button", { name: APROBAR_CONFIRMAR });
  }

  it("con el campo vacío, el confirmar está deshabilitado", async () => {
    const user = userEvent.setup();
    const confirmar = await abrirAprobacion(user);
    expect(confirmar).toBeDisabled();
    await user.click(confirmar);
    expect(aprobarMock).not.toHaveBeenCalled();
  });

  it.each(["0", "0.00", "-5", "12,50", "10.999", "abc", " "])(
    "el monto inválido «%s» NO habilita el confirmar ni llega a la action",
    async (valor) => {
      const user = userEvent.setup();
      const confirmar = await abrirAprobacion(user);
      fireEvent.change(screen.getByLabelText(MONTO_LABEL), { target: { value: valor } });
      expect(confirmar).toBeDisabled();
      await user.click(confirmar);
      expect(aprobarMock).not.toHaveBeenCalled();
    },
  );

  it("un monto por encima del TOPE se bloquea, y el mensaje dice QUÉ corregir", async () => {
    const user = userEvent.setup();
    const confirmar = await abrirAprobacion(user);
    fireEvent.change(screen.getByLabelText(MONTO_LABEL), {
      target: { value: "99999999999.99" }, // 11 dígitos enteros
    });
    expect(confirmar).toBeDisabled();
    // ⚠️ El esperado es un LITERAL, no `MONTO_EXCEDE`. Hasta la 230 esta línea comparaba la
    // constante contra sí misma: afirmaba una tautología, y por eso ningún rojo delató que el
    // mensaje hubiera pasado a anunciar `₡10.000.000.000` —un tope que la propia pantalla
    // rechaza—. Escrito el texto entero, cualquier cambio del tope pintado cae aquí.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El monto no puede superar ₡9.999.999.999 (10 dígitos y 2 decimales). Revisá si sobra un dígito.",
    );
  });

  it("el tope que ANUNCIA el mensaje es un monto que el validador ACEPTA", async () => {
    // La invariante detrás del literal de arriba, y la que de verdad importa: un máximo no
    // puede redondearse AL ALZA, porque entonces el texto ofrece como válido algo que el
    // borde rechaza. Se extrae la cifra del propio mensaje —sin escribirla otra vez— y se le
    // pasa al MISMO validador que gobierna el botón.
    const anunciado = /₡[\d.]+/.exec(MONTO_EXCEDE)?.[0] ?? "";
    expect(anunciado).not.toBe("");
    const digitos = anunciado.replace(/\D/g, "");

    expect(montoValido(digitos, INDEMNIZACION_MONTO_MAX)).toBe(true);
    // Y la contraprueba, con lo que el mensaje decía cuando estaba mal: el redondeo al alza
    // añadía un dígito y ese monto NO pasa. Si alguien lo devuelve, la línea de arriba cae.
    expect(montoValido("10000000000", INDEMNIZACION_MONTO_MAX)).toBe(false);
    // El contrato de datos NO se toca en esta feature: sigue siendo el de la columna.
    expect(INDEMNIZACION_MONTO_MAX).toBe("9999999999.99");
  });

  it("la ayuda del campo anuncia el MISMO tope que el error, y sin inflarlo", async () => {
    const user = userEvent.setup();
    await abrirAprobacion(user);
    const ayuda = screen.getByText(/Mayor que 0 y hasta/);
    expect(ayuda).toHaveTextContent(
      "Mayor que 0 y hasta ₡9.999.999.999, con hasta 2 decimales (por ejemplo 12500.00).",
    );
  });

  it("el máximo EXACTO se acepta (la frontera se caza por los DOS lados)", async () => {
    const user = userEvent.setup();
    const confirmar = await abrirAprobacion(user);
    fireEvent.change(screen.getByLabelText(MONTO_LABEL), {
      target: { value: INDEMNIZACION_MONTO_MAX },
    });
    expect(confirmar).toBeEnabled();
  });

  it("un monto MAL FORMADO recibe otro mensaje (son dos correcciones distintas)", async () => {
    const user = userEvent.setup();
    await abrirAprobacion(user);
    fireEvent.change(screen.getByLabelText(MONTO_LABEL), { target: { value: "12,50" } });
    expect(screen.getByRole("alert")).toHaveTextContent(MONTO_FORMATO);
  });

  it("con un monto válido, envía el STRING TAL CUAL (sin `parseFloat`, sin redondear)", async () => {
    const user = userEvent.setup();
    const confirmar = await abrirAprobacion(user);
    fireEvent.change(screen.getByLabelText(MONTO_LABEL), { target: { value: " 12500.50 " } });
    expect(confirmar).toBeEnabled();
    await user.click(confirmar);
    await vi.waitFor(() => expect(aprobarMock).toHaveBeenCalledTimes(1));
    expect(aprobarMock).toHaveBeenCalledWith({ incidenteId: "i1", monto: "12500.50" });
    const enviado = aprobarMock.mock.calls[0][0] as { monto: unknown };
    expect(typeof enviado.monto).toBe("string"); // money-safe: nunca `number`
  });

  it("el sub-modal de aprobación muestra la CAUSA: es el dato que justifica el monto", async () => {
    const user = userEvent.setup();
    await abrirAprobacion(user);
    expect(screen.getAllByText(CAUSA_INCIDENTE_LABEL.danado).length).toBeGreaterThan(0);
  });

  it("un `validation_error` del servidor se pinta y NO cierra el sub-modal", async () => {
    const user = userEvent.setup();
    aprobarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { monto: ["monto invalido"] },
    });
    const confirmar = await abrirAprobacion(user);
    fireEvent.change(screen.getByLabelText(MONTO_LABEL), { target: { value: "12500.00" } });
    await user.click(confirmar);
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("monto invalido"),
    );
    expect(screen.getByRole("button", { name: APROBAR_CONFIRMAR })).toBeInTheDocument();
  });
});

describe("Feature 158 (T2.8) — R54: no se rechaza sin motivo", () => {
  async function abrirRechazo(user: ReturnType<typeof userEvent.setup>) {
    const i = makeIncidente({ incidenteId: "i1" });
    montar({ pendientes: [i] });
    await abrirDetalle(user, i);
    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    return screen.findByRole("button", { name: RECHAZAR_CONFIRMAR });
  }

  it("sin motivo NO llama a la action y lo dice", async () => {
    const user = userEvent.setup();
    const confirmar = await abrirRechazo(user);
    await user.click(confirmar);
    expect(rechazarMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(MOTIVO_RECHAZO_REQUERIDO);
  });

  it("un motivo de sólo espacios tampoco cuenta", async () => {
    const user = userEvent.setup();
    const confirmar = await abrirRechazo(user);
    fireEvent.change(screen.getByLabelText(MOTIVO_RECHAZO_LABEL), {
      target: { value: "   " },
    });
    await user.click(confirmar);
    expect(rechazarMock).not.toHaveBeenCalled();
  });

  it("con motivo, envía el incidente y el motivo RECORTADO", async () => {
    const user = userEvent.setup();
    const confirmar = await abrirRechazo(user);
    fireEvent.change(screen.getByLabelText(MOTIVO_RECHAZO_LABEL), {
      target: { value: "  el paquete apareció  " },
    });
    await user.click(confirmar);
    await vi.waitFor(() => expect(rechazarMock).toHaveBeenCalledTimes(1));
    expect(rechazarMock).toHaveBeenCalledWith({
      incidenteId: "i1",
      motivo: "el paquete apareció",
    });
  });

  it("el rechazo NO manda monto por ninguna parte (R54: sin dinero)", async () => {
    const user = userEvent.setup();
    const confirmar = await abrirRechazo(user);
    fireEvent.change(screen.getByLabelText(MOTIVO_RECHAZO_LABEL), {
      target: { value: "no procede" },
    });
    await user.click(confirmar);
    await vi.waitFor(() => expect(rechazarMock).toHaveBeenCalledTimes(1));
    expect(Object.keys(rechazarMock.mock.calls[0][0] as object)).toEqual([
      "incidenteId",
      "motivo",
    ]);
  });
});

describe("Feature 158 (T2.8) — R55: los montos salen del STRING del servidor", () => {
  it("el histórico pinta el importe del servidor, redondeado y agrupado", () => {
    montar({
      historico: [
        makeIncidente({
          incidenteId: "i2",
          estado: "aprobado",
          indemnizacion: "1234567.89",
        }),
      ],
    });
    // Feature 230: el `,89` no se pinta, sube la unidad. Truncar daría `₡1.234.567`.
    expect(screen.getByText("₡1.234.568")).toBeInTheDocument();
  });

  // ⚠️ LO QUE ESTE BLOQUE PERDIÓ CON LA 230, dicho en voz alta. Estos tres casos existían
  // para matar una mutación concreta: renderizar con `parseFloat`, que se come los ceros de
  // la derecha de un importe de escala 2 (`"12500.00"` -> `12500`). Desde la 230 la pantalla
  // YA NO pinta los decimales, así que esa diferencia dejó de ser observable desde el DOM y
  // la mutación pasaría por aquí sin que nadie la viera. No se maquilla: los tres casos
  // pasan a afirmar el REDONDEO —que sí se ve, y distingue redondear de truncar— y el
  // barrido money-safe del final del bloque recupera lo que se perdió, mirando el fuente.
  it.each([
    ["12500.00", "₡12.500"],
    ["1200.50", "₡1.201"], // el medio se aleja del cero; truncar daría ₡1.200
    ["0.10", "₡0"], // ⚠️ una indemnización real de diez céntimos se lee «₡0» (A2)
  ])("el monto «%s» se pinta redondeado, sin cola decimal", (valor, pintado) => {
    montar({
      historico: [
        makeIncidente({ incidenteId: "i2", estado: "aprobado", indemnizacion: valor }),
      ],
    });
    expect(screen.getByText(pintado)).toBeInTheDocument();
  });

  it("el módulo no convierte ningún monto a número (money-safe, R55)", () => {
    // La red que reemplaza a la de arriba, en el único sitio donde ya se puede medir:
    // el CÓDIGO. Sin esto, un `parseFloat` metido en la celda del histórico no rompería
    // ni un solo caso de este archivo.
    const codigo = codigoSinComentarios(
      "app/(app)/incidentes/_components/IncidentesAdminModule.tsx",
    );
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(codigo, `el módulo llama a ${prohibida}`).not.toMatch(prohibida);
    }
    // Y la contraprueba, para que el barrido no pase por no mirar nada.
    expect(codigo.length).toBeGreaterThan(1000);
    expect("const x = parseFloat(monto);").toMatch(LLAMADAS_PROHIBIDAS_EN_DINERO[1]);
  });

  it("un rechazado no tiene monto y se pinta «—», no «₡0»", () => {
    montar({
      historico: [
        makeIncidente({
          incidenteId: "i3",
          estado: "rechazado",
          indemnizacion: null,
          motivoRechazo: "apareció",
        }),
      ],
    });
    const tabla = screen.getByRole("table", { name: TITULO_HISTORICO });
    expect(within(tabla).queryByText("₡0")).toBeNull();
  });
});

describe("Feature 158 (T2.8) — lo que NO se reusa de los cierres, y por qué", () => {
  it("un incidente RECHAZADO no hereda «bloqueante hasta re-solicitud» (sería falso)", () => {
    // En un cierre, `rechazado` bloquea al mensajero hasta que lo re-solicite (109/R31). Un
    // incidente rechazado devuelve la orden a su origen y no bloquea a nadie: copiar el
    // rótulo habría mentido sobre dinero y sobre estado.
    montar({
      historico: [
        makeIncidente({ incidenteId: "i3", estado: "rechazado", motivoRechazo: "apareció" }),
      ],
    });
    expect(screen.getByText("Rechazado")).toBeInTheDocument();
    expect(screen.queryByText(RECHAZADO_BLOQUEANTE_LABEL)).toBeNull();
  });
});
