import { describe, it, expect } from "vitest";
import { VistaFiltroService } from "@/lib/services/VistaFiltroService";
import type {
  CreacionVista,
  EscrituraVista,
  IVistaFiltroRepository,
  VistaFiltroFila,
} from "@/lib/interfaces/repositories/IVistaFiltroRepository";
import {
  MAX_VISTAS_POR_SUPERFICIE,
  NOMBRE_VISTA_MAX,
  VISTA_FILTRO_VERSION,
  type VistaFiltroPayload,
} from "@/lib/types/vista-filtro";

// FICHA 453 (T2.1) — LAS REGLAS DEL SERVICIO, con un doble de repositorio: R2 (la parte que se ve
// desde aqui: el dueño viaja en TODAS las llamadas), R8, R9, R10, R11, R12, R13, R15 y R16.
//
// ⚠️ LO QUE ESTE ARCHIVO NO PUEDE DEMOSTRAR, Y HAY QUE DECIRLO: un doble NO VE EL `WHERE`. Que el
// `usuario_id` acote de verdad la escritura se prueba contra Postgres real en
// `tests/integration/db/vista-filtro.test.ts`. Aqui solo se ve que el servicio se lo PASA.

const AHORA = new Date("2026-09-21T15:00:00.000Z");
const ANA = "usuario-ana";

const PAYLOAD: VistaFiltroPayload = {
  v: VISTA_FILTRO_VERSION,
  termino: "san jose",
  activos: ["zona"],
  seleccion: { zona: ["z-1"] },
};

const VACIO: VistaFiltroPayload = { v: VISTA_FILTRO_VERSION, termino: "", activos: [], seleccion: {} };

interface Llamada {
  metodo: string;
  usuarioId: string;
  args: unknown[];
}

interface Guion {
  filas?: VistaFiltroFila[];
  cuantas?: number;
  alCrear?: CreacionVista;
  alEscribir?: EscrituraVista;
  alEliminar?: number;
}

function filaDe(over: Partial<VistaFiltroFila> = {}): VistaFiltroFila {
  return {
    id: "v-1",
    usuarioId: ANA,
    superficie: "ordenes",
    nombre: "San Jose arriba",
    filtro: PAYLOAD,
    version: VISTA_FILTRO_VERSION,
    actualizadaEn: AHORA,
    ...over,
  };
}

/** Doble del repositorio que APUNTA cada llamada: es como se mide que el dueño viaja siempre. */
function dobleRepo(guion: Guion = {}): IVistaFiltroRepository & { llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  return {
    llamadas,
    async listar(usuarioId, superficie) {
      llamadas.push({ metodo: "listar", usuarioId, args: [superficie] });
      return guion.filas ?? [];
    },
    async contar(usuarioId, superficie) {
      llamadas.push({ metodo: "contar", usuarioId, args: [superficie] });
      return guion.cuantas ?? 0;
    },
    async crear(usuarioId, superficie, nombre, filtro, version) {
      llamadas.push({ metodo: "crear", usuarioId, args: [superficie, nombre, filtro, version] });
      return guion.alCrear ?? { estado: "creada", fila: filaDe({ nombre, superficie }) };
    },
    async renombrar(id, usuarioId, nombre) {
      llamadas.push({ metodo: "renombrar", usuarioId, args: [id, nombre] });
      return guion.alEscribir ?? { estado: "actualizada", fila: filaDe({ id, nombre }) };
    },
    async actualizarFiltro(id, usuarioId, filtro, version) {
      llamadas.push({ metodo: "actualizarFiltro", usuarioId, args: [id, filtro, version] });
      return guion.alEscribir ?? { estado: "actualizada", fila: filaDe({ id, filtro }) };
    },
    async eliminar(id, usuarioId) {
      llamadas.push({ metodo: "eliminar", usuarioId, args: [id] });
      return guion.alEliminar ?? 1;
    },
  };
}

const ESCRITURAS = new Set(["crear", "renombrar", "actualizarFiltro", "eliminar"]);

