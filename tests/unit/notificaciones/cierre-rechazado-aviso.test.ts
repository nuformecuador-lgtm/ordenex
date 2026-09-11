import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import {
  emitirCierreDiaRechazado,
  textoCierreRechazadoMensajero,
  type CierreRechazadoContexto,
} from "@/lib/notificaciones/emitir";
import { notificarCierreDiaRechazadoCon } from "@/lib/notificaciones/notificadores";

/**
 * FICHA 412 (T4.2/T4.3) — EL AVISO QUE FALTABA: «tu cierre fue rechazado», contra un repositorio
 * doble.
 *
 * Cubre R2 (UNA sola fila, y su destinatario es un USUARIO — ninguna de rol), R12 (sin jornada
 * fiable se omite la fecha, no se inventa), R13 (el texto dice la acción que le toca), R14 (con
 * bloqueo termina con la frase compartida), R15 (sin bloqueo NO afirma ninguna consecuencia) y
 * R16 (ni motivo, ni guía, ni monto, ni anexo).
 *
 * ⚠️ LOS LITERALES VAN ESCRITOS A MANO Y COMPLETOS. Nunca
 * `expect(texto).toBe(textoCierreRechazadoMensajero(...))`: un texto comparado contra la función
 * que lo genera está SIEMPRE VERDE y no afirma nada — pasa aunque la función devuelva basura. Es
 * una regla de este repo («aserción contra su propia fuente») y la misma que aplican
 * `bloqueo-textos.test.ts` y `cierre-vencido-destinatarios.test.ts`.
 *
 * ⚠️ QUÉ NO MIDE ESTE ARCHIVO. La dedupe de verdad la deciden el índice único
 * `notificacion_dedupe_key` y la guardia de no-leídas, y eso son dos cosas del MOTOR: viven en
 * `tests/integration/db/cierre-rechazado-aviso-dedupe.test.ts`, contra Postgres. Aquí se mide lo
 * que SÍ es del emisor: que la entidad LLEVE EL INSTANTE, para que la clave pueda distinguir dos
 * rechazos del mismo cierre.
 */

/** Repositorio doble que registra lo creado, con una dedupe REAL sobre la clave del índice. */
class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  private readonly claves = new Set<string>();
  private readonly noLeidas = new Set<string>();

  private clave(
    evento: NotificacionEvento,
    entidadId: string,
    destinatario: NotificacionDestinatario,
  ): string {
    const quien =
      destinatario.tipo === "rol"
        ? `rol:${destinatario.rol}:${destinatario.tiendaId ?? ""}:${destinatario.zonaId ?? ""}`
        : `usuario:${destinatario.usuarioId}`;
    return `${evento}|${entidadId}|${quien}`;
  }

  async crear(input: CrearNotificacionInput): Promise<string | null> {
    if (input.entidadId !== null) {
      const k = this.clave(input.evento, input.entidadId, input.destinatario);
      if (this.claves.has(k)) return null; // el real absorbe el `P2002` devolviendo `null`
      this.claves.add(k);
      this.noLeidas.add(k);
    }
    this.creadas.push(input);
    return `n-${this.creadas.length}`;
  }

  async existeNoLeidaPara(
    evento: NotificacionEvento,
    entidadId: string,
    destinatario: NotificacionDestinatario,
  ): Promise<boolean> {
    return this.noLeidas.has(this.clave(evento, entidadId, destinatario));
  }

  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

const CIERRE = "c-rechazado-1";
const MENSAJERO = "men-1";
/** El instante persistido del rechazo: la SEGUNDA mitad de la entidad. */
const RESUELTO = "2026-08-22T15:04:05.123Z";
const JORNADA = "2026-08-21";

function ctx(overrides: Partial<CierreRechazadoContexto> = {}): CierreRechazadoContexto {
  return {
    cierreId: CIERRE,
    resueltoAtISO: RESUELTO,
    mensajeroUsuarioId: MENSAJERO,
    jornadaCR: JORNADA,
    quedaBloqueado: true,
    ...overrides,
  };
}

