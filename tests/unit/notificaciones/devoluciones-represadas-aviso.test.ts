import { describe, it, expect } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import { emitirDevolucionesRepresadas } from "@/lib/notificaciones/emitir";

// FICHA 409 (T3.2) — EL AVISO «N ordenes esperan volver a su tienda», contra un repositorio doble.
// Cubre R47 (una fila por rol destinatario del ambito), R48 (la zona lleva SU ambito), R49 (la
// administracion central cubre el total), R50 (el texto dice los dias) y R54 (sin PII).
//
// ⚠️ EL DOBLE REPRODUCE LA CLAVE REAL DEL INDICE, QUE **NO** INCLUYE LA ZONA: `columnasDestinatario`
// deja `zona_id` FUERA de `notificacion_dedupe_key`. Por eso, si el `entidadId` no llevara el
// ambito, DOS zonas del mismo dia colisionarian y la segunda quedaria muda — y este archivo se
// pondria rojo, no solo el de integracion.

class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  private readonly claves = new Set<string>();
  private readonly noLeidas = new Set<string>();

  /** EXACTAMENTE `notificacion_dedupe_key`: el ALCANCE (zona) no entra. */
  private clave(
    evento: NotificacionEvento,
    entidadId: string,
    destinatario: NotificacionDestinatario,
  ): string {
    const quien =
      destinatario.tipo === "rol" ? `rol:${destinatario.rol}` : `usuario:${destinatario.usuarioId}`;
    return `${evento}|${entidadId}|${quien}`;
  }

  async crear(input: CrearNotificacionInput): Promise<boolean> {
    if (input.entidadId !== null) {
      const k = this.clave(input.evento, input.entidadId, input.destinatario);
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

  async listarParaUsuario() {
    return [];
  }
  async verificarVisible() {
    return "visible" as const;
  }
  async marcarTodasLeidas() {
    return 0;
  }
  async descartar() {}
}

const ZONA_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ZONA_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const DIA = "2026-09-11";

describe("R47/R49 — el ambito GLOBAL produce DOS filas, una por rol de administracion", () => {
  it("maestro y admin, con el mismo texto y la entidad `global:<dia>`", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirDevolucionesRepresadas(repo, {
      ambito: { tipo: "global" },
      diasMasAntigua: 8,
      diaCR: DIA,
    });

    expect(creadas).toBe(2);
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
    ]);
    expect(repo.creadas.every((c) => c.entidadId === `global:${DIA}`)).toBe(true);
    expect(repo.creadas.every((c) => c.tipo === "warning")).toBe(true);
    expect(repo.creadas.every((c) => c.entidadTipo === "devoluciones_represadas_dia")).toBe(true);
    expect(repo.creadas.every((c) => c.anexo === null)).toBe(true);
  });
});

