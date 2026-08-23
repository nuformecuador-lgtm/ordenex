import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import {
  emitirDiaRepartoCorregido,
  textoDiaRepartoCorregido,
} from "@/lib/notificaciones/emitir";
import { notificarDiaRepartoCorregidoCon } from "@/lib/notificaciones/notificadores";

// FEATURE 262 (B23, D7) — EL AVISO AL MENSAJERO cuando le corrigen el dia de una orden suya.
// Molde de `tests/unit/services/notificacion-productores.test.ts`. Cubre R46, R47, R48, R49, R50,
// R51 y R55.

const MENSAJERO = "u-mensajero-1";
const OTRO_MENSAJERO = "u-mensajero-2";
const ORDEN_ID = "orden-17496963";
const MOTIVO_DE_QUIEN_CORRIGIO = "la bodega marco el lote para el 22 por error, y el cliente es hoy";

/**
 * Repositorio falso que aplica DE VERDAD la dedupe por `(evento, entidad, destinatario)`, igual que
 * `RepoFake` de `notificacion-productores.test.ts`. Es lo que permite que el caso de las dos
 * correcciones signifique algo: con un doble que siempre acepta, `entidadId` daria igual.
 */
class RepoFake implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  leidas = new Set<string>();

  async crear(input: CrearNotificacionInput): Promise<boolean> {
    this.creadas.push(input);
    return true;
  }

  async existeNoLeidaPara(
    evento: string,
    entidadId: string,
    destinatario: NotificacionDestinatario,
  ): Promise<boolean> {
    const clave = `${evento}|${entidadId}|${JSON.stringify(destinatario)}`;
    if (this.leidas.has(clave)) return false;
    return this.creadas.some(
      (c) =>
        c.evento === evento &&
        c.entidadId === entidadId &&
        JSON.stringify(c.destinatario) === JSON.stringify(destinatario),
    );
  }

  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

function ctx(overrides: Partial<Parameters<typeof emitirDiaRepartoCorregido>[1]> = {}) {
  return {
    cambioId: "cambio-1",
    mensajeroUsuarioId: MENSAJERO,
    fechaNuevaISO: "2026-08-22",
    anexo: "17496963",
    ...overrides,
  };
}

// =================================================================================================
// R46 / R51 — A QUIEN
// =================================================================================================

describe("262/R46 — el aviso va al MENSAJERO ASIGNADO, en UNA sola fila", () => {
  it("emite exactamente una fila `box` dirigida a ese usuario", async () => {
    const repo = new RepoFake();

    const emitidas = await emitirDiaRepartoCorregido(repo, ctx());

    expect(emitidas).toBe(1);
    expect(repo.creadas).toHaveLength(1);
    const fila = repo.creadas[0];
    expect(fila.destinatario).toEqual({ tipo: "usuario", usuarioId: MENSAJERO });
    expect(fila.evento).toBe("dia_reparto_corregido");
    expect(fila.entidadTipo).toBe("orden_dia_reparto_cambio");
    expect(fila.anexo).toBe("17496963");
  });

  it("`tipo: box` (paquete) y NO `alert`: una correccion de planificacion no es una alarma", () => {
    // Los tres tipos son `alert` (rojo, `text-danger`), `box` y `warning`. `alert` tenria de rojo
    // una correccion legitima; `warning` diria «pendiente de aprobacion», que no es.
    const repo = new RepoFake();
    return emitirDiaRepartoCorregido(repo, ctx()).then(() => {
      expect(repo.creadas[0].tipo).toBe("box");
    });
  });
});

describe("262/R51 — NADIE mas recibe el aviso", () => {
  it("ni maestro, ni admin, ni adminTienda, ni adminSatelite, ni la bodega", async () => {
    // Mata M-ae. Los admins son QUIENES CORRIGEN: avisarles de su propia accion es ruido, y
    // avisar a la tienda le contaria una decision de planificacion de la bodega.
    const repo = new RepoFake();

    await emitirDiaRepartoCorregido(repo, ctx());

    expect(repo.creadas).toHaveLength(1);
    for (const fila of repo.creadas) {
      expect(fila.destinatario.tipo).toBe("usuario");
      // Ni una sola fila dirigida a un ROL: si la hubiera, la veria todo ese rol.
      expect(fila.destinatario).not.toHaveProperty("rol");
    }
  });
});

// =================================================================================================
// R47 — EL TEXTO NOMBRA LA FECHA
// =================================================================================================

