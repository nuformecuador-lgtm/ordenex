import type { ImpactoZonaCentralDTO, ZonaDTO } from "@/lib/types/zona";

/**
 * ⭑ FICHA 429 — la fila de una bodega tal como la necesita la superficie del SINPE. NO es
 * `ZonaDTO`: aquel arrastra el conteo de distritos y las tarifas del mensajero, que aqui no pinta
 * nadie y que el `adminSatelite` no tiene por que ver.
 *
 * `sinpeRevisadoAt` viaja como `Date | null` —crudo— porque quien lo serializa a ISO es el
 * SERVICIO, en la frontera del DTO. Un repositorio que devolviera la cadena ya formateada estaria
 * decidiendo presentacion.
 */
export interface SinpeZonaRow {
  id: string;
  nombre: string;
  esCentral: boolean;
  sinpeNumero: string;
  sinpeNombre: string;
  sinpeRevisadoAt: Date | null;
}
import type { OpcionCatalogo } from "@/lib/types/filtros-ordenes";

// Datos listos para persistir una fila de tarifa_zona_mensajero (numbers; el repo
// convierte a Prisma.Decimal). vehiculoId ya normalizado a string | null.
export interface TarifaZonaMensajeroData {
  cobroEntregado: number;
  cobroRechazado: number;
  vehiculoId: string | null;
}

// Crear/actualizar comparten forma: reemplazo completo de datos + N:M + tarifas.
export interface CreateZonaData {
  nombre: string;
  cobroVehiculo: boolean;
  esCentral: boolean; // feature 54: flag de zona central (antes esGam)
  distritoIds: string[];
  tarifas: TarifaZonaMensajeroData[];
  /**
   * ⭑ FICHA 429 (R11) — OBLIGATORIOS AL CREAR, sin `?` y sin default. Una bodega nueva no puede
   * nacer sin el numero al que sus clientes van a transferir: eso es la segunda capa de D3. El
   * repositorio los escribe JUNTO CON `sinpe_revisado_at = now()` (R12), porque un SINPE tecleado
   * por una persona en el acto de crear la bodega ya esta revisado — volver a pedirselo seria
   * ruido.
   *
   * ⚠️ NO ESTAN EN `UpdateZonaData`, y es deliberado: el SINPE se edita por SU PROPIA accion, con
   * su propio modelo de permisos. Si viajaran en el reemplazo completo de `actualizarZona`, un
   * guardado de distritos hecho por el `maestro` pisaria en silencio la correccion que un
   * `adminSatelite` acaba de hacer sobre su bodega.
   */
  sinpeNumero: string;
  sinpeNombre: string;
}

/**
 * ⭑ FICHA 376 (R1) — LA UNICA DIFERENCIA ENTRE CREAR Y ACTUALIZAR.
 *
 * `esCentral` OPCIONAL, y ese `undefined` no es cosmetico: viaja intacto hasta el `data` de un
 * `update` de Prisma, que trata «campo no provisto» como «no toques la columna». Es lo que hace
 * que un payload sin la marca deje la marca como estaba en vez de apagarla.
 *
 * ⚠️ `null` NO valdria: Prisma intentaria escribir NULL en una columna NOT NULL. Y un doble de
 * Prisma NO distingue las dos cosas, por eso R1 se mide contra Postgres real
 * (`tests/integration/db/zona-central-guarda-y-rastro.test.ts`).
 */
export type UpdateZonaData = Omit<
  CreateZonaData,
  "esCentral" | "sinpeNumero" | "sinpeNombre"
> & { esCentral?: boolean };

export interface ListZonasParams {
  skip: number;
  take: number;
  includeTarifas: boolean;
}

export interface ListZonasResult {
  items: ZonaDTO[];
  total: number;
}

