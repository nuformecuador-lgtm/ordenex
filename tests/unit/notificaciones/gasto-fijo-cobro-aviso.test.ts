import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import {
  emitirGastoFijoCobroPendiente,
  textoCobrosGastoFijoPendientes,
} from "@/lib/notificaciones/emitir";
import { notificarGastoFijoCobroPendienteCon } from "@/lib/notificaciones/notificadores";

// FICHA 333 (E4) — el AVISO de «quedan cobros de gasto fijo por aprobar», contra un repositorio
// doble.
//
// Cubre R29 (con pendientes, el aviso lleva el NUMERO), R30 (dos dias seguidos con el mismo
// pendiente producen DOS avisos, porque la entidad es EL DIA), R32 (sin pendientes no se emite
// nada — se prueba en el servicio, y aqui su contraparte: el emisor no inventa un aviso de cero),
// R33 (un notificador que revienta no propaga y queda REGISTRADO) y R35 (el texto no lleva monto,
// ni concepto, ni nombre).
//
// ⚠️ LA MITAD DE R31 VIVE EN EL MOTOR. Que dos corridas del MISMO dia produzcan UN solo aviso lo
// decide `notificacion_dedupe_key` (UNIQUE con `NULLS NOT DISTINCT`) mas la guardia de no-leidas,
// y eso se mide contra Postgres en `tests/integration/db/gasto-fijo-cobro-aviso-dedupe.test.ts`.
// Aqui se mide lo que SI es del emisor: que la entidad sea el dia, para que la clave pueda
// distinguir dias distintos.

/** Repositorio doble que registra lo creado, con una dedupe REAL sobre la clave del indice. */
class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  /** Emula `notificacion_dedupe_key`: (evento, entidad_id, destinatario). */
  private readonly claves = new Set<string>();
  /** Claves que su destinatario NO ha leido todavia (la guardia previa de `emitirFilas`). */
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

  async crear(input: CrearNotificacionInput): Promise<boolean> {
    if (input.entidadId !== null) {
      const k = this.clave(input.evento, input.entidadId, input.destinatario);
      // El repositorio REAL absorbe el `P2002` devolviendo `false`; el doble hace lo mismo.
      if (this.claves.has(k)) return false;
      this.claves.add(k);
      this.noLeidas.add(k);
    }
    this.creadas.push(input);
    return true;
  }

  async existeNoLeidaPara(
    evento: NotificacionEvento,
    entidadId: string,
    destinatario: NotificacionDestinatario,
  ): Promise<boolean> {
    return this.noLeidas.has(this.clave(evento, entidadId, destinatario));
  }

  /** Marca TODO como leido: es lo que pasa cuando el maestro abre la campana. */
  marcarTodoLeido(): void {
    this.noLeidas.clear();
  }

  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

/** Repositorio que revienta al crear: modela la base caida en el camino real. */
class RepoQueFalla extends RepoDoble {
  override async crear(): Promise<boolean> {
    throw new Error("base caida");
  }
}

describe("333/R29 — con pendientes, la corrida emite el aviso con el NUMERO", () => {
  it("⭑ una fila `warning` al rol `maestro`, con el dia CR como entidad", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirGastoFijoCobroPendiente(repo, {
      pendientes: 3,
      diaCR: "2026-08-29",
    });

    expect(creadas).toBe(1);
    // LITERAL y completo: la forma de la fila ES el contrato del aviso.
    expect(repo.creadas).toEqual([
      {
        tipo: "warning",
        evento: "gasto_fijo_cobro_pendiente",
        descripcion: "Hay 3 cobros de gasto fijo esperando tu aprobación.",
        anexo: null,
        entidadTipo: "gasto_fijo_cobro_dia",
        entidadId: "2026-08-29", // ⚠️ EL DIA, no el cobro
        destinatario: { tipo: "rol", rol: "maestro" },
      },
    ]);
  });

  it("⭑ va SOLO al maestro: el admin ve la cola pero no puede decidirla, y un recordatorio que no se puede atender es ruido", async () => {
    const repo = new RepoDoble();

    await emitirGastoFijoCobroPendiente(repo, { pendientes: 1, diaCR: "2026-08-29" });

    expect(repo.creadas.map((c) => c.destinatario)).toEqual([{ tipo: "rol", rol: "maestro" }]);
  });

  it("singular y plural: «1 cobro» / «2 cobros»", () => {
    expect(textoCobrosGastoFijoPendientes(1)).toBe(
      "Hay 1 cobro de gasto fijo esperando tu aprobación.",
    );
    expect(textoCobrosGastoFijoPendientes(2)).toBe(
      "Hay 2 cobros de gasto fijo esperando tu aprobación.",
    );
  });
});