describe("R48 — el ambito ZONA produce UNA fila, para su adminSatelite y acotada a esa zona", () => {
  it("el destinatario lleva la zona y la entidad es `<zonaId>:<dia>`", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirDevolucionesRepresadas(repo, {
      ambito: { tipo: "zona", zonaId: ZONA_A },
      diasMasAntigua: 4,
      diaCR: DIA,
    });

    expect(creadas).toBe(1);
    expect(repo.creadas[0].destinatario).toEqual({
      tipo: "rol",
      rol: "adminSatelite",
      zonaId: ZONA_A,
    });
    expect(repo.creadas[0].entidadId).toBe(`${ZONA_A}:${DIA}`);
  });

  it("DOS zonas el MISMO dia dan DOS filas — sin el ambito dentro se pisarian", async () => {
    // ⚠️ ESTA ES LA MUTACION OBLIGATORIA DEL DESIGN, medida con la clave REAL del indice: como
    // `zona_id` NO entra en `notificacion_dedupe_key`, con `entidadId = diaCR` a secas las dos
    // zonas compartirian clave ('devoluciones_represadas', '<dia>', 'adminSatelite', NULL) y la
    // segunda quedaria MUDA: sin error, sin log y sin nada.
    const repo = new RepoDoble();

    await emitirDevolucionesRepresadas(repo, {
      ambito: { tipo: "zona", zonaId: ZONA_A },
      diasMasAntigua: 4,
      diaCR: DIA,
    });
    await emitirDevolucionesRepresadas(repo, {
      ambito: { tipo: "zona", zonaId: ZONA_B },
      diasMasAntigua: 6,
      diaCR: DIA,
    });

    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas.map((c) => c.entidadId)).toEqual([
      `${ZONA_A}:${DIA}`,
      `${ZONA_B}:${DIA}`,
    ]);
  });

  it("el ambito global y el de una zona NUNCA colisionan entre si", async () => {
    const repo = new RepoDoble();

    await emitirDevolucionesRepresadas(repo, {
      ambito: { tipo: "global" },
      diasMasAntigua: 8,
      diaCR: DIA,
    });
    await emitirDevolucionesRepresadas(repo, {
      ambito: { tipo: "zona", zonaId: ZONA_A },
      diasMasAntigua: 4,
      diaCR: DIA,
    });

    expect(repo.creadas).toHaveLength(3); // maestro + admin + satelite
  });

  it("la misma zona el mismo dia, dos corridas, deja UNA fila; al dia siguiente, otra", async () => {
    const repo = new RepoDoble();
    const ctx = { ambito: { tipo: "zona" as const, zonaId: ZONA_A }, diasMasAntigua: 4 };

    expect(await emitirDevolucionesRepresadas(repo, { ...ctx, diaCR: DIA })).toBe(1);
    expect(await emitirDevolucionesRepresadas(repo, { ...ctx, diaCR: DIA })).toBe(0);
    expect(await emitirDevolucionesRepresadas(repo, { ...ctx, diaCR: "2026-09-12" })).toBe(1);
    expect(repo.creadas).toHaveLength(2);
  });
});

describe("R50 — el texto dice cuantos dias lleva la mas antigua DEL AMBITO", () => {
  async function detalle(diasMasAntigua: number) {
    const repo = new RepoDoble();
    await emitirDevolucionesRepresadas(repo, {
      ambito: { tipo: "global" },
      diasMasAntigua,
      diaCR: DIA,
    });
    return repo.creadas[0].descripcion;
  }

  it("literal escrito a mano", async () => {
    expect(await detalle(8)).toBe("La más antigua lleva 8 días en bodega. Coordiná la devolución.");
  });

  it("singular, y el caso propio del dia cero", async () => {
    expect(await detalle(1)).toBe("La más antigua lleva 1 día en bodega. Coordiná la devolución.");
    expect(await detalle(0)).toBe("La más antigua entró hoy a bodega. Coordiná la devolución.");
  });
});

describe("R54 — el texto NO lleva PII, tampoco la zona ni la tienda", () => {
  it("ni guia, ni remision, ni direccion, ni telefono, ni destinatario, ni tienda, ni monto", async () => {
    const repo = new RepoDoble();
    await emitirDevolucionesRepresadas(repo, {
      ambito: { tipo: "zona", zonaId: ZONA_A },
      diasMasAntigua: 9,
      diaCR: DIA,
    });
    expect(repo.creadas).toHaveLength(1); // autocomprobacion

    const texto = `${repo.creadas[0].descripcion} ${repo.creadas[0].anexo ?? ""}`;
    expect(texto).not.toMatch(/guía|guia/i);
    expect(texto).not.toMatch(/remisi/i);
    expect(texto).not.toMatch(/direcci/i);
    expect(texto).not.toMatch(/teléfono|telefono/i);
    expect(texto).not.toMatch(/destinatario/i);
    expect(texto).not.toMatch(/tienda [A-Z]/);
    expect(texto).not.toContain("₡");
    expect(texto).not.toContain(ZONA_A); // el ambito va en la ENTIDAD, nunca en el texto
  });
});