// ===========================================================================================
// R12 · R13 · R14 · R15 — LOS TRES LITERALES, ESCRITOS A MANO
// ===========================================================================================

describe("412/R13/R14 — el texto dice QUÉ pasó, QUÉ le toca hacer y QUÉ no puede mientras tanto", () => {
  it("1 · jornada fiable + BLOQUEADO", () => {
    expect(textoCierreRechazadoMensajero("2026-08-21", true)).toBe(
      "Tu cierre del 21 de agosto fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo.",
    );
  });

  it("2 · jornada fiable y NO bloqueado (R15): la consecuencia desaparece entera", () => {
    expect(textoCierreRechazadoMensajero("2026-08-21", false)).toBe(
      "Tu cierre del 21 de agosto fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación.",
    );
  });

  it("3 · SIN jornada fiable (R12): se omite la fecha, no se inventa ninguna", () => {
    expect(textoCierreRechazadoMensajero(null, false)).toBe(
      "Tu cierre del día fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación.",
    );
  });

  it("4 · sin jornada Y bloqueado: las dos reglas conviven", () => {
    expect(textoCierreRechazadoMensajero(null, true)).toBe(
      "Tu cierre del día fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo.",
    );
  });

  it("R12: una jornada que NO se puede poner en palabras cae en «del día», sin cifras de fecha", () => {
    // `fechaLegible` devuelve la entrada tal cual cuando no la reconoce; en ese caso tampoco se
    // nombra. Es el mismo contrato que `textoCierreVencidoMensajero`.
    const texto = textoCierreRechazadoMensajero("no-es-una-fecha", false);
    expect(texto).toBe(
      "Tu cierre del día fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación.",
    );
    expect(texto).not.toMatch(/\d/);
  });

  it("⭑ R15: sin bloqueo el texto NO contiene «Mientras tanto» ni «no puedes»", () => {
    // La mutación que esto mata: poner la frase SIEMPRE. Un aviso que prohíbe más de lo que el
    // servidor prohíbe manda al mensajero a casa cuando podía seguir trabajando.
    const texto = textoCierreRechazadoMensajero(JORNADA, false);
    expect(texto).not.toContain("Mientras tanto");
    expect(texto).not.toContain("no puedes");
  });

  it("⭑ R14: con bloqueo el texto TERMINA con la frase, y es la frase compartida", () => {
    // La mutación que esto mata: quitarla siempre. El literal va a mano, no importado.
    expect(textoCierreRechazadoMensajero(JORNADA, true)).toMatch(
      /Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo\.$/,
    );
  });

  it("R13: la acción es REVISAR, CORREGIR y VOLVER A ENVIAR — las tres, y en ese orden", () => {
    // No basta «revísalo»: sólo el rechazo exige CORREGIR algo antes de reenviar, y ésa es la
    // diferencia entera con el aviso de vencido, que dice «hasta que lo envíes».
    const texto = textoCierreRechazadoMensajero(JORNADA, false);
    expect(texto).toContain("Revísalo, corrígelo y vuelve a enviarlo a aprobación.");
  });

  it("⭑ y dice «rechazado», que es la palabra que NINGÚN aviso del sistema decía", () => {
    for (const bloqueado of [true, false]) {
      expect(textoCierreRechazadoMensajero(JORNADA, bloqueado)).toContain("fue rechazado");
    }
  });
});

// ===========================================================================================
// R2 · R16 — UNA fila, a un USUARIO, sin nada que no deba estar
// ===========================================================================================

