import { describe, it, expect } from "vitest";

import { avisoBloqueo } from "@/lib/constants/bloqueo-mensajero";
import {
  TEXTO_CIERRE_VENCIDO_BODEGA,
  textoCierreVencidoMensajero,
  textoMensajeroBloqueadoBodega,
} from "@/lib/notificaciones/emitir";
import { bloqueoDe, bloqueoTodosPorEnviar } from "@/tests/fixtures/bloqueo-cierre";

/**
 * FEATURE 271 (§10.2, Q6 CERRADA POR EL HUMANO EL 2026-08-23) — LOS CINCO LITERALES, QUE SON
 * CONTRATO.
 *
 * ⚠️ CADA LITERAL VA ESCRITO A MANO Y COMPLETO. NUNCA `expect(texto).toBe(avisoBloqueo(d))`: un
 * texto comparado contra la funcion que lo genera esta SIEMPRE VERDE y no afirma nada — pasa
 * aunque la funcion devuelva basura. Es una regla de este proyecto, y ya se aplica a proposito en
 * `tests/components/CierreDiaModule.test.tsx` y `RepartoModule.test.tsx`.
 *
 * ⚠️ LOS CINCO PERDIERON «Sí puedes seguir recibiendo asignaciones» Y «Sí puedes seguir recogiendo
 * en tiendas» al resolverse Q1. Las dos son FALSAS desde el 2026-08-23 —recibir trabajo nuevo,
 * reparto Y recoleccion, SI se bloquea— y no se sustituyen por nada. Un aviso que permite mas de lo
 * que el servidor acepta manda al mensajero al mostrador de la tienda a que le digan que no.
 *
 * ⚠️ LAS FECHAS SON DE LA **JORNADA**, no del nacimiento del cierre. El cierre del ejemplo nacio el
 * 22; el mensajero trabajo el 21, y 21 es lo que dice el texto (R57-R60). Cuando la jornada no es
 * fiable, la oracion de la fecha DESAPARECE ENTERA y el resto se lee igual de bien: por eso va
 * siempre en aposicion al final.
 */

const JORNADA = "2026-08-21";

/**
 * `V = N` — TODOS los pendientes en el tejado del mensajero, con DOS `rechazado`. Vive en el
 * fixture compartido (`bloqueoTodosPorEnviar`) y NO se compone con `bloqueoDe({ n, v: n })`: esa
 * fabrica pondria dos `vencido`, que R17 declara imposible.
 */
const bloqueoTodosSuyos = bloqueoTodosPorEnviar;