describe("333/R30 — dos dias seguidos con el MISMO pendiente producen DOS avisos", () => {
  it("⭑ y sin que nadie haya leido el primero: dias distintos, entidades distintas", async () => {
    // ESTE ES EL CASO QUE JUSTIFICA TODO EL DISEÑO (design §4.2, A3). Con el COBRO como entidad,
    // `notificacion_dedupe_key` admitiria UNA sola fila por (evento, cobro, maestro) para siempre
    // y el aviso del dia 2 no existiria NUNCA — sin error, sin log y sin nada. Y ni siquiera
    // haria falta el indice: la guardia de no-leidas ya se lo saltaria. El doble reproduce las
    // DOS barreras, y el aviso del dia 2 las cruza porque su entidad es otra.
    const repo = new RepoDoble();

    await emitirGastoFijoCobroPendiente(repo, { pendientes: 2, diaCR: "2026-08-29" });
    await emitirGastoFijoCobroPendiente(repo, { pendientes: 2, diaCR: "2026-08-30" });

    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas.map((c) => c.entidadId)).toEqual(["2026-08-29", "2026-08-30"]);
  });

  it("⭑ CONTRAPRUEBA: con la MISMA entidad (dos corridas del mismo dia) sale UN solo aviso", async () => {
    // Sin este caso, el de arriba pasaria aunque la dedupe del doble estuviera rota y estaria
    // midiendo su propio ruido. Es ademas R31 en miniatura; la version que cuenta corre contra
    // Postgres.
    const repo = new RepoDoble();

    await emitirGastoFijoCobroPendiente(repo, { pendientes: 2, diaCR: "2026-08-29" });
    await emitirGastoFijoCobroPendiente(repo, { pendientes: 3, diaCR: "2026-08-29" });

    expect(repo.creadas).toHaveLength(1);
  });

  it("⭑ y tampoco reaparece el mismo dia DESPUES de leerlo: ahi lo mata el indice unico", async () => {
    // Las dos barreras son distintas y hay que ver las dos: la guardia previa (`existeNoLeidaPara`)
    // solo actua mientras el aviso siga sin leer; una vez leido, el que impide el duplicado es
    // `notificacion_dedupe_key`, cuyo `P2002` el repositorio absorbe devolviendo `false`.
    const repo = new RepoDoble();

    await emitirGastoFijoCobroPendiente(repo, { pendientes: 2, diaCR: "2026-08-29" });
    repo.marcarTodoLeido();
    const creadasEnLaSegunda = await emitirGastoFijoCobroPendiente(repo, {
      pendientes: 2,
      diaCR: "2026-08-29",
    });

    expect(creadasEnLaSegunda).toBe(0);
    expect(repo.creadas).toHaveLength(1);
  });
});

describe("333/R32 — el aviso solo existe si hay algo que avisar", () => {
  it("la decision de NO emitir es del servicio: el emisor no se llama con cero", async () => {
    // `GeneracionGastosFijosService` no invoca al notificador cuando el total es 0 (probado en su
    // propia suite). Lo que se fija aqui es que este emisor no tiene ninguna rama que produzca un
    // aviso vacio por su cuenta: cada llamada emite exactamente una fila.
    const repo = new RepoDoble();
    await emitirGastoFijoCobroPendiente(repo, { pendientes: 1, diaCR: "2026-08-29" });
    expect(repo.creadas).toHaveLength(1);
  });
});

describe("333/R33 — un notificador que revienta no tumba la corrida y queda REGISTRADO", () => {
  it("⭑ resuelve sin lanzar, y el fallo se loggea con la operacion y su causa", async () => {
    const logError = vi.fn();

    await expect(
      notificarGastoFijoCobroPendienteCon(new RepoQueFalla(), { logError })({
        pendientes: 2,
        diaCR: "2026-08-29",
      }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1); // NO es un catch vacio
    const registrado = logError.mock.calls[0][0] as Error;
    expect(registrado.message).toContain("gasto_fijo_cobro_pendiente");
    expect((registrado.cause as Error).message).toBe("base caida");
  });

  it("el camino REAL con un repositorio sano si emite: el absorbedor no se traga los avisos buenos", async () => {
    const repo = new RepoDoble();
    await notificarGastoFijoCobroPendienteCon(repo)({ pendientes: 4, diaCR: "2026-08-29" });
    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0].descripcion).toBe(
      "Hay 4 cobros de gasto fijo esperando tu aprobación.",
    );
  });
});

describe("333/R35 — el texto del aviso no lleva monto, ni concepto, ni nombre", () => {
  it("⭑ solo el numero: ni un digito con decimales, ni un simbolo de moneda", () => {
    for (const n of [1, 2, 17, 250]) {
      const texto = textoCobrosGastoFijoPendientes(n);
      expect(texto).toContain(String(n));
      expect(texto).not.toMatch(/[₡$]/); // sin moneda
      expect(texto).not.toMatch(/\d+[.,]\d{2}\b/); // sin importes con centimos
    }
  });

  it("⭑ la fila entera es opaca: el `anexo` va a `null` y no hay ningun otro campo con datos", async () => {
    // El anexo es el hueco por el que se cuela un dato de mas —es donde otros avisos ponen un
    // nombre o una guia—. Aqui va vacio A PROPOSITO: que hay que decidir se lee en /wallet, que es
    // donde vive la autorizacion por rol.
    const repo = new RepoDoble();

    await emitirGastoFijoCobroPendiente(repo, { pendientes: 2, diaCR: "2026-08-29" });

    const fila = repo.creadas[0];
    expect(fila.anexo).toBeNull();
    const serializada = JSON.stringify(fila);
    expect(serializada).not.toMatch(/Alquiler|Electricidad/i); // ningun concepto
    expect(serializada).not.toMatch(/80000|12345\.67/); // ningun monto
  });
});
