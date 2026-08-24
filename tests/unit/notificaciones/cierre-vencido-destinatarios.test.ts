import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import { emitirCierreDiaVencido } from "@/lib/notificaciones/emitir";
import { notificarCierreDiaVencidoCon } from "@/lib/notificaciones/notificadores";

/**
 * FEATURE 271 (T6.4, R38/R39) — **QUIEN RECIBE EL AVISO DEL CIERRE VENCIDO.**
 *
 * QUE FALTABA (review 271, B2). R38 y R39 no son «que exista un texto»: son **quien lo recibe** —
 * *«al mensajero DUEÑO de ese cierre»* (R38) y *«a la BODEGA RESPONSABLE de ese cierre»* (R39)—, y
 * ningun test importaba `emitirCierreDiaVencido`. Cambiar
 * `destinatario: { tipo: "usuario", usuarioId: ctx.mensajeroUsuarioId }` por un rol, o borrar las
 * filas de bodega, pasaba en verde con los 18.109 tests.
 *
 * ⚠️ Y ES LA PRIMERA NOTIFICACION DE CIERRE QUE LLEGA A UN MENSAJERO: hasta esta ficha
 * `emitirCierreDiaPorAprobar` solo emitia a roles de administracion. Si la fila dirigida al usuario
 * se cayera, el aviso seguiria «funcionando» —la bodega lo veria— y el dueño del cierre no se
 * enteraria de su propio bloqueo. Un fallo mudo de manual.
 *
 * POR QUE CON REPOSITORIO DOBLE Y NO CONTRA POSTGRES. Lo que se afirma aqui son las FILAS que el
 * emisor COMPONE —cuantas, de que tipo, con que entidad y para quien—, que es logica pura del
 * emisor. El tramo que si depende del motor —que `{tipo:"usuario"}` aterrice en
 * `destinatario_usuario_id` con el rol en `null`, que el rol acotado guarde su `zona_id`, y que el
 * indice `notificacion_dedupe_key` no colisione entre dos cierres— esta probado contra Postgres
 * REAL para el otro evento de esta ficha, con el MISMO repositorio y el MISMO `emitirFilas`
 * (`tests/integration/db/notificacion-bloqueo-otro-cierre-avisa.test.ts`, 4 filas contadas en la
 * tabla). No se re-mide aqui.
 *
 * NI UN LITERAL DE TEXTO SE COMPARA EN ESTE ARCHIVO: los ocho textos se afirman escritos a mano en
 * `bloqueo-textos.test.ts`. Compararlos contra la funcion que los genera estaria siempre verde.
 */

/** Repositorio doble: registra lo creado, sin dedupe previa (la dedupe tiene su propio caso). */
class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  async crear(input: CrearNotificacionInput): Promise<boolean> {
    this.creadas.push(input);
    return true;
  }
  existeNoLeidaPara = vi.fn().mockResolvedValue(false);
  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

const CIERRE = "c-vencido-1";
const MENSAJERO = "u-mensajero-9";
const ZONA_DESTINO = "z-cartago";
const JORNADA = "2026-08-21";

/** Los CUATRO destinatarios de un `cierre_dia_vencido`: el dueño + maestro + admin + adminSatelite. */
const DESTINATARIOS_ESPERADOS: NotificacionDestinatario[] = [
  { tipo: "usuario", usuarioId: MENSAJERO },
  { tipo: "rol", rol: "maestro" },
  { tipo: "rol", rol: "admin" },
  { tipo: "rol", rol: "adminSatelite", zonaId: ZONA_DESTINO },
];

