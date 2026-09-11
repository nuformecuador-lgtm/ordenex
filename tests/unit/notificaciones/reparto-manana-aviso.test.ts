import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import {
  emitirRepartoManana,
  textoRepartoManana,
  type RepartoMananaContexto,
} from "@/lib/notificaciones/emitir";
import { notificarRepartoMananaCon } from "@/lib/notificaciones/notificadores";

/**
 * FICHA 413 (T4.1/T4.2) — «TENÉS N ÓRDENES PARA MAÑANA», contra un repositorio doble.
 *
 * Cubre R5 (UNA sola fila cualquiera que sea el número), R15 (el texto persistido NO lleva el
 * número), R28 (SÍ lleva la fecha en palabras) y R29 (sin PII de ninguna clase).
 *
 * ⚠️ LOS LITERALES VAN ESCRITOS A MANO Y COMPLETOS. Nunca
 * `expect(texto).toBe(textoRepartoManana(...))`: un texto comparado contra la función que lo
 * genera está SIEMPRE VERDE y no afirma nada — pasa aunque la función devuelva basura. Es una
 * regla de este repo («aserción contra su propia fuente»), y aquí importa el doble: R15 dice que
 * el texto NO PUEDE llevar el número, y esa propiedad sólo se ve si el literal está escrito.
 *
 * ⚠️ QUÉ NO MIDE ESTE ARCHIVO. La dedupe de verdad la deciden el índice único
 * `notificacion_dedupe_key` y la guardia de no-leídas, que son dos cosas del MOTOR: viven en
 * `tests/integration/db/reparto-manana-aviso-dedupe.test.ts`, contra Postgres. Aquí se mide lo que
 * SÍ es del emisor: que la entidad sea EL DÍA ANUNCIADO y que el destinatario sea un USUARIO.
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

const MENSAJERO = "u-mensajero-413";
const DIA_ANUNCIADO = "2026-09-12";

function ctx(over: Partial<RepartoMananaContexto> = {}): RepartoMananaContexto {
  return { mensajeroUsuarioId: MENSAJERO, diaAnunciadoISO: DIA_ANUNCIADO, ...over };
}

describe("413/R28 — el texto persistido NOMBRA LA FECHA del día anunciado", () => {
  it("⭑ literal completo, escrito a mano", () => {
    // «12 de septiembre» sale de `fechaLegible`, el MISMO formateador del selector del día y del
    // aviso de la 262: se importa la conversión, no un literal suelto.
    expect(textoRepartoManana("2026-09-12")).toBe(
      "Es tu reparto del 12 de septiembre. Revisá la lista para organizarte.",
    );
  });

  it("otro mes, para que el formateador no pueda estar clavado a uno", () => {
    expect(textoRepartoManana("2027-01-01")).toBe(
      "Es tu reparto del 1 de enero. Revisá la lista para organizarte.",
    );
  });

  it("lo que NO es una fecha calendario no produce basura con pinta de dato", () => {
    // `fechaLegible` devuelve la entrada tal cual cuando no casa el patrón; el emisor no puede
    // escribir «Es tu reparto del mañana». La frase pierde precisión y sigue siendo cierta.
    expect(textoRepartoManana("")).toBe(
      "Es tu reparto del día siguiente. Revisá la lista para organizarte.",
    );
  });

  it("VOSEO, como el resto del vocabulario al mensajero", () => {
    // «Revisá», no «Revisa»: la 409 fijó el registro con «Coordiná la devolución» y «revisalas una
    // por una». Se afirma la palabra, no el estilo en abstracto.
    expect(textoRepartoManana(DIA_ANUNCIADO)).toContain("Revisá");
  });
});

describe("413/R15 — el texto persistido NO lleva el número, y esto es la mitad de la ficha", () => {
  it("⭑ la descripción no contiene NINGÚN dígito de conteo", () => {
    // ⚠️ EL ASERTO. Un número persistido es un número que queda obsoleto en cuanto entra una orden
    // más y que nadie corrige — y el mensajero aprende que el aviso miente. El número vive SÓLO en
    // el título, que el catálogo recompone con la cifra VIVA en cada lectura (R13).
    //
    // MUTACIÓN OBLIGATORIA (design §13.8): persistir el número en la `descripcion` ⇒ ROJO AQUÍ.
    //
    // La comprobación se hace sobre el texto SIN la fecha: la fecha sí lleva dígitos (el día y el
    // año), y son legítimos. Lo que no puede aparecer es un conteo.
    const texto = textoRepartoManana(DIA_ANUNCIADO);
    const sinFecha = texto.replace("12 de septiembre", "<FECHA>");
    expect(sinFecha).toBe("Es tu reparto del <FECHA>. Revisá la lista para organizarte.");
    expect(/\d/.test(sinFecha), `la descripción persiste una cifra: "${texto}"`).toBe(false);
  });

  it("⭑ y el texto es EL MISMO tenga el mensajero 1 orden o 40", () => {
    // La otra forma de decir R15: la función NI SIQUIERA RECIBE el número. No hay nada que
    // filtrar, porque no hay nada que entre. Si alguien le añadiera el parámetro, este archivo
    // dejaría de compilar.
    const uno = textoRepartoManana(DIA_ANUNCIADO);
    const cuarenta = textoRepartoManana(DIA_ANUNCIADO);
    expect(uno).toBe(cuarenta);
  });
});

describe("413/R29 — sin PII: ni guía, ni remisión, ni dirección, ni teléfono, ni tienda, ni monto", () => {
  it("⭑ el texto es una fecha y una instrucción, y nada más", () => {
    const texto = textoRepartoManana(DIA_ANUNCIADO).toLowerCase();
    for (const prohibido of [
      "guía",
      "guia",
      "remisión",
      "remision",
      "dirección",
      "direccion",
      "teléfono",
      "telefono",
      "destinatario",
      "tienda",
      "₡",
      "monto",
      "$",
    ]) {
      expect(texto.includes(prohibido), `el texto nombra "${prohibido}"`).toBe(false);
    }
  });

  it("y el CONTEXTO del emisor tampoco puede llevar PII: sólo tiene dos campos", () => {
    // No es disciplina, es construcción: `RepartoMananaContexto` tiene un id de usuario y una
    // fecha. Si alguien le añadiera un campo con PII, este aserto se pone rojo y obliga a mirarlo.
    expect(Object.keys(ctx()).sort()).toEqual(["diaAnunciadoISO", "mensajeroUsuarioId"]);
  });
});

describe("413/R5 — UNA sola fila, cualquiera que sea el número de órdenes", () => {
  it("⭑ con 40 órdenes en su reparto, `crear` se llama EXACTAMENTE UNA VEZ", async () => {
    // El emisor ni siquiera conoce el 40 — y eso ES la prueba de R5: no hay forma de que emita una
    // notificación por orden, porque las órdenes no entran aquí. Lo que se cuenta son FILAS.
    const repo = new RepoDoble();

    const creadas = await emitirRepartoManana(repo, ctx());

    expect(creadas).toBe(1);
    expect(repo.creadas).toHaveLength(1);
  });

  it("⭑ y esa fila va dirigida a un USUARIO, no a un rol (R6/R8)", async () => {
    const repo = new RepoDoble();

    await emitirRepartoManana(repo, ctx());

    const fila = repo.creadas[0];
    // Literales a mano, no leídos del emisor.
    expect(fila.evento).toBe("reparto_manana");
    expect(fila.tipo).toBe("box");
    expect(fila.entidadTipo).toBe("reparto_manana_dia");
    expect(fila.destinatario).toEqual({ tipo: "usuario", usuarioId: MENSAJERO });
    // SIN ANEXO: la fecha ya va dentro del texto.
    expect(fila.anexo).toBeNull();
  });

  it("⭑ la ENTIDAD es el DÍA ANUNCIADO, y SÓLO el día (design §7)", async () => {
    // ⚠️ Sin prefijo de mensajero, al contrario que los dos avisos de la 409: aquí el destinatario
    // es un USUARIO y `destinatario_usuario_id` YA ESTÁ en la clave única. Lo que sostiene esta
    // decisión no es este aserto sino R7, con dos mensajeros contra Postgres real; aquí sólo se
    // fija la FORMA de la entidad, escrita a mano.
    const repo = new RepoDoble();

    await emitirRepartoManana(repo, ctx());

    expect(repo.creadas[0].entidadId).toBe("2026-09-12");
    expect(repo.creadas[0].entidadId).not.toContain(MENSAJERO);
    expect(repo.creadas[0].entidadId).not.toContain(":");
  });

  it("dos noches consecutivas producen DOS filas (la entidad cambia)", async () => {
    // La mitad estructural de R23, vista desde el emisor. La otra mitad —que el índice único las
    // admita— vive contra Postgres.
    const repo = new RepoDoble();

    await emitirRepartoManana(repo, ctx({ diaAnunciadoISO: "2026-09-12" }));
    await emitirRepartoManana(repo, ctx({ diaAnunciadoISO: "2026-09-13" }));

    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas.map((f) => f.entidadId)).toEqual(["2026-09-12", "2026-09-13"]);
  });

  it("la MISMA noche emitida dos veces deja UNA (la guardia de no-leídas la para)", async () => {
    const repo = new RepoDoble();

    const primera = await emitirRepartoManana(repo, ctx());
    const repetida = await emitirRepartoManana(repo, ctx());

    expect(primera).toBe(1);
    expect(repetida).toBe(0);
    expect(repo.creadas).toHaveLength(1);
  });

  it("⭑ dos mensajeros la misma noche reciben CADA UNO el suyo", async () => {
    // La entidad es la MISMA (el día), así que lo único que las separa es el destinatario. Si
    // alguien dirigiera el aviso a un rol, aquí saldría 1 y esto se pondría rojo — es el mismo
    // silencio que la 409 destapó, cazado ya en el doble antes de llegar a Postgres.
    const repo = new RepoDoble();

    await emitirRepartoManana(repo, ctx({ mensajeroUsuarioId: "u-a" }));
    await emitirRepartoManana(repo, ctx({ mensajeroUsuarioId: "u-b" }));

    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas.map((f) => f.destinatario)).toEqual([
      { tipo: "usuario", usuarioId: "u-a" },
      { tipo: "usuario", usuarioId: "u-b" },
    ]);
  });
});

describe("413/T4.2 — el camino REAL del notificador emite, y el no-op no escribe", () => {
  it("⭑ `notificarRepartoMananaCon(repoDoble)` crea la fila", async () => {
    const repo = new RepoDoble();

    await notificarRepartoMananaCon(repo)(ctx());

    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0].evento).toBe("reparto_manana");
  });

  it("⭑ y ABSORBE el fallo del repositorio sin propagarlo (R34: la corrida manda)", async () => {
    // Best-effort de verdad: se le pasa un logger doble para comprobar que NO es un `catch` vacío
    // —el fallo queda registrado con su operación y su causa—.
    const repo = new RepoDoble();
    repo.crear = vi.fn(async () => {
      throw new Error("la base se cayó");
    });
    const logger = { logError: vi.fn() };

    await expect(notificarRepartoMananaCon(repo, logger)(ctx())).resolves.toBeUndefined();

    expect(logger.logError).toHaveBeenCalledTimes(1);
  });
});