describe("262/R47 — el aviso nombra la FECHA, nunca «hoy» ni «mañana»", () => {
  it("⭑ la descripcion lleva la fecha en palabras y NO las dos palabras prohibidas", async () => {
    // ⚠️ ESTE ES EL TEST QUE MATA M-ad. La campana guarda 30 dias (`VENTANA_DIAS`): un aviso que
    // dijera «paso a hoy» y se leyera a la mañana siguiente seria FALSO. Es el mismo argumento con
    // el que la 261 puso la fecha en `avisoReservaParaOtroDia`.
    const repo = new RepoFake();

    await emitirDiaRepartoCorregido(repo, ctx({ fechaNuevaISO: "2026-08-22" }));

    const descripcion = repo.creadas[0].descripcion;
    expect(descripcion).toBe("Una orden tuya pasó al reparto del 22 de agosto.");
    expect(descripcion).not.toMatch(/\bhoy\b/i);
    expect(descripcion).not.toMatch(/\bmañana\b/i);
    expect(descripcion).not.toMatch(/\bmanana\b/i);
  });

  it("sin siglas, sin nombres de columna y sin `YYYY-MM-DD` a la vista", () => {
    const texto = textoDiaRepartoCorregido("2026-08-22");
    expect(texto).not.toContain("2026-08-22");
    expect(texto).not.toContain("fecha_reparto");
    expect(texto).not.toContain("SLA");
    expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("CONTRAPRUEBA: con otra fecha, el texto cambia (no es una cadena fija)", () => {
    // Sin esto, un texto constante pasaria las dos aserciones de arriba.
    expect(textoDiaRepartoCorregido("2026-08-22")).not.toBe(textoDiaRepartoCorregido("2026-12-01"));
    expect(textoDiaRepartoCorregido("2026-12-01")).toContain("1 de diciembre");
  });

  it("R47: el aviso IDENTIFICA la orden por su anexo (la guia, o la remision si no hay)", async () => {
    const conGuia = new RepoFake();
    await emitirDiaRepartoCorregido(conGuia, ctx({ anexo: "17496963" }));
    expect(conGuia.creadas[0].anexo).toBe("17496963");

    const sinGuia = new RepoFake();
    await emitirDiaRepartoCorregido(sinGuia, ctx({ cambioId: "cambio-2", anexo: "REM-88" }));
    expect(sinGuia.creadas[0].anexo).toBe("REM-88");
  });
});

// =================================================================================================
// R48 — LO QUE EL AVISO NO PUEDE LLEVAR
// =================================================================================================

describe("262/R48 — sin direccion, telefono, destinatario, monto NI el motivo escrito", () => {
  it("ningun campo de la fila contiene PII ni el motivo de quien corrigio", async () => {
    // A24: el motivo es texto libre de 10 a 300 caracteres escrito por un humano y puede llevar
    // cualquier cosa, incluido un telefono o un nombre. Se lee en el historial de la orden, que si
    // autoriza por orden; en la campana NO entra.
    const repo = new RepoFake();

    await emitirDiaRepartoCorregido(repo, ctx());

    const serializada = JSON.stringify(repo.creadas[0]);
    expect(serializada).not.toContain(MOTIVO_DE_QUIEN_CORRIGIO);
    for (const prohibido of ["motivo", "direccion", "telefono", "destinatario_nombre", "monto"]) {
      expect(Object.keys(repo.creadas[0])).not.toContain(prohibido);
    }
  });

  it("el CONTEXTO del emisor no tiene siquiera un hueco donde meter el motivo", () => {
    // La forma fuerte: no es que no se pase, es que no cabe. `DiaRepartoCorregidoContexto` tiene
    // cuatro campos y ninguno es el motivo.
    const contexto = ctx();
    expect(Object.keys(contexto).sort()).toEqual([
      "anexo",
      "cambioId",
      "fechaNuevaISO",
      "mensajeroUsuarioId",
    ]);
  });
});

// =================================================================================================
// R50 — EL TEST QUE MATA A20: DOS CORRECCIONES, DOS AVISOS
// =================================================================================================

describe("262/R50 — dos correcciones seguidas sobre la MISMA orden producen DOS avisos", () => {
  it("⭑⭑ el caso «mañana -> hoy» que la puerta humana nombro, y que llega SEGUNDO", async () => {
    // ⚠️⚠️ ESTE ES EL TEST QUE MATA **A20** Y **M-ab**, y es el corazon de §15 del diseño.
    //
    // `notificacion_dedupe_key` es UNIQUE sobre `(evento, entidad_id, destinatario_rol,
    // destinatario_usuario_id)` con `NULLS NOT DISTINCT`, y ADEMAS `emitirFilas` salta la creacion
    // cuando ya hay una NO LEIDA para esa misma terna. Con `entidad_id = <ordenId>` —que es lo que
    // A20 proponia— la SEGUNDA correccion de la misma orden para el mismo mensajero NO produciria
    // aviso jamas, y `NotificacionRepository.crear` absorberia ademas el `P2002` devolviendo
    // `false`: silencio absoluto.
    //
    // Y el caso que llega segundo es EXACTAMENTE el que motiva la feature: «mañana -> hoy» sobre
    // una orden que el mensajero ya lleva encima.
    const repo = new RepoFake();

    // Correccion 1: hoy -> mañana. Fila de rastro `cambio-1`.
    const primera = await emitirDiaRepartoCorregido(
      repo,
      ctx({ cambioId: "cambio-1", fechaNuevaISO: "2026-08-22" }),
    );
    // Correccion 2, sobre LA MISMA orden y el MISMO mensajero: mañana -> hoy. Fila `cambio-2`.
    const segunda = await emitirDiaRepartoCorregido(
      repo,
      ctx({ cambioId: "cambio-2", fechaNuevaISO: "2026-08-21" }),
    );

    expect(primera).toBe(1);
    expect(segunda, "la SEGUNDA correccion no aviso: la dedupe se la comio en silencio").toBe(1);
    expect(repo.creadas).toHaveLength(2);
    // Y las dos entidades son DISTINTAS: es lo que hace que la clave unica no pueda colisionar.
    expect(repo.creadas.map((c) => c.entidadId)).toEqual(["cambio-1", "cambio-2"]);
    // Los dos textos dicen la fecha correcta de SU correccion.
    expect(repo.creadas[0].descripcion).toContain("22 de agosto");
    expect(repo.creadas[1].descripcion).toContain("21 de agosto");
  });

  it("CONTRAPRUEBA: con el MISMO `entidadId` (o sea, con el `ordenId` de A20) el segundo SE PIERDE", async () => {
    // Esto es la mitad que demuestra que el test de arriba mide algo. Si la dedupe no existiera, el
    // caso bueno pasaria por casualidad y nadie se enteraria el dia que alguien «simplificara»
    // `entidadId` a la orden.
    const repo = new RepoFake();

    const primera = await emitirDiaRepartoCorregido(repo, ctx({ cambioId: ORDEN_ID }));
    const segunda = await emitirDiaRepartoCorregido(repo, ctx({ cambioId: ORDEN_ID }));

    expect(primera).toBe(1);
    expect(segunda).toBe(0); // el aviso se pierde EN SILENCIO
    expect(repo.creadas).toHaveLength(1);
  });

  it("dos mensajeros distintos sobre correcciones distintas reciben cada uno el suyo", async () => {
    const repo = new RepoFake();
    await emitirDiaRepartoCorregido(repo, ctx({ cambioId: "c-a", mensajeroUsuarioId: MENSAJERO }));
    await emitirDiaRepartoCorregido(repo, ctx({ cambioId: "c-b", mensajeroUsuarioId: OTRO_MENSAJERO }));
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "usuario", usuarioId: MENSAJERO },
      { tipo: "usuario", usuarioId: OTRO_MENSAJERO },
    ]);
  });
});