/**
 * Resultado del borrado fisico.
 *
 * `referenced` = la zona esta referenciada por orden/usuario/tarifa liquidada (FK RESTRICT).
 *
 * ⭑ FICHA 376 (R10/R11) — `es_central` = la zona TIENE la marca de zona central. Es un desenlace
 * PROPIO y no un cuarto significado de `referenced`, porque la salida es distinta: borrar las
 * ordenes no desbloquea nada, hay que marcar otra zona como central. Y es el unico rechazo que
 * las FK no cubren: una zona central sin ninguna orden ni ningun usuario apuntando se borraba sin
 * mas hasta esta ficha.
 */
export type DeleteZonaResult = "ok" | "not_found" | "referenced" | "es_central";

/**
 * FICHA 366 (design §5.1) + FICHA 376 (design §6.1) — el desenlace de un guardado de zona.
 *
 * `ordenesReconciliadas` (366/R12) es cuantas ordenes CAMBIARON de zona por la re-derivacion de
 * ESTE guardado: las alcanzadas, no las candidatas. Cero es un valor normal y esperado (366/R14:
 * repetir el mismo guardado no reconcilia nada la segunda vez).
 *
 * ⭑ 376: `null` DEJA DE SER EL «no existe». Los tres desenlaces son explicitos y estan nombrados,
 * porque ahora hay DOS formas de no guardar y confundirlas seria devolver `not_found` cuando lo
 * que pasa es que se pidio quitarle la marca a la unica zona central.
 *
 * ⭑ FICHA 377 (design §5.1) — `ordenesRetenidasEnBodegaSatelite` (R8) es cuantas HABRIAN cambiado
 * de zona pero se quedan como estaban porque su paquete ya esta en el estante de una bodega
 * satelite. Cero es lo normal.
 *
 * ⚠️ NO es un subconjunto de `ordenesReconciliadas`: los dos conjuntos son DISJUNTOS por
 * construccion —salen del MISMO `where` base con clausulas de estado complementarias (`notIn` /
 * `in` sobre `ESTADOS_PAQUETE_EN_ESTANTE`)—, asi que sumarlos da «las que este guardado habria
 * movido de no existir la 377» y nunca cuenta una orden dos veces.
 */
export type UpdateZonaResult =
  | {
      estado: "ok";
      zona: ZonaDTO;
      ordenesReconciliadas: number;
      ordenesRetenidasEnBodegaSatelite: number;
    }
  | { estado: "not_found" }
  /** 376/R5: se pidio EXPLICITAMENTE quitar la marca a la zona que hoy es la central. */
  | { estado: "sin_zona_central" };

