import { describe, it, expect, vi, beforeEach } from "vitest";

import { UsuarioService } from "@/lib/services/UsuarioService";
import type {
  IUserRepository,
  UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ICierreBodegaRepository } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 379 / T7 (R9/R10/R15/R16/R17/R22) — EL PREDICADO DEL AVISO, con dobles y sin base.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Lo que se mide aqui es la DECISION —a quien se avisa y a quien no—, que es logica pura del
// servicio. Lo que vive en un `WHERE` (el recuento de admines y el dinero de la cola) NO se mide
// aqui: esos dos estan medidos contra Postgres real en `tests/integration/db/`
// (`usuario-contar-adminsatelites` y `cierre-bodega-resumen-pendientes`), porque un doble
// devuelve lo que se le diga y no ve el SQL.
//
// El predicado, escrito una vez:
//   avisa ⇔ es HOY adminSatelite activo con zona Z ∧ el cambio hace que deje de serlo para Z
//           ∧ en Z no queda ningun otro adminSatelite activo.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const ROLES = [
  { id: "rol-msg", value: "mensajero" as const },
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

function buildRepo(over: Partial<IUserRepository> = {}): IUserRepository {
  return {
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
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn(),
    setEstado: vi.fn(),
    listTiposIdentificacion: vi.fn(),
    listRoles: vi.fn().mockResolvedValue(ROLES),
    // Por defecto: NO queda nadie mas. Es el caso que dispara el aviso, y los casos que no lo
    // disparan lo sobreescriben — asi ninguno pasa por accidente.
    contarAdminSatelitesActivos: vi.fn().mockResolvedValue(0),
    ...over,
  };
}

