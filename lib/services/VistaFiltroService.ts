import type {
  IVistaFiltroRepository,
  VistaFiltroFila,
} from "@/lib/interfaces/repositories/IVistaFiltroRepository";
import type {
  ActualizarVistaFiltroInput,
  GuardarVistaFiltroInput,
  IVistaFiltroService,
  RenombrarVistaFiltroInput,
} from "@/lib/interfaces/services/IVistaFiltroService";
import {
  MAX_VISTAS_POR_SUPERFICIE,
  MSG_VISTA,
  NOMBRE_VISTA_MAX,
  VISTA_FILTRO_VERSION,
  leerPayloadGuardado,
  payloadVacio,
  superficieVistaSchema,
  type EliminarVistaFiltroResult,
  type ListarVistasFiltroResult,
  type SuperficieVista,
  type VistaFiltroDTO,
  type VistaFiltroPayload,
  type VistaFiltroResult,
} from "@/lib/types/vista-filtro";

// FICHA 453 (design §6, T2.1) — LAS REGLAS DE LAS VISTAS. Sin HTTP, sin cookies, sin Prisma: el
// repositorio entra por constructor y el dueño entra como primer parametro, resuelto de la sesion.
//
// ⚠️ NO EXISTE NINGUN METODO «APLICAR» (R16). Aplicar una vista no escribe nada, y la forma barata
// de garantizarlo es que no haya con que escribir: la unica manera de que un catalogo caido
// destruya una vista seria que aplicar pudiera tocar la base, y no puede.

/** Lo que devuelve una comprobacion de nombre: el nombre ya recortado, o el error que lo rechaza. */
type NombreRevisado = { ok: true; nombre: string } | { ok: false; error: VistaFiltroResult };

function errorDeCampo(campo: string, mensaje: string): VistaFiltroResult {
  return { status: "validation_error", fieldErrors: { [campo]: [mensaje] } };
}

/**
 * R9/R10 — el nombre, recortado por los extremos.
 *
 * Los dos mensajes DICEN el numero: «demasiado largo» sin el maximo obliga a probar a ciegas.
 */
function revisarNombre(bruto: string): NombreRevisado {
  const nombre = bruto.trim();
  if (nombre === "") return { ok: false, error: errorDeCampo("nombre", MSG_VISTA.nombreVacio) };
  if (nombre.length > NOMBRE_VISTA_MAX) {
    return { ok: false, error: errorDeCampo("nombre", MSG_VISTA.nombreLargo) };
  }
  return { ok: true, nombre };
}

/** R12 — «no hay nada que guardar», y se dice en vez de guardar una vista que no filtra nada. */
function revisarFiltro(filtro: VistaFiltroPayload): VistaFiltroResult | null {
  return payloadVacio(filtro) ? errorDeCampo("filtro", MSG_VISTA.filtroVacio) : null;
}

export class VistaFiltroService implements IVistaFiltroService {
  constructor(private readonly repo: IVistaFiltroRepository) {}

  async listar(usuarioId: string, superficie: SuperficieVista): Promise<ListarVistasFiltroResult> {
    const filas = await this.repo.listar(usuarioId, superficie);
    return { status: "ok", vistas: filas.map((fila) => this.aDTO(fila, superficie)) };
  }

  /**
   * R9–R13 — el orden de las comprobaciones importa y es el barato-primero: nombre, contenido,
   * tope, y solo entonces la escritura. Contar antes de insertar evita pedirle a la base que
   * rechace lo que ya sabiamos.
   */
  async guardar(usuarioId: string, input: GuardarVistaFiltroInput): Promise<VistaFiltroResult> {
    const nombre = revisarNombre(input.nombre);
    if (!nombre.ok) return nombre.error;
    const filtroInvalido = revisarFiltro(input.filtro);
    if (filtroInvalido) return filtroInvalido;

    // R13 — el tope, CON SU NUMERO y con el que ya tiene. Lo impone el servicio y no la base
    // (design §3.4): `count` + rechazo no es atomico y dos pestañas a la vez pueden dejar 21. Se
    // acepta a sabiendas —el daño es una vista de mas en una lista, y la siguiente ya se rechaza—
    // porque hacerlo estructural pedia un trigger o una columna `posicion` con su unico.
    const actuales = await this.repo.contar(usuarioId, input.superficie);
    if (actuales >= MAX_VISTAS_POR_SUPERFICIE) {
      return { status: "limite_excedido", maximo: MAX_VISTAS_POR_SUPERFICIE, actuales };
    }

    const creada = await this.repo.crear(
      usuarioId,
      input.superficie,
      nombre.nombre,
      input.filtro,
      VISTA_FILTRO_VERSION,
    );
    // R11 — el duplicado NO sobrescribe: se rechaza. Quien lo detecta es el indice unico, asi que
    // dos pestañas guardando el mismo nombre a la vez tampoco dejan dos filas.
    if (creada.estado === "nombre_en_uso") return { status: "conflict" };
    return { status: "ok", vista: this.aDTO(creada.fila, input.superficie) };
  }