describe("271/§10.2 · los tres avisos al MENSAJERO (contrato Q6)", () => {
  it("1 · bloqueado por ACUMULAR (N>=2, V=0), con jornada fiable", () => {
    const texto = avisoBloqueo(bloqueoDe({ n: 2, v: 0, jornadaCR: JORNADA }), { conCta: false });

    expect(texto).toBe(
      "Tienes 2 cierres esperando aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Se desbloquea cuando la bodega apruebe el más antiguo, el del 21 de agosto.",
    );
  });

  it("1-bis · el MISMO caso SIN jornada fiable: la fecha desaparece entera (R60)", () => {
    const texto = avisoBloqueo(bloqueoDe({ n: 2, v: 0, jornadaCR: null }), { conCta: false });

    expect(texto).toBe(
      "Tienes 2 cierres esperando aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Se desbloquea cuando la bodega apruebe el más antiguo.",
    );
  });

  it("2 · bloqueado con algo que REENVIAR (V>=1, N=1)", () => {
    const texto = avisoBloqueo(bloqueoDe({ n: 1, v: 1 }), { conCta: false });

    expect(texto).toBe(
      "Tienes un cierre sin enviar a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envíalo a aprobación con el botón de abajo.",
    );
  });

  it("3 · bloqueado con LAS DOS COSAS (N>=2 y V>=1), con jornada fiable", () => {
    const texto = avisoBloqueo(bloqueoDe({ n: 2, v: 1, jornadaCR: JORNADA }), { conCta: false });

    expect(texto).toBe(
      "Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envía el que falta y espera a que la bodega apruebe el más antiguo, el del 21 de agosto.",
    );
  });

  it("3-bis · el MISMO caso SIN jornada fiable", () => {
    const texto = avisoBloqueo(bloqueoDe({ n: 2, v: 1, jornadaCR: null }), { conCta: false });

    expect(texto).toBe(
      "Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envía el que falta y espera a que la bodega apruebe el más antiguo.",
    );
  });

  it("3-ter · con TODOS los pendientes en SU tejado (V = N) el aviso cambia entero", () => {
    // ⚠️ ESTE CASO DECIA DOS COSAS FALSAS hasta el 2026-08-23, y las encontro el navegador, no la
    // suite: «Envía **el que falta**» en singular con dos por enviar, y «espera a que **la bodega**
    // apruebe el más antiguo» cuando el mas antiguo es SUYO —la bodega no lo va a aprobar sola—.
    // Texto aprobado por el humano ese dia. Sigue escrito A MANO y completo.
    const texto = avisoBloqueo(bloqueoTodosSuyos(2, JORNADA), { conCta: false });

    expect(texto).toBe(
      "Tienes 2 cierres sin resolver y ninguno se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envíalos a aprobación, empezando por el más antiguo, el del 21 de agosto.",
    );
  });

  it("3-ter-bis · el MISMO caso (V = N) SIN jornada fiable: la fecha desaparece entera", () => {
    const texto = avisoBloqueo(bloqueoTodosSuyos(2, null), { conCta: false });

    expect(texto).toBe(
      "Tienes 2 cierres sin resolver y ninguno se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envíalos a aprobación, empezando por el más antiguo.",
    );
  });

  it("3-quater · MIXTO con DOS por enviar (N=3, V=2): «Envía LOS QUE FALTAN»", () => {
    // El plural que faltaba: la rama mixta decia «el que falta» tambien con dos. Aqui SI queda un
    // `solicitado` (el mas viejo), asi que la espera a la bodega es cierta y la frase se conserva.
    const texto = avisoBloqueo(bloqueoDe({ n: 3, v: 2, jornadaCR: JORNADA }), { conCta: false });

    expect(texto).toBe(
      "Tienes 3 cierres sin resolver y 2 de ellos no se han enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envía los que faltan y espera a que la bodega apruebe el más antiguo, el del 21 de agosto.",
    );
  });

  it("un mensajero LIBRE no tiene aviso: cadena vacía, no un texto tranquilizador", () => {
    expect(avisoBloqueo(bloqueoDe({ n: 1, v: 0 }), { conCta: false })).toBe("");
    expect(avisoBloqueo(bloqueoDe({ n: 0, v: 0 }), { conCta: true })).toBe("");
  });
});

describe("271/R52 · la ÚNICA diferencia entre portales es el llamado a la acción", () => {
  it("caso 2 · en «Entregas»/«Recolección» el puntero cambia; lo demás es idéntico", () => {
    const texto = avisoBloqueo(bloqueoDe({ n: 1, v: 1 }), { conCta: true });

    expect(texto).toBe(
      "Tienes un cierre sin enviar a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Ve a «Cierre del día» para enviarlo a aprobación.",
    );
  });

  it("caso 3 · el puntero se AÑADE al final y va SIN objeto; lo demás no cambia", () => {
    // ⚠️ AQUI EL PUNTERO NO DICE «para enviarLO»: con dos cierres en juego, ese «lo» colgaba de «el
    // más antiguo» —el que resuelve la bodega— y nombraba justo el que el mensajero NO puede
    // enviar. Encontrado en el navegador el 2026-08-23 y corregido con aprobacion del humano; la
    // frase anterior ya dice QUE enviar. El caso 2 (un solo cierre) conserva su «para enviarlo».
    const texto = avisoBloqueo(bloqueoDe({ n: 2, v: 1, jornadaCR: JORNADA }), { conCta: true });

    expect(texto).toBe(
      "Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envía el que falta y espera a que la bodega apruebe el más antiguo, el del 21 de agosto. Ve a «Cierre del día».",
    );
  });

  it("caso 3 con V = N · mismo puntero sin objeto, sobre el texto nuevo", () => {
    const texto = avisoBloqueo(bloqueoTodosSuyos(2, JORNADA), { conCta: true });

    expect(texto).toBe(
      "Tienes 2 cierres sin resolver y ninguno se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envíalos a aprobación, empezando por el más antiguo, el del 21 de agosto. Ve a «Cierre del día».",
    );
  });

  it("caso 2 · el puntero de UN SOLO cierre CONSERVA su objeto: ahí no hay ambigüedad", () => {
    // La contraprueba del cambio de arriba: con un unico cierre el «lo» solo puede ser ese, y el
    // texto aprobado no se toca. Si alguien «unifica» los dos punteros, este caso lo dice.
    const texto = avisoBloqueo(bloqueoDe({ n: 1, v: 1 }), { conCta: true });

    expect(texto).toContain("Ve a «Cierre del día» para enviarlo a aprobación.");
  });

  it("caso 1 · SIN llamado a la acción en ningún portal: el mensajero no tiene nada que hacer", () => {
    // Inventarle un CTA aquí sería mandarlo a buscar un botón que no existe: sus dos cierres están
    // enviados y esperando al administrador.
    const conCta = avisoBloqueo(bloqueoDe({ n: 2, v: 0, jornadaCR: JORNADA }), { conCta: true });
    const sinCta = avisoBloqueo(bloqueoDe({ n: 2, v: 0, jornadaCR: JORNADA }), { conCta: false });

    expect(conCta).toBe(sinCta);
    expect(conCta).not.toContain("Ve a");
  });
});

