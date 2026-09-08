import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { UsuarioService } from "@/lib/services/UsuarioService";
import type {
  IUserRepository,
  UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ICierreBodegaRepository } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 379 / T12 (R14) — **NADA BLOQUEA AL MAESTRO.** La decision del humano, escrita como test.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Sus palabras, el 2026-09-08: «no, no quiero daños». La guarda dura —impedir el cambio mientras
// haya dinero atrapado— quedo DEROGADA. El aviso INFORMA; no impide.
//
// R14 es un requisito NEGATIVO, y los negativos no se prueban solos: hay que atacarlos por los dos
// lados, porque cada lado deja pasar lo que el otro caza.
//
//   (a) COMPORTAMIENTO — con dinero pendiente y CERO administradores restantes, `actualizar` y
//       `cambiarEstado` devuelven `ok` y escriben. Caza la rama de bloqueo que alguien anada.
//   (b) ESTRUCTURA — los cuerpos de esos dos metodos no mencionan el repositorio de cierres ni
//       `consultarImpactoCambio`. Caza el ACOPLE antes de que llegue a ser una rama: el dia que
//       la escritura empiece a leer el dinero «solo para registrarlo», la siguiente persona
//       tendra a mano el `if` que R14 prohibe. Y caza tambien la variante que (a) no ve: leer el
//       dinero y NO usarlo todavia deja la suite verde.
//
// ⚠️ La mitad estatica se AUTOCOMPRUEBA. Una guardia estatica rota no falla: CALLA. En este repo
// una paso verde con su detector roto —encontraba cero porque no encontraba nada—. Por eso aqui
// el detector se prueba en las dos direcciones y ademas se le da el cuerpo MUTADO en memoria,
// exigiendo que lo cace.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");
const RUTA_SERVICIO = "lib/services/UsuarioService.ts";

// ---------------------------------------------------------------------------------------------
// El detector
// ---------------------------------------------------------------------------------------------

/**
 * Extrae el CUERPO de un metodo por conteo de llaves, sobre el fuente ya SIN COMENTARIOS.
 *
 * Sin quitar los comentarios esto no valdria nada: el cuerpo de `actualizar` explica en prosa
 * por que la zona sigue al rol y nombra la ficha; y el de `cambiarEstado` podria explicar por que
 * NO consulta el impacto — o sea, la explicacion correcta haria roja a la guardia y alguien la
 * borraria para pasarla. Ese es exactamente el fallo que `quitarComentarios` existe para cerrar.
 */