function buildZonaRepo(over: Partial<IZonaRepository> = {}): IZonaRepository {
  return {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue({
      id: "z1",
      nombre: "San Carlos",
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
    ...over,
  };
}

type CierresRepo = Pick<ICierreBodegaRepository, "resumirConsolidablesPendientes">;

function buildCierresRepo(cantidad = 3, totalGeneral = "1234567.89"): CierresRepo {
  return {
    resumirConsolidablesPendientes: vi.fn().mockResolvedValue({ cantidad, totalGeneral }),
  };
}

function servicio(
  repo: IUserRepository,
  cierres: CierresRepo | undefined = buildCierresRepo(),
  zonaRepo: IZonaRepository = buildZonaRepo(),
) {
  return new UsuarioService(repo, zonaRepo, undefined, undefined, cierres);
}

let repo: IUserRepository;
beforeEach(() => {
  vi.clearAllMocks();
  repo = buildRepo();
});

describe("379 · consultarImpactoCambio — las TRES puertas (R9/R10)", () => {
  it("R9/R10 · D2: cambiar el ROL del unico Admin satelite activo devuelve el impacto con zona, cuenta e importe", async () => {
    // ⚠️ ESTE CASO NO MUERDE LA COMPARACION DE ROL, y conviene saberlo antes de creerse su
    // nombre: `admin` NO lleva zona, asi que la zona resultante es `null`, la comparacion
    // `zonaResultante.zonaId === zonaId` ya falla por si sola y el aviso saldria igual aunque
    // el rol resultante se calculara mal. Lo que este caso prueba de verdad es la FORMA del
    // impacto (las cuatro claves, la cuenta, el importe y la zona por la que se pregunta).
    // Quien muerde el rol es el caso de abajo, con `mensajero`.
    const cierres = buildCierresRepo(4, "987654.32");
    const r = await servicio(repo, cierres).consultarImpactoCambio(
      "usr-1",
      { rolId: "rol-admin" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.impacto).toEqual({
      zonaNombre: "San Carlos",
      cierresSinConsolidar: 4,
      totalSinConsolidar: "987654.32",
      adminSatelitesActivosRestantes: 0,
    });
    // El dinero se pregunta por la zona VIVA del usuario, no por la que el cambio pide.
    expect(cierres.resumirConsolidablesPendientes).toHaveBeenCalledWith("z1");
  });

  it("⭑ R9/R10 · D2 de verdad: pasar de Admin satelite a MENSAJERO en la MISMA zona tambien avisa", async () => {
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // EL CASO QUE FALTABA, Y POR QUE FALTABA. Los tres casos que decian cubrir esta puerta
    // cambiaban el rol a `admin`, que no lleva zona: con la zona resultante en `null` el aviso
    // sale por la regla del BLOQUE A —la zona cambia— y no por la del rol. Medido con una
    // mutacion en `UsuarioService.consultarImpactoCambio` (paso 5):
    //
    //     const rolResultante = valorDelRol(cambio.rolId ?? actual.rolId);
    //     const rolResultante = valorDelRol(actual.rolId);              // <- la mutacion
    //
    // sobrevivia a 206 tests en 13 archivos: nada se ponia rojo, ni la guardia de R14 ni los
    // tres de `integration/db`. Y NO es un mutante equivalente: cambia el comportamiento en
    // este escenario exacto.
    //
    // `mensajero` es el OTRO rol que SI lleva zona (`ZONA_ROLES`), asi que aqui la zona
    // resultante sigue siendo `z1` y el estado sigue siendo `activo`: lo UNICO que mueve el
    // veredicto es el rol resultante. Con la mutacion, `rolResultante` vuelve a ser
    // `adminSatelite`, `sigueSiendoAdminDeLaZona` sale `true` y el impacto llega `null` — este
    // caso se pone rojo.
    //
    // Y es exactamente el escenario para el que la ficha existe: la zona conserva a la persona
    // y pierde a quien puede consolidar su dinero.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const zonaRepo = buildZonaRepo();
    const cierres = buildCierresRepo(4, "987654.32");
    const r = await servicio(repo, cierres, zonaRepo).consultarImpactoCambio(
      "usr-1",
      { rolId: "rol-msg" }, // mensajero, y NO se envia `zonaId`: la zona se conserva (R2)
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.impacto).toEqual({
      zonaNombre: "San Carlos",
      cierresSinConsolidar: 4,
      totalSinConsolidar: "987654.32",
      adminSatelitesActivosRestantes: 0,
    });
    // Control de que el escenario es el que se dice: NINGUNA zona distinta de `z1` entro en
    // juego. Si el aviso saliera porque la zona cambia —como en el caso de `admin`— este
    // control no lo detectaria, pero deja escrito y ejecutable que aqui la zona NO se mueve.
    for (const [zonaConsultada] of vi.mocked(zonaRepo.findById).mock.calls) {
      expect(zonaConsultada, "el caso perderia su sentido si mirara otra zona").toBe("z1");
    }
    expect(repo.contarAdminSatelitesActivos).toHaveBeenCalledWith("z1", "usr-1");
  });

  it("R9/R10 · D1: cambiar la ZONA del unico Admin satelite activo tambien avisa", async () => {
    const r = await servicio(repo).consultarImpactoCambio("usr-1", { zonaId: "z9" }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.impacto?.zonaNombre).toBe("San Carlos");
  });

  it("R9/R10 · D3: DESACTIVAR la cuenta del unico Admin satelite activo tambien avisa", async () => {
    // La puerta que la ficha 377/Q3 enseno a no dejarse fuera: cerrar «cambiar el rol» y no
    // «desactivar la cuenta» cierra una de las dos puertas al mismo agujero.
    const r = await servicio(repo).consultarImpactoCambio(
      "usr-1",
      { estado: "inactivo" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.impacto?.zonaNombre).toBe("San Carlos");
  });

  it("R19: el importe viaja como STRING y no se convierte a numero en ningun punto", async () => {
    const r = await servicio(repo, buildCierresRepo(1, "10000000.05")).consultarImpactoCambio(
      "usr-1",
      { estado: "inactivo" },
      MAESTRO,
    );
    if (r.status !== "ok" || r.impacto === null) throw new Error("se esperaba impacto");
    expect(typeof r.impacto.totalSinConsolidar).toBe("string");
    expect(r.impacto.totalSinConsolidar).toBe("10000000.05");
  });
});

describe("379 · consultarImpactoCambio — a quien NO se avisa (R15/R16)", () => {
  it("R15/AS2: con OTRO Admin satelite activo en la zona no hay impacto, aunque haya dinero", async () => {
    repo = buildRepo({ contarAdminSatelitesActivos: vi.fn().mockResolvedValue(1) });
    const cierres = buildCierresRepo(9, "500000.00");
    const r = await servicio(repo, cierres).consultarImpactoCambio(
      "usr-1",
      { rolId: "rol-admin" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.impacto).toBeNull();
    // Ese dinero es alcanzable: alguien puede consolidarlo. Avisar ahi seria ruido, y el ruido
    // mata avisos — asi que ni se pregunta.
    expect(cierres.resumirConsolidablesPendientes).not.toHaveBeenCalled();
  });

  it("R16: un mensajero que cambia de zona no avisa", async () => {
    // Sus cierres ya congelaron `destino_zona_id`: los consolida la zona de origen.
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(usuario({ rolId: "rol-msg" })) });
    const r = await servicio(repo).consultarImpactoCambio("usr-1", { zonaId: "z9" }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.impacto).toBeNull();
  });

  it("R16: un usuario sin zona no avisa", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(usuario({ zonaId: null })) });
    const r = await servicio(repo).consultarImpactoCambio(
      "usr-1",
      { rolId: "rol-admin" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.impacto).toBeNull();
    // Y ni se molesta en contar: no hay zona por la que preguntar.
    expect(repo.contarAdminSatelitesActivos).not.toHaveBeenCalled();
  });

  it("R16: un Admin satelite YA inactivo no avisa (no sostenia nada)", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(usuario({ estado: "inactivo" })) });
    const r = await servicio(repo).consultarImpactoCambio(
      "usr-1",
      { rolId: "rol-admin" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.impacto).toBeNull();
  });

  it("R15: ACTIVAR a un Admin satelite ya activo no avisa (no cambia nada)", async () => {
    const r = await servicio(repo).consultarImpactoCambio("usr-1", { estado: "activo" }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.impacto).toBeNull();
  });

  it("R15: re-enviar el MISMO rol y la MISMA zona no avisa", async () => {
    const r = await servicio(repo).consultarImpactoCambio(
      "usr-1",
      { rolId: "rol-sat", zonaId: "z1" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.impacto).toBeNull();
  });

  it("un cambio que la escritura RECHAZARIA (Admin satelite sin zona) no avisa de algo que no va a pasar", async () => {
    // `zonaId: null` sobre un adminSatelite es `validation_error` en `actualizar` (R3): el cambio
    // no llega a ocurrir, asi que avisar de sus consecuencias seria avisar de nada.
    const r = await servicio(repo).consultarImpactoCambio("usr-1", { zonaId: null }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.impacto).toBeNull();
  });
});

