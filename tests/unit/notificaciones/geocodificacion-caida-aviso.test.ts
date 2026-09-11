import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import {
  emitirGeocodificacionCaida,
  textoGeocodificacionCaida,
} from "@/lib/notificaciones/emitir";

// FICHA 401 (T8) — EL AVISO: «el servicio de mapas está rechazando nuestras peticiones», contra un
// repositorio doble. Cubre R7 (dos filas, una por rol, mismo texto), R9 (la entidad es la jornada
// CR, que es lo que permite deduplicar dentro del día), R10 (dos jornadas ⇒ dos avisos por rol),
// R26 (sin PII ni secretos) y R27 (lenguaje llano, sin siglas ni jerga).
//
// ⚠️ LA MITAD DE R9 VIVE EN EL MOTOR. Que dos emisiones del mismo día CR dejen DOS filas en total
// —y no cuatro— lo decide `notificacion_dedupe_key` (UNIQUE con `NULLS NOT DISTINCT`, y con
// `destinatario_rol` DENTRO de la clave) más la guardia de no-leídas de `emitirFilas`. Eso se mide
// contra Postgres en `tests/integration/db/notificacion-evento-geocodificacion-caida-migration.test.ts`.
// Aquí se mide lo que SÍ es del emisor.

/** Repositorio doble que registra lo creado, con una dedupe REAL sobre la clave del índice. */
class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  /** Emula `notificacion_dedupe_key`: (evento, entidad_id, destinatario). */
  private readonly claves = new Set<string>();
  /** Claves que su destinatario NO ha leído todavía (la guardia previa de `emitirFilas`). */
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

  // FICHA 410 (design 6.1): `crear` devuelve el ID de la fila creada y `null` cuando la dedupe
  // la absorbio. `null` significa EXACTAMENTE lo que significaba `false`.
  async crear(input: CrearNotificacionInput): Promise<string | null> {
    if (input.entidadId !== null) {
      const k = this.clave(input.evento, input.entidadId, input.destinatario);
      if (this.claves.has(k)) return null; // el repositorio REAL absorbe el P2002 igual
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

  /** Marca como leída SOLO la del rol dado: es lo que pasa cuando uno de los dos abre la campana. */
  marcarLeidaDelRol(evento: NotificacionEvento, entidadId: string, rol: string): void {
    this.noLeidas.delete(this.clave(evento, entidadId, { tipo: "rol", rol: rol as never }));
  }

  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

/** El texto completo, ESCRITO A MANO. Es el contrato de R26/R27, no una copia de la función. */
const TEXTO_PLURAL =
  "El servicio de mapas está rechazando nuestras peticiones por un problema de configuración de la cuenta. 3 direcciones quedaron sin ubicar. Revisa la credencial y la facturación de la cuenta del proveedor de mapas.";
const TEXTO_SINGULAR =
  "El servicio de mapas está rechazando nuestras peticiones por un problema de configuración de la cuenta. 1 dirección quedó sin ubicar. Revisa la credencial y la facturación de la cuenta del proveedor de mapas.";

describe("401/R7 — una emisión crea EXACTAMENTE dos filas, una por rol, con el mismo texto", () => {
  it("⭑ la forma completa de las dos filas ES el contrato del aviso", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirGeocodificacionCaida(repo, { afectados: 3, diaCR: "2026-09-08" });

    expect(creadas).toBe(2);
    expect(repo.creadas).toEqual([
      {
        tipo: "alert",
        evento: "geocodificacion_caida",
        descripcion: TEXTO_PLURAL,
        anexo: null,
        entidadTipo: "geocodificacion_caida_dia",
        entidadId: "2026-09-08", // ⚠️ LA JORNADA, no el job ni la orden
        destinatario: { tipo: "rol", rol: "maestro" },
      },
      {
        tipo: "alert",
        evento: "geocodificacion_caida",
        descripcion: TEXTO_PLURAL,
        anexo: null,
        entidadTipo: "geocodificacion_caida_dia",
        entidadId: "2026-09-08",
        destinatario: { tipo: "rol", rol: "admin" },
      },
    ]);
  });

  it("⭑ los destinatarios son `maestro` y `admin`, AFIRMADOS A MANO", async () => {
    // Escrito literal a propósito, NUNCA derivado de `ROLES_ADMINISTRACION`: si se comparase
    // contra su propia fuente, quitar un rol de la constante dejaría este test en verde y la
    // mitad de los avisos se perdería en silencio. Es el fallo mudo que design §9 nombra: la fila
    // del `admin` se pierde y nadie lo nota porque el `maestro` sí la ve.
    const repo = new RepoDoble();
    await emitirGeocodificacionCaida(repo, { afectados: 9, diaCR: "2026-09-08" });

    const roles = repo.creadas.map((c) =>
      c.destinatario.tipo === "rol" ? c.destinatario.rol : `usuario:${c.destinatario.usuarioId}`,
    );
    expect(roles).toEqual(["maestro", "admin"]);
  });

  it("⭑ ninguna de las dos se acota por tienda ni por zona: el corte es de TODA la operación", async () => {
    const repo = new RepoDoble();
    await emitirGeocodificacionCaida(repo, { afectados: 4, diaCR: "2026-09-08" });

    for (const fila of repo.creadas) {
      expect(fila.destinatario).toEqual(
        expect.objectContaining({ tipo: "rol" }),
      );
      expect(fila.destinatario).not.toHaveProperty("tiendaId");
      expect(fila.destinatario).not.toHaveProperty("zonaId");
    }
  });

  it("`alert` y no `warning`: no es una cola de trabajo, es un servicio caído", async () => {
    const repo = new RepoDoble();
    await emitirGeocodificacionCaida(repo, { afectados: 3, diaCR: "2026-09-08" });
    expect(repo.creadas.map((c) => c.tipo)).toEqual(["alert", "alert"]);
  });
});

describe("401/R9-R10 — la entidad es la JORNADA CR, y de ahí salen las dos propiedades", () => {
  it("⭑ R9: dos emisiones el MISMO día dejan DOS filas en total, no cuatro", async () => {
    const repo = new RepoDoble();

    const primera = await emitirGeocodificacionCaida(repo, { afectados: 3, diaCR: "2026-09-08" });
    const segunda = await emitirGeocodificacionCaida(repo, { afectados: 7, diaCR: "2026-09-08" });

    expect(primera).toBe(2);
    expect(segunda).toBe(0);
    expect(repo.creadas).toHaveLength(2);
  });

  it("⭑ R9: que el `maestro` LEA la suya no suprime la del `admin` ni crea una nueva", async () => {
    // Las dos barreras son distintas: la guardia previa sólo actúa mientras el aviso siga sin
    // leer; una vez leído, quien impide el duplicado es el índice único, cuyo `P2002` el
    // repositorio absorbe. Y `destinatario_rol` está DENTRO de la clave, así que los dos
    // destinatarios se deduplican de forma INDEPENDIENTE.
    const repo = new RepoDoble();
    await emitirGeocodificacionCaida(repo, { afectados: 3, diaCR: "2026-09-08" });
    repo.marcarLeidaDelRol("geocodificacion_caida", "2026-09-08", "maestro");

    const segunda = await emitirGeocodificacionCaida(repo, { afectados: 3, diaCR: "2026-09-08" });

    expect(segunda).toBe(0);
    expect(repo.creadas).toHaveLength(2);
  });

  it("⭑ R10: dos jornadas distintas dejan CUATRO filas, dos por jornada", async () => {
    // ESTE ES EL CASO QUE LA ELECCIÓN DE ENTIDAD EXISTE PARA SALVAR: con una entidad que no
    // cambiara entre jornadas, el aviso del 9-sep no habría salido NUNCA, en silencio.
    const repo = new RepoDoble();

    await emitirGeocodificacionCaida(repo, { afectados: 25, diaCR: "2026-09-08" });
    await emitirGeocodificacionCaida(repo, { afectados: 23, diaCR: "2026-09-09" });

    expect(repo.creadas).toHaveLength(4);
    expect(repo.creadas.map((c) => c.entidadId)).toEqual([
      "2026-09-08",
      "2026-09-08",
      "2026-09-09",
      "2026-09-09",
    ]);
  });

  it("el techo del aviso es `roles × jornadas`, jamás el número de evaluaciones", async () => {
    // El drenador corre CADA MINUTO. Sin esta propiedad, el corte medido de 19 h habría dejado
    // ~2.280 filas. Se simulan 200 evaluaciones de la misma jornada: siguen siendo dos.
    const repo = new RepoDoble();
    for (let i = 0; i < 200; i++) {
      await emitirGeocodificacionCaida(repo, { afectados: 3 + i, diaCR: "2026-09-08" });
    }
    expect(repo.creadas).toHaveLength(2);
  });
});

describe("401/R27 — lenguaje llano: ni siglas, ni jerga interna, ni el nombre del proveedor", () => {
  it("⭑ el literal COMPLETO, singular y plural, afirmado a mano", () => {
    // Nunca comparado contra la función que lo genera: eso estaría verde para siempre (memoria
    // del repo «aserción contra su propia fuente»).
    expect(textoGeocodificacionCaida(1)).toBe(TEXTO_SINGULAR);
    expect(textoGeocodificacionCaida(3)).toBe(TEXTO_PLURAL);
  });

  it("⭑ ni «geocodifica», ni «config_invalida», ni «REQUEST_DENIED», ni «API» (case-insensitive)", () => {
    for (const n of [1, 2, 25, 269]) {
      const texto = textoGeocodificacionCaida(n);
      for (const prohibida of ["geocodifica", "config_invalida", "request_denied", "api"]) {
        expect(texto.toLowerCase()).not.toContain(prohibida);
      }
    }
  });

  it("⭑ dice que la causa es NUESTRA configuración, no la dirección de ninguna orden", () => {
    // Es la mitad del valor del aviso: el 2026-09-09 se mandó al operador a corregir seis
    // direcciones que estaban perfectamente bien.
    const texto = textoGeocodificacionCaida(6).toLowerCase();
    expect(texto).toContain("configuración de la cuenta");
    expect(texto).toContain("revisa la credencial y la facturación");
    expect(texto).not.toContain("dirección incorrecta");
    expect(texto).not.toContain("dirección no encontrada");
  });

  it("singular y plural de verdad: «1 dirección quedó» / «2 direcciones quedaron»", () => {
    expect(textoGeocodificacionCaida(1)).toContain("1 dirección quedó sin ubicar");
    expect(textoGeocodificacionCaida(2)).toContain("2 direcciones quedaron sin ubicar");
  });
});

describe("401/R26 — sin datos personales y sin secretos", () => {
  it("⭑ el texto no lleva dirección, ni id de orden, ni guía, ni remisión, ni correo", () => {
    const texto = textoGeocodificacionCaida(3);
    for (const dato of [
      "Av. Central 100",
      "orden-1",
      "8f3c2a1e-0000-4444-8888-abcdefabcdef",
      "REM-1",
      "@",
      "clave-de-prueba",
      "AIzaSy",
      "maps.googleapis.com",
    ]) {
      expect(texto).not.toContain(dato);
    }
  });

  it("⭑ lo único numérico del texto es la CIFRA AGREGADA de direcciones", () => {
    // Un identificador se cuela en forma de dígitos. Aquí el único número admisible es `n`.
    const texto = textoGeocodificacionCaida(25);
    expect(texto.match(/\d+/g)).toEqual(["25"]);
  });

  it("⭑ la fila entera es opaca: `anexo` a null y ningún otro campo con datos", async () => {
    // El anexo es el hueco por el que se cuela un dato de más —es donde otros avisos ponen un
    // nombre o una guía—. Aquí va vacío A PROPÓSITO.
    const repo = new RepoDoble();
    await emitirGeocodificacionCaida(repo, { afectados: 3, diaCR: "2026-09-08" });

    for (const fila of repo.creadas) {
      expect(fila.anexo).toBeNull();
      const serializada = JSON.stringify(fila);
      expect(serializada).not.toMatch(/@/);
      expect(serializada).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i); // ningún uuid
    }
  });
});