export function cuerpoDeMetodo(fuente: string, nombre: string): string | null {
  const firma = new RegExp(`\\n {2}async ${nombre}\\s*\\(`);
  const inicio = fuente.search(firma);
  if (inicio === -1) return null;
  const abre = fuente.indexOf("{", fuente.indexOf(")", inicio));
  if (abre === -1) return null;
  let profundidad = 0;
  for (let i = abre; i < fuente.length; i++) {
    if (fuente[i] === "{") profundidad++;
    else if (fuente[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuente.slice(abre, i + 1);
    }
  }
  return null;
}

/** Los nombres que un camino de ESCRITURA no puede nombrar sin acoplarse al dinero. */
const PROHIBIDOS = [
  "cierresRepo",
  "resumirConsolidablesPendientes",
  "consultarImpactoCambio",
  "contarAdminSatelitesActivos",
];

export function mencionaElDinero(cuerpo: string): string[] {
  return PROHIBIDOS.filter((nombre) => cuerpo.includes(nombre));
}

const FUENTE = quitarComentarios(readFileSync(path.join(RAIZ, RUTA_SERVICIO), "utf8"));

// ---------------------------------------------------------------------------------------------
// (0) El detector se prueba a si mismo, en las dos direcciones
// ---------------------------------------------------------------------------------------------

describe("379/T12 — el detector se prueba a si mismo", () => {
  it("anti-vacuidad: el fuente se leyo y tiene tamano", () => {
    expect(FUENTE.length).toBeGreaterThan(5_000);
    expect(FUENTE).toContain("class UsuarioService");
  });

  it("encuentra los dos cuerpos que vigila, y no son vacios", () => {
    for (const metodo of ["actualizar", "cambiarEstado"]) {
      const cuerpo = cuerpoDeMetodo(FUENTE, metodo);
      expect(cuerpo, `no se encontro el cuerpo de \`${metodo}\``).not.toBeNull();
      expect(cuerpo!.length).toBeGreaterThan(80);
      // Control positivo: el cuerpo extraido es DE VERDAD el del metodo.
      expect(cuerpo).toContain("ALLOWED_ROLES");
    }
    // Y no se lleva medio archivo por delante: el de `cambiarEstado` es corto.
    expect(cuerpoDeMetodo(FUENTE, "cambiarEstado")!.length).toBeLessThan(1_200);
  });

  it("devuelve `null` para un metodo que no existe (no inventa cuerpos)", () => {
    expect(cuerpoDeMetodo(FUENTE, "metodoQueNoExiste")).toBeNull();
  });

  it("CONTRAPRUEBA: el detector SI encuentra el metodo que tiene permitido nombrarlos", () => {
    // Sin esto, los barridos de abajo podrian estar verdes porque el detector no encuentra nada.
    const cuerpo = cuerpoDeMetodo(FUENTE, "consultarImpactoCambio");
    expect(cuerpo).not.toBeNull();
    expect(mencionaElDinero(cuerpo!).length).toBeGreaterThan(0);
  });

  it("⭑ CONTRAPRUEBA: con la mutacion aplicada EN MEMORIA, la asercion la caza", () => {
    // La mutacion que R14 prohibe, escrita a mano: `cambiarEstado` mira el dinero antes de
    // escribir. Si el detector no la viera, esta guardia estaria callando en vez de vigilando.
    const cuerpoMutado = `{
      if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
      const impacto = await this.consultarImpactoCambio(id, { estado: input.estado }, actor);
      if (impacto.status === "ok" && impacto.impacto !== null) return { status: "conflict" };
      const usuario = await this.repo.setEstado(id, input.estado, actor.usuarioId);
      return { status: "ok", usuario };
    }`;
    expect(mencionaElDinero(cuerpoMutado)).toContain("consultarImpactoCambio");
  });
});

// ---------------------------------------------------------------------------------------------
// (b) La mitad ESTRUCTURAL
// ---------------------------------------------------------------------------------------------

describe("379/R14 — los caminos de ESCRITURA no tocan el dinero", () => {
  it.each(["actualizar", "cambiarEstado"])(
    "el cuerpo de `%s` no menciona el repositorio de cierres ni la consulta de impacto",
    (metodo) => {
      const cuerpo = cuerpoDeMetodo(FUENTE, metodo);
      expect(cuerpo).not.toBeNull();
      expect(
        mencionaElDinero(cuerpo!),
        `\`${metodo}\` se acoplo al dinero. R14 no es un detalle: es la decision del humano del ` +
          "2026-09-08 («no, no quiero daños»). El aviso vive en `consultarImpactoCambio`, que es " +
          "una lectura aparte y que nadie del camino de escritura llama.",
      ).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// (a) La mitad de COMPORTAMIENTO
// ---------------------------------------------------------------------------------------------

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const ROLES = [
  { id: "rol-sat", value: "adminSatelite" as const },
  { id: "rol-admin", value: "admin" as const },
];

function usuario(over: Partial<UsuarioPublico> = {}): UsuarioPublico {
  return {
    id: "usr-1",
    nombre: "Ana",
    email: "ana@example.com",
    telefono: "099",
    estado: "activo",
    cedula: "1710034065",
    tipoIdentificacionId: "tipo-1",
    rolId: "rol-sat",
    fulfillment: false,
    zonaId: "z1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  };
}

/** El peor escenario posible: dinero pendiente y CERO administradores restantes en la zona. */
function elPeorEscenario() {
  const repo: IUserRepository = {
    findByEmailWithHash: vi.fn(),
    findById: vi.fn().mockResolvedValue(usuario()),
    findByEmail: vi.fn(),
    create: vi.fn(),
    updatePasswordHash: vi.fn(),
    restablecerContrasena: vi.fn(),
    listMensajeros: vi.fn(),
    listMensajerosParaFiltro: vi.fn(),
    listByRol: vi.fn().mockResolvedValue([]),
    listCuentasTienda: vi.fn().mockResolvedValue([]),
    obtenerCuentaTienda: vi.fn().mockResolvedValue(null), // exigido por IUserRepository (ficha 381); no ejercitado aqui
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue(usuario({ rolId: "rol-admin", zonaId: null })),
    setEstado: vi.fn().mockResolvedValue(usuario({ estado: "inactivo" })),
    listTiposIdentificacion: vi.fn(),
    listRoles: vi.fn().mockResolvedValue(ROLES),
    contarAdminSatelitesActivos: vi.fn().mockResolvedValue(0), // no queda NADIE
  };
  const zonaRepo = {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue({
      id: "z1",
      nombre: "El Coco",
      cobroVehiculo: false,
      distritosCount: 0,
      esCentral: false,
    }),
    list: vi.fn(),
    listLite: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    hardDelete: vi.fn(),
    countExistingDistritos: vi.fn(),
    countExistingVehiculos: vi.fn(),
    findCentralZonaId: vi.fn().mockResolvedValue(null),
    contarOrdenesVivasPorZona: vi.fn().mockResolvedValue([]),
  } satisfies IZonaRepository;
  const cierresRepo: Pick<ICierreBodegaRepository, "resumirConsolidablesPendientes"> = {
    // Muchisimo dinero atrapado: el escenario que una guarda dura habria bloqueado.
    resumirConsolidablesPendientes: vi
      .fn()
      .mockResolvedValue({ cantidad: 12, totalGeneral: "9876543.21" }),
  };
  const svc = new UsuarioService(repo, zonaRepo, undefined, undefined, cierresRepo);
  return { svc, repo, cierresRepo };
}

describe("379/R14 — con dinero atrapado y cero admines, el maestro SIGUE pudiendo", () => {
  it("el escenario es de verdad el peor (control positivo: la consulta SI avisaria)", async () => {
    // Sin este caso, los dos de abajo podrian estar verdes porque el escenario no dispara nada.
    const { svc } = elPeorEscenario();
    const r = await svc.consultarImpactoCambio("usr-1", { rolId: "rol-admin" }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.impacto).not.toBeNull();
    expect(r.impacto?.totalSinConsolidar).toBe("9876543.21");
  });

  it("⭑ `actualizar` devuelve ok y ESCRIBE, sin consultar el impacto ni el dinero", async () => {
    const { svc, repo, cierresRepo } = elPeorEscenario();
    const r = await svc.actualizar("usr-1", { rolId: "rol-admin" }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.update).toHaveBeenCalledTimes(1);
    // Y no paso por el dinero ni por el recuento: no es que le diera igual el resultado, es que
    // ni lo pregunto.
    expect(cierresRepo.resumirConsolidablesPendientes).not.toHaveBeenCalled();
    expect(repo.contarAdminSatelitesActivos).not.toHaveBeenCalled();
  });

  it("⭑ `cambiarEstado` desactiva al ultimo Admin satelite y devuelve ok", async () => {
    const { svc, repo, cierresRepo } = elPeorEscenario();
    const r = await svc.cambiarEstado("usr-1", { estado: "inactivo" }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.setEstado).toHaveBeenCalledWith("usr-1", "inactivo", "m1");
    expect(cierresRepo.resumirConsolidablesPendientes).not.toHaveBeenCalled();
    expect(repo.contarAdminSatelitesActivos).not.toHaveBeenCalled();
  });

  it("⭑ `actualizar` tampoco bloquea el cambio de ZONA del ultimo Admin satelite", async () => {
    const { svc, repo } = elPeorEscenario();
    const r = await svc.actualizar("usr-1", { zonaId: "z9" }, MAESTRO);
    expect(r.status).toBe("ok");
    expect((repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1].zonaId).toBe("z9");
  });
});
