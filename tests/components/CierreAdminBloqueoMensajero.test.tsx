// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { CierreFacturaResumen } from "@/app/(app)/cierres-admin/_components/cierre-factura";
import { notaMensajeroBloqueado } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import type {
  BloqueoMensajeroEnFila,
  CierreAdminResumen,
} from "@/lib/interfaces/services/ICierresAdminService";

/**
 * =================================================================================================
 * FEATURE 271 (R48) — LA ADMINISTRACIÓN VE, EN LA FILA DEL CIERRE, QUE ESE MENSAJERO ESTÁ
 * BLOQUEADO Y POR QUÉ.
 * =================================================================================================
 *
 * EL PROBLEMA MEDIDO, y por qué no se resolvió por el camino corto. Un cierre `rechazado` NO entra
 * en la cola de «pendientes de decisión» y no va a entrar: lo decidió el humano el 2026-08-23,
 * porque sobre ese cierre la bodega YA decidió y la cola significa «pendiente de MI decisión».
 * Consecuencia: un mensajero podía arrastrar dos cierres sin aprobar y la administración ver una
 * sola fila. Y aprobar el más antiguo es justamente lo que lo desbloquea — quien decide necesitaba
 * saberlo, y no lo sabía.
 *
 * POR QUÉ EN LA FILA: es un dato DE la fila (del dueño de ese cierre), llega con ella en la misma
 * lectura y no cuesta una consulta más. Una cola nueva habría cambiado lo que la cola existente
 * significa, y la leen tres pantallas.
 *
 * ⚠️ SE MONTA EL COMPROBANTE, NO EL MÓDULO ENTERO, y a propósito: el mismo comprobante lo usan las
 * DOS listas —la cola y el histórico—, que es justo el caso que R48 viene a resolver (un mensajero
 * con dos cierres puede tener uno en cada lista). Probarlo aquí lo cubre en las dos.
 */

const TOTALES = {
  efectivo: "1000.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "1000.00",
};

function resumen(bloqueoMensajero?: BloqueoMensajeroEnFila): CierreAdminResumen {
  return {
    cierreId: "c1000001",
    mensajeroId: "m1",
    mensajeroNombre: "Ana Pérez",
    bloqueoMensajero,
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "GAM",
    totales: TOTALES,
    totalPagoMensajero: "1200.00",
    totalIngresoBodegaRechazos: "0.00",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-08-13T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
  };
}

/** La hoja compacta, localizada por su nombre accesible (nunca por una clase). */
function hoja(): HTMLElement {
  return screen.getByRole("region", { name: "Comprobante del cierre de Ana Pérez" });
}

afterEach(() => {
  cleanup();
});