describe("453/R9 · el nombre es obligatorio", () => {
  it("⭑ un nombre vacio —o solo espacios— se rechaza, y NO se escribe nada", async () => {
    const repo = dobleRepo();
    const servicio = new VistaFiltroService(repo);
    for (const bruto of ["", "   ", "\t\n"]) {
      const r = await servicio.guardar(ANA, { superficie: "ordenes", nombre: bruto, filtro: PAYLOAD });
      expect(r.status, `«${bruto}» deberia rechazarse`).toBe("validation_error");
      if (r.status === "validation_error") expect(r.fieldErrors.nombre?.[0]).toBeTruthy();
    }
    expect(repo.llamadas.filter((l) => ESCRITURAS.has(l.metodo))).toEqual([]);
  });

  it("⭑ los extremos se recortan: «  San Jose  » se guarda como «San Jose»", async () => {
    const repo = dobleRepo();
    const r = await new VistaFiltroService(repo).guardar(ANA, {
      superficie: "ordenes",
      nombre: "  San Jose  ",
      filtro: PAYLOAD,
    });
    expect(r.status).toBe("ok");
    const creada = repo.llamadas.find((l) => l.metodo === "crear")!;
    expect(creada.args[1]).toBe("San Jose");
  });
});

describe("453/R10 · el maximo del nombre, y el mensaje DICE cual es", () => {
  it("⭑ 60 entra; 61 se rechaza y el aviso lleva el numero", async () => {
    const repo = dobleRepo();
    const servicio = new VistaFiltroService(repo);

    const justo = await servicio.guardar(ANA, {
      superficie: "ordenes",
      nombre: "x".repeat(NOMBRE_VISTA_MAX),
      filtro: PAYLOAD,
    });
    expect(justo.status).toBe("ok");

    const pasado = await servicio.guardar(ANA, {
      superficie: "ordenes",
      nombre: "x".repeat(NOMBRE_VISTA_MAX + 1),
      filtro: PAYLOAD,
    });
    expect(pasado.status).toBe("validation_error");
    if (pasado.status === "validation_error") {
      // Se afirma que el mensaje CONTIENE el numero, no que sea igual a la constante que lo genera:
      // comparar un texto con su propia fuente esta verde siempre.
      expect(pasado.fieldErrors.nombre?.[0]).toContain(String(NOMBRE_VISTA_MAX));
    }
  });
});

describe("453/R11 · el nombre duplicado se rechaza y NO sobrescribe", () => {
  it("⭑ el `nombre_en_uso` del repositorio sale como `conflict`", async () => {
    const repo = dobleRepo({ alCrear: { estado: "nombre_en_uso" } });
    const r = await new VistaFiltroService(repo).guardar(ANA, {
      superficie: "ordenes",
      nombre: "San Jose arriba",
      filtro: PAYLOAD,
    });
    expect(r.status).toBe("conflict");
    // Y NO hay una segunda escritura que «arregle» el choque pisando la existente.
    expect(repo.llamadas.filter((l) => ESCRITURAS.has(l.metodo))).toHaveLength(1);
  });

  it("⭑ renombrar aplica la misma regla (R14)", async () => {
    const repo = dobleRepo({ alEscribir: { estado: "nombre_en_uso" } });
    const r = await new VistaFiltroService(repo).renombrar(ANA, { id: "v-1", nombre: "Otra" });
    expect(r.status).toBe("conflict");
  });
});

describe("453/R12 · no se guarda una vista que no filtra nada", () => {
  it("⭑ un payload vacio se rechaza al GUARDAR, sin tocar la base", async () => {
    const repo = dobleRepo();
    const r = await new VistaFiltroService(repo).guardar(ANA, {
      superficie: "ordenes",
      nombre: "Vacia",
      filtro: VACIO,
    });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors.filtro?.[0]).toBeTruthy();
    expect(repo.llamadas.filter((l) => ESCRITURAS.has(l.metodo))).toEqual([]);
  });

  it("⭑ y tambien al ACTUALIZAR (R15 dice que se aplican las mismas reglas)", async () => {
    const repo = dobleRepo();
    const r = await new VistaFiltroService(repo).actualizar(ANA, { id: "v-1", filtro: VACIO });
    expect(r.status).toBe("validation_error");
    expect(repo.llamadas.filter((l) => ESCRITURAS.has(l.metodo))).toEqual([]);
  });
});

