import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type {
  ActualizarPlantillaServiceResult,
  CrearPlantillaServiceResult,
  IGastoFijoPlantillaService,
  ListarPlantillasCompletoServiceResult,
  ListarPlantillasPaginadoServiceResult,
  ListarPlantillasServiceResult,
  SetActivaPlantillaServiceResult,
} from "@/lib/interfaces/services/IGastoFijoPlantillaService";
import type {
  ActualizarGastoFijoPlantillaInput,
  CrearGastoFijoPlantillaInput,
  SetActivaPlantillaInput,
} from "@/lib/types/gasto-fijo-plantilla";
import { descargaConfig } from "@/lib/config/descarga";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { rangoDePagina } from "@/lib/utils/rango-pagina";

// Roles autorizados (R17): acceso total (maestro/admin, dueños de la caja central), espejo de
// WalletService.

/**
 * Feature 45 — logica de negocio de las PLANTILLAS de gasto fijo (CRUD del maestro). No conoce
 * HTTP ni Prisma directamente: recibe el repo por inyeccion. Guardia de rol maestro (R17) en
 * TODOS los metodos. Sin borrado (R25): la desactivacion (setActivaPlantilla) detiene la
 * generacion del cron preservando el historial. Money-safe: DTOs con montos STRING.
 */
export class GastoFijoPlantillaService implements IGastoFijoPlantillaService {
  constructor(private readonly repo: IGastoFijoPlantillaRepository) {}

  async crearPlantilla(
    input: CrearGastoFijoPlantillaInput,
    actor: Actor,
  ): Promise<CrearPlantillaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17
    // Feature 84: la periodicidad llega SIEMPRE resuelta desde el borde (el schema zod aplica los
    // defaults meses/1/hoy-CR cuando la UI actual no la manda), asi que aca no hay fallback.
    const plantilla = await this.repo.crear({
      concepto: input.concepto,
      monto: input.monto,
      periodicidadUnidad: input.periodicidadUnidad,
      periodicidadCantidad: input.periodicidadCantidad,
      fechaCobro: input.fechaCobro,
    }); // R24
    return { status: "ok", plantilla };
  }

  async actualizarPlantilla(
    input: ActualizarGastoFijoPlantillaInput,
    actor: Actor,
  ): Promise<ActualizarPlantillaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17
    const existente = await this.repo.obtenerPorId(input.id);
    if (existente === null) return { status: "not_found" };
    const plantilla = await this.repo.actualizar(input.id, {
      concepto: input.concepto,
      monto: input.monto,
      periodicidadUnidad: input.periodicidadUnidad,
      periodicidadCantidad: input.periodicidadCantidad,
      fechaCobro: input.fechaCobro,
    }); // R25 (feature 84: tambien mueve el ciclo/ancla)
    return { status: "ok", plantilla };
  }

  async setActivaPlantilla(
    input: SetActivaPlantillaInput,
    actor: Actor,
  ): Promise<SetActivaPlantillaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17
    const existente = await this.repo.obtenerPorId(input.id);
    if (existente === null) return { status: "not_found" };
    const plantilla = await this.repo.setActiva(input.id, input.activa); // R25 (sin borrado)
    return { status: "ok", plantilla };
  }

  async listarPlantillas(actor: Actor): Promise<ListarPlantillasServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17
    const plantillas = await this.repo.listar(); // R26 (activas e inactivas)
    return { status: "ok", plantillas };
  }

  /**
   * Feature 184 — Tanda G (R1/R4/R6) — el CONJUNTO de las plantillas, sin recorte, para el
   * archivo (listado 11 del Anexo A).
   *
   * **Lo que esta migracion cuesta en base: NADA.** Es literalmente el mismo `repo.listar()`
   * que la pantalla ya releia —un `findMany` sin `where` sobre una tabla de configuracion con
   * un punado de filas—, asi que aqui no hay ahorro que presumir, y decir lo contrario seria
   * falso. Lo que si cambia, y es todo lo que esta tanda promete para este listado:
   *
   *  1. **el tope se evalua AQUI** (R6). Hoy lo evalua el navegador, despues de que el conjunto
   *     entero cruzo la frontera; por encima del tope, lo que cruza pasa a ser dos enteros.
   *  2. **el archivo deja de depender de un listado ajeno**: `listarPlantillas` es la lectura
   *     de la TABLA, y su forma (`{ plantillas }`) obligaba a la pantalla a destriparla para
   *     construir el archivo. Aqui sale ya en el contrato comun de descarga (R1).
   *
   * Sin `input`, y es decision, no olvido: este listado no admite filtros —el schema de su
   * pagina solo llevaba `page`/`pageSize`— asi que la lista blanca derivada no deja NINGUNA
   * clave. El borde la sigue aplicando entera: parsear ES la barrera (R17).
   *
   * **Excepcion declarada a R29 de la 170, y la unica de las once con riesgo despreciable.**
   * `repo.listar()` es un `findMany` sin `where` y sin `take`, asi que el conjunto se materializa
   * entero antes de que el tope lo mire: de R29 —feature `done`, requisito vivo— se cumple el
   * transporte y no la materializacion, igual que en los otros diez. La diferencia es QUE
   * conjunto es: las plantillas de gasto fijo son una tabla de CONFIGURACION que un humano da de
   * alta a mano y que no se borra (R25), asi que su tamaño lo marca el catalogo de gastos de la
   * operacion —decenas— y no el paso de los dias. Llegar al tope aqui significaria que alguien la
   * esta usando como bitacora, y el problema seria ese.
   *
   * Se declara igual que las diez restantes para que la excepcion se lea en los once sitios y no
   * en diez: el motivo por el que no se cierra es comun —`limite + 1` obliga a un `count` aparte
   * para conservar el total del aviso (R6), la segunda consulta que R15 de esta feature prohibe—
   * pero el riesgo que se acepta es de cada listado. Decision humana del 2026-08-05 (design §3.1).
   */
  async listarPlantillasCompleto(actor: Actor): Promise<ListarPlantillasCompletoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R4: antes del repositorio

    // El MISMO metodo del que la pagina saca su recorte: mismo (nulo) `where`, mismo orden y
    // el MISMO mapper de dinero. Un gemelo `listarCompleto` seria la segunda declaracion del
    // criterio que R16 prohibe.
    const conjunto = await this.repo.listar(); // R26: activas e INACTIVAS, igual que la tabla

    const limite = descargaConfig.MAX_FILAS;
    // R6: o van TODAS las filas del conjunto, o van solo los conteos. Nunca un archivo truncado.
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite };
    }

    return { status: "ok", items: conjunto, total: conjunto.length };
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54) — las plantillas, paginadas en servidor.
   *
   * El guard de rol va PRIMERO, antes de tocar el repositorio: es el MISMO `esAccesoTotal`
   * (R17) que el listado sin paginar, asi que el conjunto visible es exactamente el mismo
   * (R44). UNA sola llamada al repositorio (R54): el conteo viaja dentro de ella.
   */
  async listarPlantillasPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarPlantillasPaginadoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17

    const { items, total } = await this.repo.listarPaginado(rangoDePagina(input));

    return {
      status: "ok",
      items,
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO, nunca `items.length`
    };
  }
}