  /** R14 — renombrar, con las MISMAS reglas de nombre que guardar. */
  async renombrar(usuarioId: string, input: RenombrarVistaFiltroInput): Promise<VistaFiltroResult> {
    const nombre = revisarNombre(input.nombre);
    if (!nombre.ok) return nombre.error;

    const escrita = await this.repo.renombrar(input.id, usuarioId, nombre.nombre);
    return this.deEscritura(escrita);
  }

  /**
   * R15 — reemplaza el filtro guardado y CONSERVA el nombre; R12 se aplica igual que al guardar.
   *
   * Es ademas la unica salida de una vista marcada incompleta (R28): actualizarla con lo que hay en
   * pantalla. Por eso no se comprueba aqui si el filtro nuevo es «mejor» que el viejo: lo decide la
   * persona, no el servidor.
   */
  async actualizar(
    usuarioId: string,
    input: ActualizarVistaFiltroInput,
  ): Promise<VistaFiltroResult> {
    const filtroInvalido = revisarFiltro(input.filtro);
    if (filtroInvalido) return filtroInvalido;

    const escrita = await this.repo.actualizarFiltro(
      input.id,
      usuarioId,
      input.filtro,
      VISTA_FILTRO_VERSION,
    );
    return this.deEscritura(escrita);
  }

  /**
   * Borra la vista de ESTA persona. Una ajena responde `not_found` y no `forbidden`: `forbidden`
   * confirmaria que ese id existe y es de otra persona, que sobre un recurso estrictamente personal
   * es una filtracion gratuita. «No lo tienes» es ademas la respuesta verdadera para quien pregunta.
   */
  async eliminar(usuarioId: string, id: string): Promise<EliminarVistaFiltroResult> {
    const borradas = await this.repo.eliminar(id, usuarioId);
    return borradas === 0 ? { status: "not_found" } : { status: "ok" };
  }

  /** Traduce el resultado de una escritura del repositorio al contrato de la accion. */
  private deEscritura(
    escrita: Awaited<ReturnType<IVistaFiltroRepository["renombrar"]>>,
  ): VistaFiltroResult {
    if (escrita.estado === "sin_coincidencia") return { status: "not_found" };
    if (escrita.estado === "nombre_en_uso") return { status: "conflict" };
    const superficie = superficieVistaSchema.safeParse(escrita.fila.superficie);
    // Una fila de una superficie que la aplicacion YA NO declara no se puede devolver como si nada:
    // el contrato promete una superficie declarada. Se responde `not_found` —no se puede operar
    // sobre una pantalla que no existe— en vez de inventar una superficie o ensanchar el tipo.
    if (!superficie.success) return { status: "not_found" };
    return { status: "ok", vista: this.aDTO(escrita.fila, superficie.data) };
  }

  /**
   * R8 — LA LECTURA DEFENSIVA. El documento se valida al leer, no solo al escribir: uno que no
   * parsea —o que declara una version que este codigo no conoce— sale con `filtro: null`, y con eso
   * la interfaz lo marca ilegible, no lo aplica ni a medias y sigue dejando renombrar y borrar.
   *
   * Que la fila entre por aqui SIEMPRE es lo que hace que no haya ningun camino por el que un
   * documento sin validar llegue a la pantalla.
   */
  private aDTO(fila: VistaFiltroFila, superficie: SuperficieVista): VistaFiltroDTO {
    return {
      id: fila.id,
      nombre: fila.nombre,
      superficie,
      filtro: leerPayloadGuardado(fila.filtro),
      actualizadaEn: fila.actualizadaEn.toISOString(),
    };
  }
}