describe("271/T6.4 · R38/R39 — a quien llega el aviso de «tu cierre del dia vencio»", () => {
  it("R38/R39: CUATRO filas — el mensajero dueño, maestro, admin y el adminSatelite de la zona DESTINO", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirCierreDiaVencido(repo, {
      cierreId: CIERRE,
      zonaId: ZONA_DESTINO,
      mensajeroUsuarioId: MENSAJERO,
      jornadaCR: JORNADA,
    });

    expect(creadas).toBe(4);
    // ⭑ La lista ENTERA y escrita a mano: quitar el mensajero, cambiarlo por un rol, añadir un rol
    // o perder el alcance de zona del satelite deja este caso rojo.
    expect(repo.creadas.map((c) => c.destinatario)).toEqual(DESTINATARIOS_ESPERADOS);
  });

  it("R38: la fila del MENSAJERO es la unica dirigida a un usuario, es `alert` y su entidad es EL CIERRE", async () => {
    const repo = new RepoDoble();

    await emitirCierreDiaVencido(repo, {
      cierreId: CIERRE,
      zonaId: ZONA_DESTINO,
      mensajeroUsuarioId: MENSAJERO,
      jornadaCR: JORNADA,
    });

    const aUsuarios = repo.creadas.filter((c) => c.destinatario.tipo === "usuario");
    expect(aUsuarios).toHaveLength(1);
    expect(aUsuarios[0].destinatario).toEqual({ tipo: "usuario", usuarioId: MENSAJERO });
    // `alert` y no `warning`: al dueño le toca ACTUAR (re-enviarlo), a la bodega solo enterarse.
    expect(aUsuarios[0].tipo).toBe("alert");
    // La entidad es el CIERRE y no el mensajero: dos cierres distintos son dos hechos distintos, y
    // es lo que impide que la dedupe convierta el segundo aviso en un silencio estructural (R44).
    expect(aUsuarios[0].entidadTipo).toBe("cierre_dia");
    expect(aUsuarios[0].entidadId).toBe(CIERRE);
    // R45: sin anexo — ni nombre, ni guia, ni monto.
    expect(aUsuarios[0].anexo).toBeNull();
  });

  it("R39: las TRES filas de la bodega son `warning`, con la misma entidad y sin anexo", async () => {
    const repo = new RepoDoble();

    await emitirCierreDiaVencido(repo, {
      cierreId: CIERRE,
      zonaId: ZONA_DESTINO,
      mensajeroUsuarioId: MENSAJERO,
      jornadaCR: JORNADA,
    });

    const aRoles = repo.creadas.filter((c) => c.destinatario.tipo === "rol");
    expect(aRoles).toHaveLength(3);
    expect(aRoles.map((c) => c.tipo)).toEqual(["warning", "warning", "warning"]);
    expect(aRoles.map((c) => c.entidadId)).toEqual([CIERRE, CIERRE, CIERRE]);
    expect(aRoles.map((c) => c.anexo)).toEqual([null, null, null]);
    // Todas bajo el MISMO evento: es lo que la campana usa para agrupar y deduplicar.
    expect(repo.creadas.map((c) => c.evento)).toEqual([
      "cierre_dia_vencido",
      "cierre_dia_vencido",
      "cierre_dia_vencido",
      "cierre_dia_vencido",
    ]);
  });

  it("R39: sin zona destino NO se inventa un `adminSatelite` — quedan TRES filas y el mensajero sigue avisado", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirCierreDiaVencido(repo, {
      cierreId: CIERRE,
      zonaId: null,
      mensajeroUsuarioId: MENSAJERO,
      jornadaCR: JORNADA,
    });

    expect(creadas).toBe(3);
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "usuario", usuarioId: MENSAJERO },
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
    ]);
  });

  it("R44: la dedupe se pregunta por (evento, EL CIERRE, destinatario) y la fila que ya existe no se repite", async () => {
    const repo = new RepoDoble();
    // Solo el mensajero tiene una sin leer: las tres de bodega deben salir igual.
    repo.existeNoLeidaPara = vi
      .fn()
      .mockImplementation(async (_evento, _entidadId, destinatario: NotificacionDestinatario) =>
        destinatario.tipo === "usuario",
      );

    const creadas = await emitirCierreDiaVencido(repo, {
      cierreId: CIERRE,
      zonaId: ZONA_DESTINO,
      mensajeroUsuarioId: MENSAJERO,
      jornadaCR: JORNADA,
    });

    expect(creadas).toBe(3);
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
      { tipo: "rol", rol: "adminSatelite", zonaId: ZONA_DESTINO },
    ]);
    // La guardia se consulta con el CIERRE como entidad, una vez por destinatario.
    expect(repo.existeNoLeidaPara).toHaveBeenCalledTimes(4);
    for (const [evento, entidadId] of repo.existeNoLeidaPara.mock.calls) {
      expect(evento).toBe("cierre_dia_vencido");
      expect(entidadId).toBe(CIERRE);
    }
  });

  it("R38/R39/R47: el camino REAL (`notificarCierreDiaVencidoCon`) emite las cuatro filas contra el repositorio inyectado", async () => {
    // La MISMA funcion que el binding de produccion (`notificarCierreDiaVencidoReal`), solo que con
    // el repositorio inyectado. Sus tres hermanos de la 146 tienen su caso aqui desde el primer dia.
    const repo = new RepoDoble();

    await notificarCierreDiaVencidoCon(repo)({
      cierreId: CIERRE,
      zonaId: ZONA_DESTINO,
      mensajeroUsuarioId: MENSAJERO,
      jornadaCR: JORNADA,
    });

    expect(repo.creadas.map((c) => c.destinatario)).toEqual(DESTINATARIOS_ESPERADOS);
  });
});