describe("379 · consultarImpactoCambio — permiso, forma y cableado (R17/R22)", () => {
  it("R22: un actor que no es maestro recibe `forbidden` SIN haber tocado ningun repositorio", async () => {
    const cierres = buildCierresRepo();
    const r = await servicio(repo, cierres).consultarImpactoCambio(
      "usr-1",
      { estado: "inactivo" },
      { usuarioId: "x", rol: "admin" },
    );

    expect(r.status).toBe("forbidden");
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.listRoles).not.toHaveBeenCalled();
    expect(repo.contarAdminSatelitesActivos).not.toHaveBeenCalled();
    expect(cierres.resumirConsolidablesPendientes).not.toHaveBeenCalled();
  });

  it("R22: el impacto no lleva NINGUN dato personal", async () => {
    const r = await servicio(repo).consultarImpactoCambio(
      "usr-1",
      { estado: "inactivo" },
      MAESTRO,
    );
    if (r.status !== "ok" || r.impacto === null) throw new Error("se esperaba impacto");
    // Q2: se dice CUANTOS quedan, no QUIENES. Las cuatro claves del contrato y ninguna mas.
    expect(Object.keys(r.impacto).sort()).toEqual([
      "adminSatelitesActivosRestantes",
      "cierresSinConsolidar",
      "totalSinConsolidar",
      "zonaNombre",
    ]);
    const serializado = JSON.stringify(r.impacto);
    for (const dato of ["ana@example.com", "099", "1710034065", "Ana"]) {
      expect(serializado, `el impacto filtro «${dato}»`).not.toContain(dato);
    }
  });

  it("R17: el excluido del recuento es EL usuario evaluado", async () => {
    await servicio(repo).consultarImpactoCambio("usr-1", { estado: "inactivo" }, MAESTRO);
    expect(repo.contarAdminSatelitesActivos).toHaveBeenCalledWith("z1", "usr-1");
  });

  it("un usuario inexistente devuelve `not_found`", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    const r = await servicio(repo).consultarImpactoCambio("nadie", { estado: "inactivo" }, MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("⭑ sin el repositorio de cierres LANZA, y no devuelve ceros", async () => {
    // ⚠️ El parametro es OPCIONAL en el constructor —tiene que serlo, hay decenas de
    // `new UsuarioService(repo)` en los tests—, asi que olvidarlo en el composition root NO rompe
    // el typecheck. Devolver «no hay dinero» cuando lo que pasa es que no se puede leer es el
    // fallo mudo que esta ficha combate: en este repo un colaborador opcional ignorado en
    // silencio ya dejo dos notificadores muertos con la suite entera en verde.
    const svc = new UsuarioService(repo, buildZonaRepo());
    await expect(
      svc.consultarImpactoCambio("usr-1", { estado: "inactivo" }, MAESTRO),
    ).rejects.toThrow(/repositorio de cierres/i);
  });
});
