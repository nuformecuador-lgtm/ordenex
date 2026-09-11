import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import {
  emitirMensajeroBloqueado,
  type MensajeroBloqueadoContexto,
} from "@/lib/notificaciones/emitir";
import { bloqueoDe } from "@/tests/fixtures/bloqueo-cierre";

/**
 * FICHA 412 (T4.4, R18/R19) — **EL AVISO DE BLOQUEO NO CAMBIA PARA LA BODEGA, Y AQUÍ SE MIDE.**
 *
 * Esta ficha le añade a `MensajeroBloqueadoContexto` un campo OBLIGATORIO —`destinatarios`— y en
 * la rama del RECHAZO pasa `"solo_bodega"`, para que el mensajero reciba UN solo aviso por ese
 * hecho: el de la 412, que es el único de los dos que dice QUÉ PASÓ (R17).
 *
 * Lo que este archivo existe para impedir es el daño colateral: que al quitar la fila del
 * mensajero se le cambie algo a la bodega. R18 dice «sin cambiarle el texto, la entidad ni su
 * deduplicación», y R19 dice que el OTRO productor —la solicitud de cierre— no cambia nada.
 *
 * ⚠️ EL RIESGO DE R17 ES **CERO MEDIDO**, y queda escrito para que nadie lo lea dentro de seis
 * meses como «un cambio que se coló»: producción tenía **0 cierres `rechazado` en toda su
 * historia** el 2026-09-11 (78 `aprobado`, 5 `solicitado`, desde el arranque comercial del
 * 2026-08-27), así que la fila de `mensajero_bloqueado_por_cierres` dirigida al mensajero por un
 * rechazo NO SE HA EMITIDO JAMÁS. No hay nadie a quien se le retire un aviso que recibía.
 *
 * ⚠️ LOS TEXTOS NO SE AFIRMAN AQUÍ contra la función que los compone: los literales completos
 * viven escritos a mano en `tests/unit/notificaciones/bloqueo-textos.test.ts`. Aquí se cuentan
 * FILAS, DESTINATARIOS y ENTIDADES, que es lo que decide `emitirMensajeroBloqueado`.
 */

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
      if (this.claves.has(k)) return null;
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

const CIERRE = "c-bloqueante";
const MENSAJERO = "men-1";
const ZONA = "z-cartago";

function ctx(
  destinatarios: MensajeroBloqueadoContexto["destinatarios"],
  overrides: Partial<MensajeroBloqueadoContexto> = {},
): MensajeroBloqueadoContexto {
  return {
    cierreId: CIERRE,
    zonaId: ZONA,
    mensajeroUsuarioId: MENSAJERO,
    bloqueo: bloqueoDe({ n: 1, v: 1, jornadaCR: "2026-08-21", cierreId: CIERRE }),
    destinatarios,
    ...overrides,
  };
}

/** Las filas que van a un ROL, con su rol y su zona. */
const aRoles = (repo: RepoDoble) =>
  repo.creadas
    .filter((f) => f.destinatario.tipo === "rol")
    .map((f) => (f.destinatario.tipo === "rol" ? f.destinatario : null));

const aUsuarios = (repo: RepoDoble) => repo.creadas.filter((f) => f.destinatario.tipo === "usuario");

