import { describe, it, expect } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import { emitirNovedadesSinGestionar } from "@/lib/notificaciones/emitir";

// FICHA 409 (T3.1) — EL AVISO «tienes N novedades sin gestionar», contra un repositorio doble.
// Cubre R35 (UNA notificacion), R36 (jamas una por orden), R37 (los dias de la mas antigua),
// R39/R40 (las TRES formas del plazo) y R44 (sin PII).
//
// ⚠️ EL DOBLE REPRODUCE LA CLAVE REAL DEL INDICE, QUE **NO** INCLUYE EL ALCANCE. `columnasDestinatario`
// de `NotificacionRepository` traduce el destinatario a `(destinatario_rol, destinatario_usuario_id)`
// y deja `tienda_id`/`zona_id` FUERA de `notificacion_dedupe_key`. Un doble que metiera la tienda en
// su clave —como hacen algunos hermanos de esta carpeta— seria MAS PERMISIVO que la base y no
// veria el fallo que esta ficha existe para evitar. Aqui la clave es la de verdad, asi que quitar
// el `tiendaId` del `entidadId` pone rojo tambien este archivo, no solo el de integracion.

class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  private readonly claves = new Set<string>();
  private readonly noLeidas = new Set<string>();

  /** EXACTAMENTE `notificacion_dedupe_key`: el ALCANCE no entra, a proposito. */
  private clave(
    evento: NotificacionEvento,
    entidadId: string,
    destinatario: NotificacionDestinatario,
  ): string {
    const quien =
      destinatario.tipo === "rol" ? `rol:${destinatario.rol}` : `usuario:${destinatario.usuarioId}`;
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

const TIENDA = "11111111-1111-4111-8111-111111111111";
const OTRA_TIENDA = "22222222-2222-4222-8222-222222222222";
const DIA = "2026-09-11";

describe("R35/R36 — UNA sola notificacion con el numero dentro, jamas una por orden", () => {
  it("cuarenta novedades producen UNA fila", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirNovedadesSinGestionar(repo, {
      tiendaId: TIENDA,
      diasMasAntigua: 3,
      plazo: "cinco_dias",
      diaCR: DIA,
    });

    expect(creadas).toBe(1);
    expect(repo.creadas).toHaveLength(1);
  });

  it("va dirigida al rol adminTienda ACOTADO a esa tienda, como `alert` y sin anexo", async () => {
    const repo = new RepoDoble();

    await emitirNovedadesSinGestionar(repo, {
      tiendaId: TIENDA,
      diasMasAntigua: 3,
      plazo: "cinco_dias",
      diaCR: DIA,
    });

    expect(repo.creadas[0].tipo).toBe("alert");
    expect(repo.creadas[0].evento).toBe("novedades_sin_gestionar");
    expect(repo.creadas[0].destinatario).toEqual({
      tipo: "rol",
      rol: "adminTienda",
      tiendaId: TIENDA,
    });
    expect(repo.creadas[0].anexo).toBeNull();
    expect(repo.creadas[0].entidadTipo).toBe("novedades_sin_gestionar_dia");
  });
});

describe("R41/R42 — la ENTIDAD lleva la tienda Y el dia, y es lo que evita el silencio total", () => {
  it("el `entidadId` es exactamente `<tiendaId>:<diaCR>`", async () => {
    const repo = new RepoDoble();

    await emitirNovedadesSinGestionar(repo, {
      tiendaId: TIENDA,
      diasMasAntigua: 1,
      plazo: "cinco_dias",
      diaCR: DIA,
    });

    expect(repo.creadas[0].entidadId).toBe(`${TIENDA}:${DIA}`);
  });

  it("DOS tiendas el MISMO dia reciben DOS avisos (mutacion: quitar la tienda -> 1)", async () => {
    const repo = new RepoDoble();
    const base = { diasMasAntigua: 2, plazo: "cinco_dias" as const, diaCR: DIA };

    await emitirNovedadesSinGestionar(repo, { ...base, tiendaId: TIENDA });
    await emitirNovedadesSinGestionar(repo, { ...base, tiendaId: OTRA_TIENDA });

    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas.map((c) => c.entidadId)).toEqual([
      `${TIENDA}:${DIA}`,
      `${OTRA_TIENDA}:${DIA}`,
    ]);
  });

  it("la MISMA tienda el MISMO dia, dos corridas, deja UNA sola fila", async () => {
    const repo = new RepoDoble();
    const ctx = { tiendaId: TIENDA, diasMasAntigua: 2, plazo: "cinco_dias" as const, diaCR: DIA };

    const primera = await emitirNovedadesSinGestionar(repo, ctx);
    const segunda = await emitirNovedadesSinGestionar(repo, ctx);

    expect(primera).toBe(1);
    expect(segunda).toBe(0);
    expect(repo.creadas).toHaveLength(1);
  });

  it("el dia SIGUIENTE vuelve a avisar (el recordatorio diario es estructural)", async () => {
    const repo = new RepoDoble();
    const base = { tiendaId: TIENDA, diasMasAntigua: 2, plazo: "cinco_dias" as const };

    await emitirNovedadesSinGestionar(repo, { ...base, diaCR: DIA });
    await emitirNovedadesSinGestionar(repo, { ...base, diaCR: "2026-09-12" });

    expect(repo.creadas).toHaveLength(2);
  });
});