export interface IZonaRepository {
  /**
   * Crea la zona + su N:M de distritos + sus tarifas, en una transaccion.
   *
   * FICHA 376 (R12): `actorUsuarioId` congela QUIEN creo la zona, porque crear una zona CON la
   * marca le quita la marca a la central anterior exactamente igual que actualizar, y ese
   * traslado deja rastro. Mismo patron que `hardDelete` (362) y `update` (366); `null` = el
   * sistema.
   */
  create(data: CreateZonaData, actorUsuarioId: string | null): Promise<ZonaDTO>;
  /** null si no existe. Carga tarifas solo si includeTarifas. */
  findById(id: string, includeTarifas: boolean): Promise<ZonaDTO | null>;
  /** Listado paginado (orden por nombre asc). include tarifas opcional. */
  list(params: ListZonasParams): Promise<ListZonasResult>;
  /**
   * Feature 144/B2 (R48/R49): TODAS las zonas proyectadas a `{id, nombre}`, por nombre
   * asc. Metodo propio y no `list()`: aquel pagina y arrastra tarifas + conteo de
   * distritos, y `ZonaService.listar` ademas es `maestro`-only. El catalogo de filtros
   * lo consumen tambien `admin` y `adminTienda`, y no necesita nada de eso.
   */
  listLite(): Promise<OpcionCatalogo[]>;
  /**
   * Reemplaza datos + N:M + tarifas. El desenlace viaja NOMBRADO (ficha 376): `not_found` si la
   * zona no existe, `sin_zona_central` si el guardado pedia quitarle la marca a la unica central.
   *
   * FICHA 366 (R1-R9): en la MISMA transaccion re-deriva la zona de las ordenes ELEGIBLES cuyo
   * distrito quedo apuntando a otra zona. `actorUsuarioId` congela QUIEN disparo la
   * reconciliacion (mismo patron que `hardDelete`, ficha 362); `null` = el sistema.
   *
   * FICHA 376 (R5/R12): rechaza el guardado COMPLETO antes de la primera escritura si dejaria al
   * sistema sin zona central, y registra una fila por CADA zona cuya marca cambie.
   *
   * FICHA 377 (R2/R8): la orden cuyo paquete ya esta en el estante de una satelite queda FUERA de
   * esa re-derivacion —moverle la zona la dejaria sin bodega que pueda asignarla y sin transicion
   * de salida— y se informa aparte, en `ordenesRetenidasEnBodegaSatelite`.
   */
  update(
    id: string,
    data: UpdateZonaData,
    actorUsuarioId: string | null,
  ): Promise<UpdateZonaResult>;
  /** Borrado FISICO (cascade de zona_distrito y tarifas). */
  /** FICHA 362 (R4/R9): `actorUsuarioId` congela QUIEN borro; la etiqueta se lee ANTES del DELETE. */
  hardDelete(id: string, actorUsuarioId: string | null): Promise<DeleteZonaResult>;
  /** Cuenta cuantos de `ids` existen como distrito (validacion de existencia). */
  countExistingDistritos(ids: string[]): Promise<number>;
  /** Cuenta cuantos de `ids` existen como vehiculo (validacion de existencia). */
  countExistingVehiculos(ids: string[]): Promise<number>;
  /**
   * feature 54: id de la zona con `esCentral = true`, o null si ninguna la tiene.
   * (antes findGamZonaId). El indice unico parcial garantiza a lo sumo una.
   */
  findCentralZonaId(): Promise<string | null>;
  /**
   * FICHA 376 (Q4): cuantas ordenes VIVAS tiene cada una de `zonaIds`. Solo lectura; una consulta
   * agrupada, no una por zona. Un id sin ordenes vivas aparece igual, con cero: la pantalla tiene
   * que poder decir «no afecta a ninguna» y eso no es lo mismo que «no lo sé».
   */
  contarOrdenesVivasPorZona(zonaIds: string[]): Promise<ImpactoZonaCentralDTO[]>;

  /* ─── FICHA 429 · el SINPE por bodega ────────────────────────────────────────────────────── */

  /** TODAS las bodegas con su SINPE y su marca de revision, por nombre asc. Solo lectura. */
  listarSinpe(): Promise<SinpeZonaRow[]>;
  /** Una bodega. `null` si no existe. */
  findSinpeByZona(zonaId: string): Promise<SinpeZonaRow | null>;
  /**
   * ⭑ R20 — LA ZONA QUE LA BASE LE ASIGNA A ESA PERSONA, leida por `usuarioId`.
   *
   * Existe para que el permiso del `adminSatelite` NO se decida con un dato que venga en la
   * peticion. `usuario.zona_id` es nullable: `null` = esa persona no tiene bodega (estado
   * representable, y entonces no puede editar ninguna).
   */
  zonaIdDeUsuario(usuarioId: string): Promise<string | null>;
  /**
   * ⭑ R21/R24 — GUARDA EL PAR Y DEJA RASTRO, EN LA MISMA TRANSACCION.
   *
   * Marca la bodega como revisada SIEMPRE (quien guarda, mira), y escribe UNA fila de
   * `zona_sinpe_cambiado` SOLO si alguno de los dos valores queda distinto (R25). `null` = la zona
   * no existe.
   */
  guardarSinpe(
    zonaId: string,
    data: { numero: string; nombre: string },
    actorUsuarioId: string | null,
  ): Promise<SinpeZonaRow | null>;
  /**
   * ⭑ R25 — «ESTA BIEN»: marca la bodega como revisada y NO escribe ninguna fila de historial.
   *
   * NO ACEPTA VALORES, y eso es el punto: una confirmacion no puede cambiar nada por accidente.
   * `null` = la zona no existe.
   */
  confirmarSinpe(zonaId: string): Promise<SinpeZonaRow | null>;
}