describe("412/R18 — con `solo_bodega` salen las TRES de administración y NINGUNA de usuario", () => {
  it("⭑ maestro, admin y el `adminSatelite` de la zona destino — y nadie más", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirMensajeroBloqueado(repo, ctx("solo_bodega"));

    expect(creadas).toBe(3);
    expect(aRoles(repo)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
      { tipo: "rol", rol: "adminSatelite", zonaId: ZONA },
    ]);
  });

  it("⭑ NINGUNA fila dirigida a un usuario: ésa es toda la diferencia (R17)", async () => {
    const repo = new RepoDoble();

    await emitirMensajeroBloqueado(repo, ctx("solo_bodega"));

    expect(aUsuarios(repo)).toEqual([]);
  });

  it("⭑ el TEXTO y la ENTIDAD de las tres son los de hoy, sin tocar una coma (R18)", async () => {
    const repo = new RepoDoble();

    await emitirMensajeroBloqueado(repo, ctx("solo_bodega"));

    for (const fila of repo.creadas) {
      expect(fila.tipo).toBe("warning");
      expect(fila.evento).toBe("mensajero_bloqueado_por_cierres");
      // Literal ESCRITO A MANO, no comparado contra `textoMensajeroBloqueadoBodega`.
      expect(fila.descripcion).toBe(
        "Un mensajero quedó bloqueado por acumular cierres sin aprobar. Aprueba el más antiguo, el del 21 de agosto, para que pueda volver a trabajar.",
      );
      // La entidad de ESTE aviso sigue siendo EL CIERRE, no el rechazo: no se toca (R18).
      expect(fila.entidadTipo).toBe("cierre_dia");
      expect(fila.entidadId).toBe(CIERRE);
      expect(fila.anexo).toBeNull();
    }
  });

  it("sin zona destino no se inventa la cuarta fila: salen DOS, y las dos son centrales", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirMensajeroBloqueado(repo, ctx("solo_bodega", { zonaId: null }));

    expect(creadas).toBe(2);
    expect(aRoles(repo)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
    ]);
  });

  it("la deduplicación de la bodega tampoco cambia: repetir la emisión no crea nada", async () => {
    const repo = new RepoDoble();

    await emitirMensajeroBloqueado(repo, ctx("solo_bodega"));
    const repetida = await emitirMensajeroBloqueado(repo, ctx("solo_bodega"));

    expect(repetida).toBe(0);
    expect(repo.creadas).toHaveLength(3);
  });
});

describe("412/R19 — con `mensajero_y_bodega` NO cambia NADA de lo que hacía hasta hoy", () => {
  it("⭑ salen CUATRO filas: la del mensajero (`alert`) más las tres de bodega (`warning`)", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirMensajeroBloqueado(repo, ctx("mensajero_y_bodega"));

    expect(creadas).toBe(4);
    expect(aUsuarios(repo)).toHaveLength(1);
    expect(aRoles(repo)).toHaveLength(3);
  });

  it("⭑ la del mensajero es `alert`, cuelga del CIERRE y lleva el texto de la 271, a mano", async () => {
    const repo = new RepoDoble();

    await emitirMensajeroBloqueado(repo, ctx("mensajero_y_bodega"));

    const fila = aUsuarios(repo)[0];
    expect(fila.tipo).toBe("alert");
    expect(fila.destinatario).toEqual({ tipo: "usuario", usuarioId: MENSAJERO });
    expect(fila.entidadTipo).toBe("cierre_dia");
    expect(fila.entidadId).toBe(CIERRE);
    // Literal de la 271 escrito a mano: `N=1, V=1` con llamado a la acción («conCta: true»).
    expect(fila.descripcion).toBe(
      "Tienes un cierre sin enviar a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Ve a «Cierre del día» para enviarlo a aprobación.",
    );
  });

  it("⭑ y la ÚNICA diferencia entre los dos modos es esa fila: las de bodega son idénticas", async () => {
    // Control cruzado. Si al implementar `solo_bodega` alguien hubiera tocado el `map` de bodega
    // —el orden, el texto, la entidad o el tipo—, esto se pone rojo aunque los conteos cuadren.
    const conMensajero = new RepoDoble();
    const soloBodega = new RepoDoble();

    await emitirMensajeroBloqueado(conMensajero, ctx("mensajero_y_bodega"));
    await emitirMensajeroBloqueado(soloBodega, ctx("solo_bodega"));

    expect(conMensajero.creadas.filter((f) => f.destinatario.tipo === "rol")).toEqual(
      soloBodega.creadas,
    );
  });
});