describe("R37/R39/R40 — el texto dice los dias, y el plazo SOLO cuando puede", () => {
  async function detalle(diasMasAntigua: number, plazo: "cinco_dias" | "veinticuatro_horas" | "mezclado") {
    const repo = new RepoDoble();
    await emitirNovedadesSinGestionar(repo, { tiendaId: TIENDA, diasMasAntigua, plazo, diaCR: DIA });
    return repo.creadas[0].descripcion;
  }

  it("(a) lote homogeneo de cinco dias — literal escrito a mano", async () => {
    expect(await detalle(3, "cinco_dias")).toBe(
      "La más antigua lleva 3 días en bodega. A los 5 días se rechaza automáticamente.",
    );
  });

  it("(b) lote homogeneo de 24 horas — literal escrito a mano", async () => {
    expect(await detalle(2, "veinticuatro_horas")).toBe(
      "La más antigua lleva 2 días en bodega. A las 24 horas de entrar, el sistema la reintenta o la rechaza sin esperar tu decisión.",
    );
  });

  it("(c) plazos MEZCLADOS: el texto NO afirma ninguna cifra de plazo", async () => {
    const texto = await detalle(4, "mezclado");

    expect(texto).toBe(
      "La más antigua lleva 4 días en bodega. Los plazos vencen en momentos distintos según la causa: revisalas una por una.",
    );
    // La mitad que importa de R40: ni «5 días» ni «24 horas» aparecen por ningun lado.
    expect(texto).not.toContain("5 días");
    expect(texto).not.toContain("24 horas");
    expect(texto).not.toMatch(/A los \d+ días/);
  });

  it("singular y plural, con su caso propio para el dia cero", async () => {
    expect(await detalle(1, "cinco_dias")).toContain("La más antigua lleva 1 día en bodega.");
    expect(await detalle(0, "cinco_dias")).toContain("La más antigua entró hoy a bodega.");
    expect(await detalle(0, "cinco_dias")).not.toContain("0 días");
  });
});

describe("R44 — el texto NO lleva PII", () => {
  it("ni guia, ni remision, ni direccion, ni telefono, ni destinatario, ni monto", async () => {
    const repo = new RepoDoble();
    for (const plazo of ["cinco_dias", "veinticuatro_horas", "mezclado"] as const) {
      await emitirNovedadesSinGestionar(repo, {
        tiendaId: TIENDA,
        diasMasAntigua: 7,
        plazo,
        diaCR: `2026-09-${plazo === "cinco_dias" ? "11" : plazo === "mezclado" ? "12" : "13"}`,
      });
    }
    expect(repo.creadas.length).toBeGreaterThan(0); // autocomprobacion

    for (const fila of repo.creadas) {
      const texto = `${fila.descripcion} ${fila.anexo ?? ""}`;
      expect(texto).not.toMatch(/guía|guia/i);
      expect(texto).not.toMatch(/remisi/i);
      expect(texto).not.toMatch(/direcci/i);
      expect(texto).not.toMatch(/teléfono|telefono/i);
      expect(texto).not.toMatch(/destinatario/i);
      expect(texto).not.toContain("₡");
      // Y tampoco el id de la tienda: ese va en la ENTIDAD y en el ALCANCE, nunca en el texto.
      expect(texto).not.toContain(TIENDA);
    }
  });
});
