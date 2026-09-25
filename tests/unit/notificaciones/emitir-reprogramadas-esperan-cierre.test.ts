import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import {
  TEXTO_REPROGRAMADAS_ESPERAN_CIERRE,
  emitirReprogramadasEsperanCierre,
} from "@/lib/notificaciones/emitir";
import {
  notificadorNoOp,
  notificarReprogramadasEsperanCierreCon,
} from "@/lib/notificaciones/notificadores";

// FICHA 462 (T2.5, R9/R13/R17/R52) — EL EMISOR DEL AVISO «REPROGRAMADAS DE HOY QUE ESPERAN LA
// APROBACION DE SU CIERRE».
//
// Lo que se prueba aqui es la FORMA de las filas: cuantas, a quien, con que entidad, con que tipo y
// con que texto. La dedupe contra Postgres vive en
// `tests/integration/db/462/aviso-reprogramadas-dedupe.test.ts`; la decision de push en
// `push-elegibles.test.ts`; el cableado en `notificacion-notificadores-reales.test.ts`.
//
// ⚠️ LOS TEXTOS SE AFIRMAN CON LITERALES ESCRITOS A MANO, nunca comparados con la constante que los
// define: comparar una asercion contra su propia fuente esta SIEMPRE VERDE (memoria del repo).

const ZONA_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ZONA_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const DIA = "2026-09-25";

/** Repositorio doble: registra lo creado y modela el indice unico de la base. */
class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  private vistas = new Set<string>();

  async crear(input: CrearNotificacionInput): Promise<string | null> {
    const quien =
      input.destinatario.tipo === "usuario" ? input.destinatario.usuarioId : input.destinatario.rol;
    const clave = `${input.evento}|${input.entidadId}|${quien}`;
    if (this.vistas.has(clave)) return null; // la base ABSORBE el P2002 devolviendo `null`
    this.vistas.add(clave);
    this.creadas.push(input);
    return `n-${this.creadas.length}`;
  }
  existeNoLeidaPara = vi.fn().mockResolvedValue(false);
  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

describe("462/R9 — UNA fila por rol destinatario del ambito, jamas una por orden ni por cierre", () => {
  it("⭑ ambito CENTRAL: DOS filas, `maestro` y `admin`, SIN alcance de zona", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA });

    expect(creadas).toBe(2);
    expect(repo.creadas.map((f) => f.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
    ]);
    for (const fila of repo.creadas) {
      expect(fila.evento).toBe("reprogramadas_esperan_cierre");
      expect(fila.tipo).toBe("warning"); // cola de trabajo atascada, no servicio caido
      expect(fila.entidadTipo).toBe("reprogramadas_esperan_cierre_dia");
      expect(fila.anexo).toBeNull();
    }
  });

  it("⭑ ambito ZONA: UNA fila al `adminSatelite` ACOTADA a esa zona", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirReprogramadasEsperanCierre(repo, {
      ambito: { tipo: "zona", zonaId: ZONA_A },
      diaCR: DIA,
    });

    expect(creadas).toBe(1);
    expect(repo.creadas[0].destinatario).toEqual({ tipo: "rol", rol: "adminSatelite", zonaId: ZONA_A });
  });
});

describe("462/R11/R12 — la ENTIDAD es `${ambito}:${diaCR}`, con el literal `central`", () => {
  it("central -> `central:<dia>`; zona -> `<zonaId>:<dia>` (literales a mano)", async () => {
    const repo = new RepoDoble();

    await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA });
    await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "zona", zonaId: ZONA_A }, diaCR: DIA });

    expect(repo.creadas.map((f) => f.entidadId)).toEqual([
      "central:2026-09-25",
      "central:2026-09-25",
      `${ZONA_A}:2026-09-25`,
    ]);
    // Y NO es el literal de la 409: maestro y admin cuentan el ambito CENTRAL, no el total.
    for (const f of repo.creadas) expect(f.entidadId).not.toMatch(/^global:/);
  });

  it("⭑ mutacion 7: dos zonas el mismo dia son DOS entidades distintas — sin el ambito dentro, la segunda quedaria muda", async () => {
    const repo = new RepoDoble();

    const a = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "zona", zonaId: ZONA_A }, diaCR: DIA });
    const b = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "zona", zonaId: ZONA_B }, diaCR: DIA });

    expect(a).toBe(1);
    expect(b).toBe(1); // con `entidadId = diaCR` a secas, esto seria 0: misma clave (evento, dia, adminSatelite, NULL)
    expect(new Set(repo.creadas.map((f) => f.entidadId)).size).toBe(2);
  });

  it("la misma corrida repetida el mismo dia no crea una segunda fila; otro dia si", async () => {
    const repo = new RepoDoble();

    await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA });
    const repetida = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA });
    const otroDia = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: "2026-09-26" });

    expect(repetida).toBe(0);
    expect(otroDia).toBe(2);
    expect(repo.creadas).toHaveLength(4);
  });

  it("la guardia previa de dedupe (`existeNoLeidaPara`) se consulta por fila y, si ya hay una no leida, no crea", async () => {
    const repo = new RepoDoble();
    repo.existeNoLeidaPara.mockResolvedValue(true);

    const creadas = await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA });

    expect(creadas).toBe(0);
    expect(repo.creadas).toEqual([]);
    expect(repo.existeNoLeidaPara).toHaveBeenCalledTimes(2);
  });
});