describe("453/R13 · el tope por superficie, con su numero y con el que ya se tiene", () => {
  it("⭑ con el maximo puesto se rechaza, diciendo cuantas hay y cual es el tope", async () => {
    const repo = dobleRepo({ cuantas: MAX_VISTAS_POR_SUPERFICIE });
    const r = await new VistaFiltroService(repo).guardar(ANA, {
      superficie: "ordenes",
      nombre: "La 21",
      filtro: PAYLOAD,
    });
    expect(r.status).toBe("limite_excedido");
    if (r.status === "limite_excedido") {
      expect(r.maximo).toBe(MAX_VISTAS_POR_SUPERFICIE);
      expect(r.actuales).toBe(MAX_VISTAS_POR_SUPERFICIE);
    }
    // Y no llego a intentarse la escritura.
    expect(repo.llamadas.filter((l) => l.metodo === "crear")).toEqual([]);
  });

  it("⭑ con una menos que el maximo, SI se guarda (control positivo)", async () => {
    const repo = dobleRepo({ cuantas: MAX_VISTAS_POR_SUPERFICIE - 1 });
    const r = await new VistaFiltroService(repo).guardar(ANA, {
      superficie: "ordenes",
      nombre: "La 20",
      filtro: PAYLOAD,
    });
    // Sin este caso, un servicio que rechazara SIEMPRE pasaria el de arriba en verde.
    expect(r.status).toBe("ok");
  });

  it("⭑ el tope se cuenta POR SUPERFICIE, no en total", async () => {
    const repo = dobleRepo({ cuantas: 3 });
    await new VistaFiltroService(repo).guardar(ANA, {
      superficie: "ordenes",
      nombre: "Otra",
      filtro: PAYLOAD,
    });
    const contar = repo.llamadas.find((l) => l.metodo === "contar")!;
    expect(contar.args[0]).toBe("ordenes");
    expect(contar.usuarioId).toBe(ANA);
  });
});

describe("453/R8 · un documento ilegible sale con `filtro: null`, nunca a medias", () => {
  it("⭑ la vista aparece igual —para poder renombrarla o borrarla— pero sin filtro", async () => {
    const repo = dobleRepo({
      filas: [
        filaDe({ id: "buena", nombre: "Buena", filtro: PAYLOAD }),
        // Una version que este codigo no conoce...
        filaDe({ id: "futura", nombre: "Del futuro", filtro: { ...PAYLOAD, v: 2 }, version: 2 }),
        // ...y un documento roto.
        filaDe({ id: "rota", nombre: "Rota", filtro: { cualquier: "cosa" } }),
      ],
    });
    const r = await new VistaFiltroService(repo).listar(ANA, "ordenes");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    expect(r.vistas.map((v) => v.id)).toEqual(["buena", "futura", "rota"]);
    expect(r.vistas[0].filtro).toEqual(PAYLOAD);
    // ⚠️ NO se «interpretan lo mejor posible»: aplicar un filtro que nadie guardo es peor que no
    // aplicar ninguno. La interfaz las marca ilegibles por este `null`.
    expect(r.vistas[1].filtro).toBeNull();
    expect(r.vistas[2].filtro).toBeNull();
  });

  it("⭑ el DTO no filtra el documento crudo: o es un payload valido, o es `null`", async () => {
    const repo = dobleRepo({ filas: [filaDe({ filtro: { v: 1, termino: 5 } })] });
    const r = await new VistaFiltroService(repo).listar(ANA, "ordenes");
    if (r.status !== "ok") throw new Error("deberia listar");
    expect(r.vistas[0].filtro).toBeNull();
  });
});