describe("412/R2 — UNA sola fila, dirigida al mensajero, y NINGUNA de rol", () => {
  it("⭑ emite exactamente una fila y su destinatario es `{tipo:'usuario'}`", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirCierreDiaRechazado(repo, ctx());

    expect(creadas).toBe(1);
    expect(repo.creadas).toHaveLength(1);
    const fila = repo.creadas[0];
    expect(fila.destinatario).toEqual({ tipo: "usuario", usuarioId: MENSAJERO });
  });

  it("⭑ ninguna fila va dirigida a un ROL (la mutación «añadir maestro» muere aquí)", async () => {
    const repo = new RepoDoble();

    await emitirCierreDiaRechazado(repo, ctx());

    const aRoles = repo.creadas.filter((f) => f.destinatario.tipo === "rol");
    expect(aRoles).toEqual([]);
  });

  it("la fila completa, campo por campo, con el `entidadId` escrito a mano", async () => {
    const repo = new RepoDoble();

    await emitirCierreDiaRechazado(repo, ctx({ jornadaCR: JORNADA, quedaBloqueado: false }));

    expect(repo.creadas[0]).toEqual({
      tipo: "alert",
      evento: "cierre_dia_rechazado",
      descripcion:
        "Tu cierre del 21 de agosto fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación.",
      anexo: null,
      entidadTipo: "cierre_dia_rechazo",
      // ⭑ LA FORMA EXACTA: cierre + ':' + instante ISO. Escrita a mano, no compuesta con las
      // constantes del contexto: es el contrato que hace que dos rechazos sean dos avisos.
      entidadId: "c-rechazado-1:2026-08-22T15:04:05.123Z",
      destinatario: { tipo: "usuario", usuarioId: MENSAJERO },
    });
  });

  it("⭑ el `entidadId` LLEVA EL INSTANTE: dos rechazos del mismo cierre son dos entidades", async () => {
    // La mutación del design (§12.1): `entidadId = ctx.cierreId`. Con ella las dos entidades
    // serían iguales, el doble deduplicaría y la segunda emisión crearía CERO filas — que es
    // exactamente el silencio que esta ficha viene a cerrar. Aquí se mide con el doble; contra
    // Postgres, en `cierre-rechazado-aviso-dedupe.test.ts`.
    const repo = new RepoDoble();

    await emitirCierreDiaRechazado(repo, ctx({ resueltoAtISO: "2026-08-22T09:00:00.000Z" }));
    const segunda = await emitirCierreDiaRechazado(
      repo,
      ctx({ resueltoAtISO: "2026-08-22T09:40:00.000Z" }),
    );

    expect(segunda).toBe(1);
    expect(repo.creadas.map((f) => f.entidadId)).toEqual([
      "c-rechazado-1:2026-08-22T09:00:00.000Z",
      "c-rechazado-1:2026-08-22T09:40:00.000Z",
    ]);
  });

  it("y el MISMO rechazo emitido dos veces deja UNA sola fila", async () => {
    const repo = new RepoDoble();

    const primera = await emitirCierreDiaRechazado(repo, ctx());
    const repetida = await emitirCierreDiaRechazado(repo, ctx());

    expect(primera).toBe(1);
    expect(repetida).toBe(0);
    expect(repo.creadas).toHaveLength(1);
  });

  it("R10: dos mensajeros distintos reciben cada uno el suyo", async () => {
    const repo = new RepoDoble();

    await emitirCierreDiaRechazado(repo, ctx({ cierreId: "c-a", mensajeroUsuarioId: "men-a" }));
    await emitirCierreDiaRechazado(repo, ctx({ cierreId: "c-b", mensajeroUsuarioId: "men-b" }));

    expect(repo.creadas.map((f) => f.destinatario)).toEqual([
      { tipo: "usuario", usuarioId: "men-a" },
      { tipo: "usuario", usuarioId: "men-b" },
    ]);
  });
});