describe("271/R48 · el marcador de «mensajero bloqueado» en la fila del cierre", () => {
  it("con el mensajero bloqueado, la fila lo dice y trae el NÚMERO a la vista", () => {
    render(
      <CierreFacturaResumen
        cierre={resumen({ bloqueado: true, cierresAbiertos: 2, cierresPorReenviar: 1 })}
      />,
    );

    // El número va EN el marcador, no sólo en el `title`: es el dato que decide si esta fila es
    // urgente, y un tooltip no se lee ni en un móvil ni con el teclado.
    expect(hoja()).toHaveTextContent("Mensajero bloqueado · 2");
  });

  it("R48: el detalle completo va en el nombre accesible, con cuántos y qué hacer", () => {
    render(
      <CierreFacturaResumen
        cierre={resumen({ bloqueado: true, cierresAbiertos: 2, cierresPorReenviar: 1 })}
      />,
    );

    // ⚠️ EL LITERAL VA A MANO Y COMPLETO. Compararlo contra `notaMensajeroBloqueado(...)` estaría
    // siempre verde: pasaría aunque la función devolviera basura.
    expect(
      screen.getByLabelText(
        "Este mensajero arrastra 2 cierres sin aprobar, y 1 de ellos espera a que él lo vuelva a enviar. Mientras tanto no puede entregar, cobrar ni recibir trabajo nuevo. Aprueba el más antiguo para desbloquearlo.",
      ),
    ).toBeInTheDocument();
  });

  it("con el mensajero LIBRE no se pinta nada: una fila limpia no afirma un veredicto", () => {
    render(
      <CierreFacturaResumen
        cierre={resumen({ bloqueado: false, cierresAbiertos: 1, cierresPorReenviar: 0 })}
      />,
    );

    expect(hoja()).not.toHaveTextContent(/mensajero bloqueado/i);
  });

  it("sin el dato (consumidor que no lo trae) tampoco se pinta, en vez de inventar «libre»", () => {
    // El campo es OPCIONAL en el tipo, y esa es la diferencia entre «no está bloqueado» y «no se
    // sabe». Pintar «libre» sobre un `undefined` sería afirmar un veredicto que nadie calculó.
    render(<CierreFacturaResumen cierre={resumen(undefined)} />);

    expect(hoja()).not.toHaveTextContent(/mensajero bloqueado/i);
  });

  it("R48: convive con el rótulo que ya traía la fila, sin desplazarlo", () => {
    // El histórico pasa su propia marca («Bloqueante hasta re-solicitud», «Pendiente de
    // liquidar»…). El marcador nuevo se AÑADE; si se sustituyeran, la fila perdería un dato sin
    // que nada avisara.
    render(
      <CierreFacturaResumen
        cierre={resumen({ bloqueado: true, cierresAbiertos: 2, cierresPorReenviar: 2 })}
        rotulo={<span>Rótulo del histórico</span>}
      />,
    );

    expect(hoja()).toHaveTextContent("Rótulo del histórico");
    expect(hoja()).toHaveTextContent("Mensajero bloqueado · 2");
  });
});

describe("271/R46/R48 · la nota, en lenguaje claro y concordando en número", () => {
  // La nota CUENTA, así que no puede ser una constante: se compone. Y las tres formas se afirman
  // enteras porque un plural mal concordado en el sitio donde alguien decide sobre dinero se lee
  // como descuido del sistema, no del texto.

  it("un solo cierre y ninguno esperando al mensajero", () => {
    expect(notaMensajeroBloqueado({ cierresAbiertos: 1, cierresPorReenviar: 0 })).toBe(
      "Este mensajero arrastra 1 cierre sin aprobar. Mientras tanto no puede entregar, cobrar ni recibir trabajo nuevo. Aprueba el más antiguo para desbloquearlo.",
    );
  });

  it("dos cierres, ninguno esperando al mensajero (el caso de la ACUMULACIÓN)", () => {
    expect(notaMensajeroBloqueado({ cierresAbiertos: 2, cierresPorReenviar: 0 })).toBe(
      "Este mensajero arrastra 2 cierres sin aprobar. Mientras tanto no puede entregar, cobrar ni recibir trabajo nuevo. Aprueba el más antiguo para desbloquearlo.",
    );
  });

  it("dos cierres y los DOS esperando a que él los reenvíe", () => {
    expect(notaMensajeroBloqueado({ cierresAbiertos: 2, cierresPorReenviar: 2 })).toBe(
      "Este mensajero arrastra 2 cierres sin aprobar, y 2 de ellos esperan a que él los vuelva a enviar. Mientras tanto no puede entregar, cobrar ni recibir trabajo nuevo. Aprueba el más antiguo para desbloquearlo.",
    );
  });

  it("R46: sin siglas ni nombres de estado del sistema, y sin ninguna fecha inventada", () => {
    const nota = notaMensajeroBloqueado({ cierresAbiertos: 2, cierresPorReenviar: 1 });

    // Nada de «vencido»/«rechazado»/«solicitado»: son estados internos, y quien lee esta fila
    // decide sobre dinero, no depura la base.
    expect(nota).not.toMatch(/vencido|rechazado|solicitado|cierre_dia/);
    // Y NINGUNA fecha: la fila no trae la jornada, y derivarla aquí daría la de creación — que en
    // un cierre vencido va un día por delante del día que el mensajero trabajó.
    expect(nota).not.toMatch(
      /\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i,
    );
    expect(nota).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