describe("453/R15 · actualizar reemplaza el filtro y conserva el nombre", () => {
  it("⭑ manda el documento nuevo y la version vigente, y NO manda ningun nombre", async () => {
    const nuevo: VistaFiltroPayload = {
      v: VISTA_FILTRO_VERSION,
      termino: "cartago",
      activos: ["zona"],
      seleccion: { zona: ["z-9"] },
    };
    const repo = dobleRepo();
    const r = await new VistaFiltroService(repo).actualizar(ANA, { id: "v-1", filtro: nuevo });
    expect(r.status).toBe("ok");

    const escritura = repo.llamadas.find((l) => l.metodo === "actualizarFiltro")!;
    expect(escritura.args[0]).toBe("v-1");
    expect(escritura.args[1]).toEqual(nuevo);
    expect(escritura.args[2]).toBe(VISTA_FILTRO_VERSION);
    // El nombre no viaja: no hay forma de que actualizar lo cambie por accidente.
    expect(escritura.args).toHaveLength(3);
  });
});

describe("453/R2 · el dueño viaja en TODAS las llamadas, y una ajena es `not_found`", () => {
  it("⭑ cada operacion le pasa al repositorio el usuario de la sesion", async () => {
    const repo = dobleRepo();
    const servicio = new VistaFiltroService(repo);
    await servicio.listar(ANA, "ordenes");
    await servicio.guardar(ANA, { superficie: "ordenes", nombre: "Una", filtro: PAYLOAD });
    await servicio.renombrar(ANA, { id: "v-1", nombre: "Dos" });
    await servicio.actualizar(ANA, { id: "v-1", filtro: PAYLOAD });
    await servicio.eliminar(ANA, "v-1");

    // AUTOCOMPROBACION: si el doble no hubiera registrado nada, el `every` seria verde por vacio.
    expect(repo.llamadas.length).toBeGreaterThanOrEqual(6);
    expect(repo.llamadas.every((l) => l.usuarioId === ANA)).toBe(true);
    expect(new Set(repo.llamadas.map((l) => l.metodo))).toEqual(
      new Set(["listar", "contar", "crear", "renombrar", "actualizarFiltro", "eliminar"]),
    );
  });

  it("⭑ una vista que el `WHERE` no encuentra responde `not_found`, NO `forbidden`", async () => {
    // `forbidden` confirmaria que ese id existe y es de otra persona: sobre un recurso
    // estrictamente personal, eso es una filtracion gratuita.
    const repo = dobleRepo({ alEscribir: { estado: "sin_coincidencia" }, alEliminar: 0 });
    const servicio = new VistaFiltroService(repo);
    expect((await servicio.renombrar(ANA, { id: "ajena", nombre: "Mia" })).status).toBe("not_found");
    expect((await servicio.actualizar(ANA, { id: "ajena", filtro: PAYLOAD })).status).toBe(
      "not_found",
    );
    expect((await servicio.eliminar(ANA, "ajena")).status).toBe("not_found");
  });
});

describe("453/R16 · aplicar no puede escribir, porque no hay con que", () => {
  it("⭑ el servicio NO expone ninguna operacion de aplicar", () => {
    const servicio = new VistaFiltroService(dobleRepo());
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(servicio)).filter(
      (m) => m !== "constructor" && !m.startsWith("_"),
    );
    // AUTOCOMPROBACION: la lista no esta vacia, o el `not.toContain` seria verde por vacio.
    expect(metodos.length).toBeGreaterThan(0);
    for (const prohibido of ["aplicar", "aplicarVista", "usar", "marcarAplicada"]) {
      expect(metodos, `el servicio no deberia tener ${prohibido}`).not.toContain(prohibido);
    }
    // Y los que hay son exactamente los cinco del contrato.
    expect(metodos.sort()).toEqual(
      ["aDTO", "actualizar", "deEscritura", "eliminar", "guardar", "listar", "renombrar"].sort(),
    );
  });

  it("⭑ leer la lista no dispara NI UNA escritura", async () => {
    const repo = dobleRepo({ filas: [filaDe()] });
    await new VistaFiltroService(repo).listar(ANA, "ordenes");
    expect(repo.llamadas.map((l) => l.metodo)).toEqual(["listar"]);
  });
});