describe("412/R16 — lo que el aviso NO dice, y no por disciplina: POR CONSTRUCCIÓN", () => {
  it("⭑ el contexto del emisor NO TIENE campo de motivo: no hay nada que filtrar", () => {
    // La mutación del design (§12.10): meter `motivoRechazo` en el contexto. Esto se pone rojo en
    // el acto, y ADEMÁS deja escrito que la ausencia es una decisión y no un descuido.
    const claves = Object.keys(ctx()).sort();
    expect(claves).toEqual([
      "cierreId",
      "jornadaCR",
      "mensajeroUsuarioId",
      "quedaBloqueado",
      "resueltoAtISO",
    ]);
    expect(claves).not.toContain("motivoRechazo");
    expect(claves).not.toContain("motivo");
  });

  it("⭑ un motivo-cebo con teléfono y monto dentro NO puede aparecer en el texto", async () => {
    // El cebo es un motivo REAL de los que un admin escribe: lleva un teléfono, un nombre y un
    // monto. Si algún día alguien añadiera el motivo al contexto, este caso lo caza.
    const CEBO = "Llamar a Ana al 8888-1234, faltan ₡45.000 de la guía 100234";
    const repo = new RepoDoble();

    await emitirCierreDiaRechazado(repo, { ...ctx(), ...({ motivoRechazo: CEBO } as object) });

    const texto = repo.creadas[0].descripcion;
    expect(texto).not.toContain(CEBO);
    expect(texto).not.toContain("8888-1234");
    expect(texto).not.toContain("Ana");
    expect(texto).not.toContain("₡");
    expect(texto).not.toContain("100234");
    // Ni guía, ni remisión, ni dirección: lo único numérico admisible es el día de la jornada.
    expect(texto.replace("21", "")).not.toMatch(/\d/);
  });

  it("⭑ el aviso NO lleva anexo", async () => {
    const repo = new RepoDoble();

    await emitirCierreDiaRechazado(repo, ctx());

    expect(repo.creadas[0].anexo).toBeNull();
  });
});

// ===========================================================================================
// R4 — el camino REAL, absorbiendo su fallo y dejándolo registrado
// ===========================================================================================

describe("412/R4 — el notificador real es BEST-EFFORT y no es un `catch` vacío", () => {
  it("un repositorio que revienta no propaga, y el fallo queda REGISTRADO con su operación", async () => {
    const repo = {
      crear: vi.fn(async () => {
        throw new Error("base caida");
      }),
      existeNoLeidaPara: vi.fn(async () => false),
      listarParaUsuario: vi.fn(),
      verificarVisible: vi.fn(),
      marcarTodasLeidas: vi.fn(),
      descartar: vi.fn(),
    } as unknown as INotificacionRepository;
    const logger = { logError: vi.fn() };

    await expect(notificarCierreDiaRechazadoCon(repo, logger)(ctx())).resolves.toBeUndefined();

    expect(logger.logError).toHaveBeenCalledTimes(1);
    const error = logger.logError.mock.calls[0][0] as Error;
    expect(error.message).toContain("cierre_dia_rechazado");
    expect((error.cause as Error).message).toBe("base caida");
  });

  it("y el nombre de la operación que se registra NO lleva ni ids ni PII (R16)", async () => {
    const repo = {
      crear: vi.fn(async () => {
        throw new Error("base caida");
      }),
      existeNoLeidaPara: vi.fn(async () => false),
      listarParaUsuario: vi.fn(),
      verificarVisible: vi.fn(),
      marcarTodasLeidas: vi.fn(),
      descartar: vi.fn(),
    } as unknown as INotificacionRepository;
    const logger = { logError: vi.fn() };

    await notificarCierreDiaRechazadoCon(repo, logger)(ctx());

    const error = logger.logError.mock.calls[0][0] as Error;
    expect(error.message).not.toContain(CIERRE);
    expect(error.message).not.toContain(MENSAJERO);
  });

  it("el camino feliz del notificador real SÍ emite (control positivo)", async () => {
    // Sin este control, los dos casos de arriba pasarían aunque el notificador no hiciera nada.
    const repo = new RepoDoble();

    await notificarCierreDiaRechazadoCon(repo)(ctx());

    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0].evento).toBe("cierre_dia_rechazado");
  });
});