describe("462/R17/R52 — el texto persistido es llano, sin numero y sin PII", () => {
  it("⭑ el detalle, letra por letra (literal a mano)", async () => {
    const repo = new RepoDoble();

    await emitirReprogramadasEsperanCierre(repo, { ambito: { tipo: "central" }, diaCR: DIA });

    // FASE 3 (2026-09-25, decision del leader): del PAQUETE en masculino; sin el plural femenino
    // retirado «reprogramadas» (455 §0.3). Literal a mano.
    expect(repo.creadas[0].descripcion).toBe(
      "No se pueden asignar hasta que se apruebe el cierre del mensajero que los visitó. " +
        "Revisa los cierres marcados «Retiene paquetes reprogramados para hoy» y apruébalos antes de asignar.",
    );
  });

  it("sin digitos, sin uuid, sin guia, sin nombres, sin estado del cierre", () => {
    const texto = TEXTO_REPROGRAMADAS_ESPERAN_CIERRE;
    expect(texto).not.toMatch(/\d/);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(texto).not.toMatch(/gu[ií]a|remisi[oó]n|tel[eé]fono|direcci[oó]n|₡|monto/i);
    // El estado del cierre cambia durante el dia (rechazado -> solicitado): un texto persistido
    // que lo nombrara mentiria (requirements, decision 6).
    expect(texto).not.toMatch(/solicitado|vencido|rechazado/i);
    // Nombra la MARCA que la persona vera en `/cierres-admin`, para que sepa que buscar.
    expect(texto).toContain("«Retiene paquetes reprogramados para hoy»");
    // 455 §0.3: el plural femenino del estado retirado no vuelve como texto visible.
    expect(texto).not.toMatch(/reprogramadas/i);
  });
});

describe("462/R18 — el notificador `Con` es best-effort: absorbe y REGISTRA el fallo", () => {
  it("un repositorio que revienta no tumba al llamador, y el error queda registrado con su operacion", async () => {
    const repoRoto: INotificacionRepository = {
      ...new RepoDoble(),
      crear: vi.fn(async () => {
        throw new Error("conexion perdida");
      }),
      existeNoLeidaPara: vi.fn().mockResolvedValue(false),
    } as unknown as INotificacionRepository;
    const logger = { logError: vi.fn() };

    await expect(
      notificarReprogramadasEsperanCierreCon(repoRoto, logger)({ ambito: { tipo: "central" }, diaCR: DIA }),
    ).resolves.toBeUndefined();

    expect(logger.logError).toHaveBeenCalledTimes(1);
    const registrado = logger.logError.mock.calls[0][0] as Error;
    expect(registrado.message).toContain("reprogramadas_esperan_cierre");
  });

  it("con un repositorio sano emite las filas del ambito", async () => {
    const repo = new RepoDoble();
    await notificarReprogramadasEsperanCierreCon(repo)({ ambito: { tipo: "zona", zonaId: ZONA_B }, diaCR: DIA });
    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0].destinatario).toEqual({ tipo: "rol", rol: "adminSatelite", zonaId: ZONA_B });
  });

  it("el no-op compartido acepta este contexto y no hace nada (es el default de los services)", async () => {
    await expect(notificadorNoOp({ ambito: { tipo: "central" }, diaCR: DIA })).resolves.toBeUndefined();
  });
});