describe("271/§10.2 · los dos avisos que van a la BODEGA (contrato Q6)", () => {
  it("4 · el corte creó un vencido — al MENSAJERO, con jornada fiable", () => {
    expect(textoCierreVencidoMensajero(JORNADA)).toBe(
      "Tu cierre del 21 de agosto venció sin enviarse a aprobación. No puedes entregar, cobrar ni recibir trabajo nuevo hasta que lo envíes.",
    );
  });

  it("4-bis · el mismo, SIN jornada fiable: «Tu cierre del día» (R60)", () => {
    expect(textoCierreVencidoMensajero(null)).toBe(
      "Tu cierre del día venció sin enviarse a aprobación. No puedes entregar, cobrar ni recibir trabajo nuevo hasta que lo envíes.",
    );
  });

  it("4-ter · el corte creó un vencido — a la BODEGA. NO nombra al mensajero (R45)", () => {
    expect(TEXTO_CIERRE_VENCIDO_BODEGA).toBe(
      "El cierre de un mensajero venció sin enviarse a aprobación.",
    );
  });

  it("5 · un mensajero quedó bloqueado por acumular — a la BODEGA, sin jornada fiable", () => {
    expect(textoMensajeroBloqueadoBodega(null)).toBe(
      "Un mensajero quedó bloqueado por acumular cierres sin aprobar. Aprueba el más antiguo para que pueda volver a trabajar.",
    );
  });

  it("5-bis · el mismo, CON jornada fiable: la fecha va en aposición", () => {
    expect(textoMensajeroBloqueadoBodega(JORNADA)).toBe(
      "Un mensajero quedó bloqueado por acumular cierres sin aprobar. Aprueba el más antiguo, el del 21 de agosto, para que pueda volver a trabajar.",
    );
  });
});

describe("271/R45/R46 · lo que los cinco NO dicen", () => {
  const todos = [
    avisoBloqueo(bloqueoDe({ n: 2, v: 0, jornadaCR: JORNADA }), { conCta: true }),
    avisoBloqueo(bloqueoDe({ n: 1, v: 1, jornadaCR: JORNADA }), { conCta: true }),
    avisoBloqueo(bloqueoDe({ n: 2, v: 1, jornadaCR: JORNADA }), { conCta: true }),
    avisoBloqueo(bloqueoTodosSuyos(2, JORNADA), { conCta: true }),
    textoCierreVencidoMensajero(JORNADA),
    TEXTO_CIERRE_VENCIDO_BODEGA,
    textoMensajeroBloqueadoBodega(JORNADA),
  ];

  it("R51: NINGUNO promete recibir asignaciones ni recoger en tiendas", () => {
    // La aserción NEGATIVA de la frase retirada. Es lo que impide que alguien la reponga «para
    // suavizar el mensaje»: era cierta hasta el 2026-08-22 y es falsa desde el 23.
    for (const t of todos) {
      expect(t).not.toMatch(/seguir recibiendo asignaciones/i);
      expect(t).not.toMatch(/seguir recogiendo en tiendas/i);
      expect(t).not.toMatch(/sí puedes/i);
    }
  });

  it("R45: ni monto, ni colón, ni identificadores, ni datos de nadie", () => {
    for (const t of todos) {
      expect(t).not.toMatch(/₡|\$|\d+\.\d{2}/); // ningún importe
      expect(t).not.toMatch(/@/); // ningún correo
      expect(t).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // ningún uuid
    }
  });

  it("R46: lenguaje claro, sin siglas ni jerga del sistema", () => {
    for (const t of todos) {
      expect(t).not.toMatch(/\bSLA\b|\bN\/V\b|cierre_dia|solicitado|vencido|rechazado/);
    }
  });
});