// =================================================================================================
// R55 — LOS DOS SENTIDOS
// =================================================================================================

describe("262/R55 — los dos sentidos avisan igual", () => {
  it("«mañana -> hoy» y «hoy -> mañana» producen un aviso cada uno, con su fecha", async () => {
    // Un solo texto para los dos sentidos: «paso al reparto del X» es cierto tanto si el dia se
    // adelanto como si se retraso, y evita que el emisor tenga que decidir cual es cual. El
    // mensajero compara con lo que ya sabe.
    const repo = new RepoFake();
    await emitirDiaRepartoCorregido(repo, ctx({ cambioId: "adelanta", fechaNuevaISO: "2026-08-21" }));
    await emitirDiaRepartoCorregido(repo, ctx({ cambioId: "retrasa", fechaNuevaISO: "2026-08-22" }));

    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas[0].descripcion).toContain("21 de agosto");
    expect(repo.creadas[1].descripcion).toContain("22 de agosto");
    // El mismo texto base en los dos: la app no explica su propia agenda.
    expect(repo.creadas[0].descripcion.replace("21 de agosto", "X")).toBe(
      repo.creadas[1].descripcion.replace("22 de agosto", "X"),
    );
  });
});

// =================================================================================================
// R49 — UN AVISO CAIDO NO TUMBA NADA, Y NO SE TRAGA EN SILENCIO
// =================================================================================================

describe("262/R49 — el notificador absorbe el fallo y lo REGISTRA con contexto", () => {
  it("no propaga el error y deja una entrada de log con la operacion y su causa", async () => {
    const errores: Error[] = [];
    const logger = { logError: (e: Error) => errores.push(e) };
    const repo = {
      crear: vi.fn(async () => {
        throw new Error("la base esta caida");
      }),
      existeNoLeidaPara: vi.fn(async () => false),
    } as unknown as INotificacionRepository;

    const notificar = notificarDiaRepartoCorregidoCon(repo, logger);
    await expect(notificar(ctx())).resolves.toBeUndefined();

    // No es un `catch` vacio (`docs/conventions.md`): queda registrado, con nombre y con causa.
    expect(errores).toHaveLength(1);
    expect(errores[0].message).toContain("dia_reparto_corregido");
    expect((errores[0] as Error & { cause?: Error }).cause?.message).toBe("la base esta caida");
  });

  it("cuando el productor termina bien, NO registra nada", async () => {
    const errores: Error[] = [];
    const repo = new RepoFake();
    await notificarDiaRepartoCorregidoCon(repo, { logError: (e: Error) => errores.push(e) })(ctx());
    expect(errores).toEqual([]);
    expect(repo.creadas).toHaveLength(1);
  });
});
