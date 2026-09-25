# Feature 462 — Diseño técnico

> Requisitos en `requirements.md`. Líneas citadas: archivo real de `dev` el 2026-09-25 (el índice del
> grafo da símbolos rancios; todo lo nombrado aquí se confirmó en el archivo). Zona `fullstack`: se
> implementa **backend → frontend**. Sale en la release completa con SF-001, 454-456 y 459-461.

---

## 0. Decisiones, en una tabla

| # | Pregunta | Decisión | Por qué, en una línea |
|---|---|---|---|
| **DA** | ¿Dónde vive el conteo? | Un servicio nuevo, `ReprogramadasRetenidasService`, punto único que compone dos fuentes (Forma A y Forma B) y agrupa por cierre y ámbito. Las cuatro superficies lo consumen. | R7: una sola definición o las cuatro cifras divergen sin que nada se ponga rojo. |
| **DB** | Forma A: ¿SQL nuevo o reuso? | **Reuso literal** de `ILiberacionReprogramadaRepository.findOrdenesLiberables(hoyCR)` + `puedeLiberarse` (276). Cero predicado nuevo. | Es el `esperandoCierre` del reloj (status_note); y la guardia 371 prohíbe una segunda correlación de «la gestión reprogramada vigente» en `lib/**`. |
| **DC** | Forma B: ¿dónde está el predicado? | `$queryRaw` que **compone** `sqlUltimaGestionPendienteLateral` de `gestion-pendiente.ts`, ampliado con tres columnas más. | La guardia 454 prohíbe leer `gestion_registrada` en un `where` fuera de ese módulo; la proyección ampliada es aditiva. |
| **DD** | ¿Cuándo se emite el aviso? | A las **07:00 CR**, como tercer agregado de `AvisosDiariosService` (cron `avisos-diarios`, ya en `vercel.json` como `0 13 * * *`). | Push a primera hora (no a medianoche) y sin carrera con el corte. S3/S4 son vivas desde la madrugada. |
| **DE** | Entidad de dedupe | `entidad_tipo = reprogramadas_esperan_cierre_dia`, `entidad_id = ${ambito}:${diaCR}`, `ambito ∈ {"central"} ∪ {zonaId}`. | Patrón 409 §4.2: el alcance NO entra en `notificacion_dedupe_key`; sin el ámbito dentro, la primera zona silencia a las demás. `"central"` y no `"global"` porque maestro/admin NO cuentan el total del sistema (R6). |
| **DF** | Cifra viva | `VigenciaAvisoAgregadoService.cifra("reprogramadas_esperan_cierre", actor)` con mapa de ámbito por rol (`maestro/admin → central`, `adminSatelite → zona`), lanza si falta ámbito (417/418). | Un `0` de cortesía apaga un aviso vivo sin que nadie lo lea. |
| **DG** | Push | `PUSH_ELEGIBLE.reprogramadas_esperan_cierre = { push: "si", roles: ["admin", "adminSatelite"] }`. | Precedente aprobado de los avisos de cierres; el cupo (usuario, evento, jornada) y el filtro leído/descartado ya son del canal (410). |
| **DH** | Marca por cierre | `CierreAdminResumen` gana `reprogramadasRetenidasHoy?: number` (aditivo); lo rellena `CierresAdminService` con **una** llamada por página (patrón `pendientePagoMensajero`, 172/R54). | Ni una consulta por fila; el DTO ya viaja a la lista y al detalle. |
| **DI** | Franja de `/ordenes` | Server Action de lectura nueva + componente propio en `app/(app)/ordenes/_components/`, montado en `page.tsx` solo para acceso total. | Bloque independiente (R39), datos por props desde el Server Component que ya validó el rol. |
| **DJ** | Migración | Una sola, aditiva: dos `ALTER TYPE ... ADD VALUE IF NOT EXISTS`. `down.sql` recrea los dos enums con la lista de `origin/dev` al abrir el PR. | Igual que la 409 §6.1; sin tablas, sin RLS nueva. |

---

## 1. El predicado, y de dónde sale cada mitad

### 1.1 Forma A — orden en `reprogramado` (reuso 276)

```
A := { r ∈ findOrdenesLiberables(hoyCR) : !puedeLiberarse(r) }
```

- `findOrdenesLiberables` ya devuelve solo órdenes vivas en `reprogramado` cuya gestión reprogramada
  vigente (`GESTION_REPROGRAMADA_VIGENTE`) tiene `fecha_reprogramacion <= hoyCR`
  (`LiberacionReprogramadaRepository.ts:106-197`), con los tres hechos `gestionCierreId`,
  `gestionCierreEstado`, `gestionEsVisitaReal`.
- `puedeLiberarse(r)` (`LiberacionReprogramadaService.ts:53-56`) es `false` exactamente cuando la
  gestión nace de visita real y su cierre no está `aprobado`. Negarla es R3 por construcción.
- **Cambio aditivo**: `OrdenLiberableRow` gana `mensajeroAsignadoId: string | null` (select de
  `orden.mensajero_asignado_id` en `buscarLiberables`). Hace falta para el grupo «sin cierre enviado»
  (R5). No cambia ni el `where`, ni el `orderBy`, ni el `take`. Los fixtures que construyen la fila sin
  el campo siguen compilando si se declara opcional; se recomienda **requerido** y actualizar los
  fixtures (son pocos) para que el servicio no tenga que tratar un `undefined`.

### 1.2 Forma B — orden en `en_reparto` con gestión pendiente `reprogramado` (454)

```sql
SELECT o."id" AS orden_id, o."zona_id", o."mensajero_asignado_id",
       gp."gestion_id", gp."cierre_id"
  FROM "orden" o
  JOIN "order_status" s ON s."id" = o."estatus_id" AND s."value" = 'en_reparto'
  LEFT JOIN LATERAL ( <sqlUltimaGestionPendienteLateral({ id: o."id", estatusId: o."estatus_id" })> ) gp ON TRUE
 WHERE o."deleted_at" IS NULL
   AND gp."resultado" = 'reprogramado'
   AND gp."fecha_reprogramacion" <= ${hoyCR}::date
```

- `sqlUltimaGestionPendienteLateral` (`gestion-pendiente.ts:151-167`) ya elige **la gestión pendiente
  más reciente** de la orden (`ORDER BY created_at DESC, id DESC LIMIT 1`) con las condiciones 1-3 del
  predicado único. Es la «gestión de calle vigente más reciente» que la 454 aplica al aprobar (R57 de
  la 454); si es `reprogramado` y su fecha ya llegó, la orden está retenida (R43 sale gratis: la
  correlación toma una sola fila por orden).
- **Cambio aditivo en `gestion-pendiente.ts`**: la LATERAL proyecta además `"gp"."id" AS "gestion_id"`,
  `"gp"."cierre_id"` y `"gp"."fecha_reprogramacion"`. Los consumidores actuales (`senalesGestionDe` en
  `ayuda-abierta.ts`) leen columnas por nombre (`resultado`, `registrada_at`); una columna más no los
  toca — se afirma en `tests/integration/db/454/gestion-pendiente-sql-real.test.ts` (sigue verde) y se
  añade un aserto de que las tres columnas nuevas llegan.
- El literal `gestion_registrada` **no aparece** en el repositorio nuevo: viaja dentro del fragmento
  importado. La guardia `gestion-pendiente-unica-fuente.guardia.test.ts` sigue verde.
- **Por qué `<= hoyCR` y no `= hoyCR`**: «de hoy» incluye las vencidas de días anteriores (mismo
  criterio que la liberación, R10/R11 de la 46). `fecha_reprogramacion` es `@db.Date`; `hoyCR` es
  `startOfDayCR(now)` (medianoche UTC de la fecha CR), la misma convención que el reloj y los timbres.
  Usar `inicioDelDiaCREnUtc` aquí sería el off-by-one de seis horas que la 413 documenta en
  `RepartoMananaRepository.ts:31-38`.

### 1.3 Disjuntas por construcción

A exige `estatus = reprogramado`; B exige `estatus = en_reparto`. Una orden no puede estar en las dos.
Tras la 454, la Forma A solo contiene población legada (gestiones registradas antes del despliegue) y
se extingue sola; se mide antes de la release (§9).

### 1.4 Atribución y ámbito

```
cierreQueRetiene(r) = r.cierreId            (null → grupo «sin cierre enviado» de r.mensajeroAsignadoId)
ambito(r) = cierre ? (cierre.destinoTipo === "bodega_central" ? central : zona(cierre.destinoZonaId))
                   : resolverDestinoCierre(r.zonaId, centralZonaId) → central | zona(r.zonaId)
```

- El destino del cierre está **persistido** (`cierre_dia.destino_tipo`, `destino_zona_id`); no se
  re-deriva. Es el mismo eje con el que `CierresAdminService.resolveAlcance` (`:404-419`) decide qué
  cierres ve cada actor: acceso total → `bodega_central` sin zona; `adminSatelite` → su zona.
- Para las «sin cierre» se usa `resolverDestinoCierre` (`lib/utils/bodega-responsable.ts`) sobre la
  zona de la **orden** (decisión 8 de requirements).

---

## 2. Capas nuevas y tocadas

```
app/api/cron/avisos-diarios/route.ts            Controller (existe): + composition root del 3.er agregado
lib/actions/notificaciones.ts                   Controller (existe): + inyecta el servicio de retenidas en la vigencia
lib/actions/cierres-admin.ts                    Controller (existe): + inyecta el servicio de retenidas
lib/actions/reprogramadas-retenidas.ts          Controller (NUEVO): lectura para la franja de /ordenes
  └─ lib/services/ReprogramadasRetenidasService.ts        (NUEVO) el punto único del conteo
       ├─ ILiberacionReprogramadaRepository.findOrdenesLiberables + puedeLiberarse   (reuso, Forma A)
       ├─ IReprogramadaRetenidaRepository.findRetenidasEnReparto                      (NUEVO, Forma B)
       ├─ IReprogramadaRetenidaRepository.findCierresQueRetienen                      (NUEVO, detalles de cierre)
       ├─ IReprogramadaRetenidaRepository.findMensajeros                              (NUEVO, nombres para «sin cierre»)
       └─ IZonaRepository.findCentralZonaId                                           (reuso)
lib/services/AvisosDiariosService.ts            (existe) + emitirAvisosDeRetenidas
lib/services/VigenciaAvisoAgregadoService.ts    (existe) + rama del evento nuevo
lib/services/CierresAdminService.ts             (existe) + rellenarRetenidas(filas) en cola, histórico y detalle
```

### 2.1 `IReprogramadasRetenidasService` (`lib/interfaces/services/`)

```ts
export type AmbitoRetenidas = { tipo: "central" } | { tipo: "zona"; zonaId: string };

export interface CierreQueRetiene {
  cierreId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  estado: CierreEstado;              // solicitado | vencido | rechazado (nunca aprobado)
  jornadaCR: string | null;          // derivarJornada (271/R61); null = «cierre del día»
  ambito: AmbitoRetenidas;
  cuantas: number;
}
export interface MensajeroSinCierre {
  mensajeroId: string | null;        // null si la orden no tiene mensajero (dato imposible; se declara)
  mensajeroNombre: string | null;
  ambito: AmbitoRetenidas;
  cuantas: number;
}
export interface RetenidaRow {
  ordenId: string; zonaId: string; mensajeroAsignadoId: string | null;
  gestionId: string | null;          // null en la Forma A (la fila del reloj no lo trae)
  cierreId: string | null;
  forma: "reprogramado" | "en_reparto";
}
export interface ResumenRetenidas {
  diaCR: string;                     // fechaCalendarioCR(hoyCR)
  total: number;
  cierres: CierreQueRetiene[];       // orden: más retenidas primero, luego jornada asc
  sinCierre: MensajeroSinCierre[];
}

export interface IReprogramadasRetenidasService {
  /** El conjunto entero, agrupado. Base de las otras dos. Solo lectura. */
  resumen(hoyCR: Date): Promise<ResumenRetenidas>;
  /** Cifra viva acotada a un ámbito (campana). */
  contar(hoyCR: Date, ambito: AmbitoRetenidas): Promise<number>;
  /** Marca por cierre: `Map<cierreId, cuantas>` solo para los ids pedidos; los que no retienen no aparecen. */
  contarPorCierre(hoyCR: Date, cierreIds: readonly string[]): Promise<Map<string, number>>;
}

/** Helper PURO exportado: recorta un resumen a un ámbito (lo usan la franja y los tests). */
export function recortarPorAmbito(r: ResumenRetenidas, ambito: AmbitoRetenidas): ResumenRetenidas;
```

Coste por llamada a `resumen`: A = 1 `findMany` + 1 carga agrupada de relaciones (Prisma), B = 1
`$queryRaw`, cierres = 1 `findMany`, mensajeros sin cierre = 0 o 1 `findMany`, zona central = 1 (cacheable
por llamada). Cuatro o cinco consultas sobre decenas de filas; ninguna por fila (R51). `contar` y
`contarPorCierre` derivan de `resumen` en memoria (una llamada, mismas consultas). Declarado: para un
actor con el aviso vivo son ~5 consultas por sondeo de 60 s; la 409 aceptó 2. Si midiera de más, la
optimización es que `contar` no pida nombres de mensajero ni jornadas (una consulta menos), sin cambiar
el contrato.

> **Medido y aplicado (2026-09-25, review H2).** Prisma parte cada relación del `select` en una consulta
> aparte, así que `resumen` cuesta **10** (A 4 + B 1 + cierres 3 + mensajeros 1 + zona 1), no ~5. Se aplicó
> la optimización de arriba: `contar` va por un camino ligero que pide de cada cierre solo estado y destino
> (`IReprogramadaRetenidaRepository.findDestinoDeCierres`, sin relaciones) y comparte con `resumen` la
> función de atribución y ámbito (`ambitoDeRetenida`). **`contar`: 10 → 7** por sondeo (6 sin «sin cierre»);
> `resumen` y `contarPorCierre` siguen en 10 porque sí muestran nombres y jornadas. Contrato del servicio
> intacto; el test de R7 (`contar` = `recortarPorAmbito(resumen).total`) sigue midiendo la igualdad contra
> Postgres. Detalle en `progress/impl_462.md` §Cierre de hallazgos.

### 2.2 `IReprogramadaRetenidaRepository` (`lib/interfaces/repositories/`) y su implementación

```ts
export interface IReprogramadaRetenidaRepository {
  /** Forma B (§1.2). Solo Prisma/$queryRaw; sin decidir nada. */
  findRetenidasEnReparto(hoyCR: Date): Promise<RetenidaRow[]>;
  /** Estado, destino, mensajero (id y nombre) y las fechas CR de sus gestiones no anuladas + created_at, para derivarJornada. */
  findCierresQueRetienen(cierreIds: readonly string[]): Promise<CierreParaRetenidas[]>;
  /** Nombres de mensajeros por id (grupo «sin cierre»). */
  findMensajeros(ids: readonly string[]): Promise<Array<{ id: string; nombre: string }>>;
}
```

`lib/repositories/ReprogramadaRetenidaRepository.ts`: **solo lecturas**. Una guardia nueva (§8) afirma
que ni el repositorio ni el servicio contienen `update`, `create`, `delete`, `upsert`, `$executeRaw`,
`INSERT`, `UPDATE` ni `DELETE` (sobre el fuente sin comentarios; memoria «la guardia mide por método»:
aquí se mide el archivo entero, que es lo que se quiere).

`jornadaCR` se deriva en el servicio con `derivarJornada` (`lib/utils/jornada-cierre.ts`, el derivador
único de la 271), igual que `OrdenRepository.findJornadaDeCierre` (`:5122-5135`), pero **en lote**: el
repo trae `createdAt` del cierre y los `createdAt` de sus gestiones no anuladas; el servicio convierte con
`fechaCalendarioCR` y llama al derivador una vez por cierre, sin consultas adicionales.

### 2.3 `ReprogramadasRetenidasService.resumen(hoyCR)`

```
1. [A]   filas = liberacionRepo.findOrdenesLiberables(hoyCR).filter(r => !puedeLiberarse(r))
         → RetenidaRow{ forma: "reprogramado", gestionId: null, cierreId: r.gestionCierreId, ... }
2. [B]   filas += retenidasRepo.findRetenidasEnReparto(hoyCR)
3.       cierreIds = distinct(filas.cierreId no nulos) → findCierresQueRetienen(cierreIds)
4.       centralZonaId = zonaRepo.findCentralZonaId()   (solo si hay filas sin cierre)
5.       agrupar: por cierre (cuantas, ambito por destino persistido, jornada derivada);
                  sin cierre por mensajeroAsignadoId (ambito por resolverDestinoCierre(zonaId, central))
6.       total = filas.length; ordenar cierres por cuantas desc, jornada asc, mensajeroNombre asc
```

`puedeLiberarse` se **importa** de `LiberacionReprogramadaService` (ya es `export function`). El
servicio no conoce Prisma, HTTP ni el reloj: `hoyCR` entra como argumento (`startOfDayCR(now)` lo pone el
borde, igual que los tres disparadores).

---

## 3. S1 — El aviso agregado

### 3.1 Catálogo (`lib/notificaciones/catalogo-avisos.ts`)

- `EVENTOS_AGREGADOS` gana `"reprogramadas_esperan_cierre"` (el cuarto).
- Entrada nueva:

```ts
reprogramadas_esperan_cierre: {
  porDefecto: {
    clase: "accionable",
    atajo: { href: "/cierres-admin", etiqueta: "Revisar cierres" },
    titulo: tituloReprogramadasEsperanCierre,
  },
  destinatarios: ["maestro", "admin", "adminSatelite"],
},
```

- Accionable por las tres condiciones normativas: pide una acción (aprobar el cierre), tiene
  consecuencia si no se hace (las órdenes no se asignan y el paquete no sale) y quien lo recibe puede
  resolverla (es quien aprueba). Con atajo por el criterio §2.1bis de la 409: `/cierres-admin` es el
  sitio donde **ejecuta** la aprobación, no un mirador. Sin `porRol`: los tres roles van al mismo sitio y
  los tres lo ven en `SIDEBAR_ITEMS` (`menu-visibility.ts:585-591`). Sin parámetro de consulta: la
  guardia `atajo-aviso-ruta-visible` no necesita lista blanca nueva.
- Título (singular y plural explícitos; nombra el resultado con `NOMBRE_ESTADO.reprogramado`, 455/R36):

```ts
function tituloReprogramadasEsperanCierre(n: number): string {
  const r = NOMBRE_ESTADO.reprogramado; // «Reprogramado»
  return n === 1
    ? `${r} para hoy: 1 orden espera la aprobación de su cierre`
    : `${r} para hoy: ${n} órdenes esperan la aprobación de su cierre`;
}
```

  `catalogo-avisos.ts` es módulo puro; `lib/types/order-status.ts` también (ya lo importa `emitir.ts`).
  Se afirma con el test del catálogo que el módulo sigue sin Prisma/React/next.

### 3.2 Emisor (`lib/notificaciones/emitir.ts`)

```ts
export interface ReprogramadasEsperanCierreContexto {
  ambito: AmbitoRetenidas;   // { tipo: "central" } | { tipo: "zona"; zonaId }
  diaCR: string;             // fechaCalendarioCR(now), ES la mitad de la entidad
}
export const TEXTO_REPROGRAMADAS_ESPERAN_CIERRE =
  "No se pueden asignar hasta que se apruebe el cierre del mensajero que las visitó. " +
  "Revisa los cierres marcados «Retiene reprogramadas de hoy» y apruébalos antes de asignar.";

export async function emitirReprogramadasEsperanCierre(repo, ctx, tx?): Promise<number> {
  const destinatarios = ctx.ambito.tipo === "central"
    ? [...ROLES_ADMINISTRACION]                                   // maestro, admin
    : [{ tipo: "rol", rol: "adminSatelite", zonaId: ctx.ambito.zonaId }];
  const ambito = ctx.ambito.tipo === "central" ? "central" : ctx.ambito.zonaId;
  return emitirFilas(repo, destinatarios.map((destinatario) => ({
    tipo: "warning", evento: "reprogramadas_esperan_cierre",
    descripcion: TEXTO_REPROGRAMADAS_ESPERAN_CIERRE, anexo: null,
    entidadTipo: "reprogramadas_esperan_cierre_dia", entidadId: `${ambito}:${ctx.diaCR}`,
    destinatario,
  })), tx);
}
```

- `warning` y no `alert`: es una cola de trabajo atascada (como `devoluciones_represadas`), no un
  servicio caído.
- **Sin número persistido** (409/R57, 413/R15): el título lo compone el catálogo con la cifra viva.
- **Sin PII** (R17/R52): ni mensajero, ni guía, ni zona en el texto. El nombre del mensajero y la
  jornada viven en S3 y S4, que autorizan por alcance.
- Entidad `${ambito}:${diaCR}` con el literal `"central"`: nunca colisiona con un uuid de zona y la
  forma es la de la 409 (`${ambito}:${dia}`).

### 3.3 Notificadores (`lib/notificaciones/notificadores.ts`)

`ReprogramadasEsperanCierreNotificador`, `notificarReprogramadasEsperanCierreCon(repo, logger)`,
`notificarReprogramadasEsperanCierreReal` (resuelve su repo por `repoReal()`, hereda el canal de push;
`push-cableado-unico.guardia` sigue verde) y el tipo se suma a `notificadorNoOp`.

### 3.4 El proceso diario (`AvisosDiariosService`)

- Constructor: gana `retenidas: Pick<IReprogramadasRetenidasService, "resumen">` (**requerido**, junto a
  `repo` e `historial`) y `notificarRetenidas: ReprogramadasEsperanCierreNotificador = notificadorNoOp`
  (tras `notificarRepresadas`). Se actualizan los call-sites: `app/api/cron/avisos-diarios/route.ts` y
  las suites que lo construyen.
- `ejecutar(now)`: tras represadas, `emitirAvisosDeRetenidas(now, diaCR, fallos)`:

```
resumen = retenidas.resumen(startOfDayCR(now))
porAmbito = agrupar(resumen.cierres ∪ resumen.sinCierre) por ambito → cuantas
for (ambito, cuantas) con cuantas > 0:           // R10
  emitirYContar("reprogramadas_esperan_cierre", () => notificarRetenidas({ ambito, diaCR }), fallos)
```

- `AvisosDiariosResumen` gana `ambitosConRetenidas`, `reprogramadasRetenidas`,
  `avisosRetenidasEmitidos`; el route handler los enumera campo a campo (R52), sin ids.
- Best-effort por ámbito (R18) con el mismo `emitirYContar`.
- El cron **no cambia de hora** (`0 13 * * *` = 07:00 CR). La conversión ya está escrita en la cabecera
  del route handler; no se «corrige».

### 3.5 Cifra viva (`VigenciaAvisoAgregadoService`)

```ts
const AMBITO_RETENIDAS_POR_ROL: Partial<Record<RolValue, "central" | "zona">> = {
  maestro: "central", admin: "central", adminSatelite: "zona",
};
// rama nueva en cifra():
if (evento === "reprogramadas_esperan_cierre") {
  const ambito = AMBITO_RETENIDAS_POR_ROL[actor.rol];
  if (ambito === undefined) throw new Error(`vigencia: el evento "${evento}" no define ambito para el rol "${actor.rol}"`);
  if (this.retenidas === undefined) throw new Error(`vigencia: el evento "${evento}" necesita el servicio de retenidas y nadie lo inyecto`);
  if (ambito === "central") return this.retenidas.contar(startOfDayCR(this.now()), { tipo: "central" });
  if (!idUtil(actor.zonaId)) throw new Error(`vigencia: el evento "${evento}" se acota por zona y el adminSatelite no tiene zona asignada`);
  return this.retenidas.contar(startOfDayCR(this.now()), { tipo: "zona", zonaId: actor.zonaId });
}
```

- Dependencia nueva por constructor, **opcional en el tipo** (patrón `repartoRepo` de la 413) y que
  **lanza** si falta: los consumidores vigentes compilan y un composition root olvidado produce un aviso
  sin número y un error en el log, jamás un aviso apagado.
- `lib/actions/notificaciones.ts:buildService()` construye `ReprogramadasRetenidasService` con sus repos
  y lo pasa. La guardia de «alguien lo PASA» se amplía.

### 3.6 Lo que hace que se apague solo

`presentacionDe` (`presentacion-aviso.ts:86-108`) ya devuelve `null` con cifra `<= 0`. Al aprobar el
cierre: Forma A deja de cumplir «cierre no aprobado» aunque el timbre 315 falle (R40); Forma B deja de
existir porque la aprobación aplica la gestión y la orden sale de `en_reparto`. Nada que apagar a mano.

---

## 4. S2 — Push

`lib/notificaciones/push-elegibles.ts`:

```ts
// ADMIN Y BODEGA SATELITE. Reprogramadas de hoy que no se pueden asignar hasta aprobar un cierre: es
// DINERO parado (el paquete no sale) y tiene PLAZO (hoy). El `maestro` NO esta, siguiendo la tabla
// aprobada para los dos avisos hermanos de cierres (`cierre_dia_por_aprobar`, `devoluciones_represadas`).
reprogramadas_esperan_cierre: { push: "si", roles: ["admin", "adminSatelite"] },
```

Todo lo demás es del canal existente y **no se toca**: el decorador `conPushWeb` toma el cupo
`(usuario, evento, jornada)` por índice único (R22), el trabajo `push_web` relee el aviso y no envía si
está leído/descartado (R25) y compone el cuerpo con `presentacionDe` (R23). La hora del push es la de la
emisión: 07:00 CR (R24).

---

## 5. S3 — La marca por cierre en `/cierres-admin`

### 5.1 Datos

- `CierreAdminResumen` (`lib/interfaces/services/ICierresAdminService.ts:62`) gana
  `reprogramadasRetenidasHoy?: number` (aditivo, opcional en el tipo; el servicio lo puebla siempre en
  los tres caminos).
- `CierresAdminService` gana por constructor `retenidas: Pick<IReprogramadasRetenidasService,
  "contarPorCierre">` con **default que lanza**? No: default **no-op que devuelve `Map` vacío** sería
  el fallo mudo del repo (la marca no saldría nunca con la suite verde). Se elige el patrón de la
  vigencia: **sin default**; las trece suites que instancian el servicio pasan un doble (una línea cada
  una) y una guardia afirma que `lib/actions/cierres-admin.ts` lo PASA. Alternativa (default vacío)
  descartada por la familia «el composition root que no inyecta».
- Método privado `rellenarRetenidas(filas)`: `contarPorCierre(startOfDayCR(now), ids)` una vez por
  página y anota el campo (`?? 0`). Se llama en `listarPendientesCierresAdminPaginado`,
  `listarHistoricoCierresAdminPaginado` y `verCierreDetalle` (mismo patrón que `rellenarPendientes`,
  `CierresAdminService.ts:1099-1125`). El reloj del servicio (`now`) ya es inyectable.
- Un cierre `aprobado` retiene 0 por construcción (ambas formas exigen cierre no aprobado): R28 no
  necesita rama propia, se afirma con test.

### 5.2 Pantalla

- Componente nuevo `app/(app)/cierres-admin/_components/RetieneReprogramadasBadge.tsx` (vive junto a la
  página; un solo uso por pantalla, no se promueve a `shared/`): `Badge variant="warning"` con
  `retieneReprogramadas(n)` de `cierre-labels.ts`:
  `n === 1 ? "Retiene 1 reprogramada de hoy" : \`Retiene ${n} reprogramadas de hoy\``; `null`/`0` →
  no renderiza nada. `title`/`aria-label`: «N órdenes con resultado Reprogramado para hoy siguen
  retenidas por este cierre».
- Se monta en: los chips de cabecera de `CierreFacturaResumen` (`cierre-factura.tsx:705-707`, junto a
  mensajero y fecha), en la cabecera del detalle (`cierre-detalle-shared.tsx`) y en las filas del
  histórico (`CierresAdminHistoricoLista.tsx`) para que los `rechazado` la lleven (R28; la cola
  `ESTADOS_COLA_CIERRE_DIA = [solicitado, vencido]` no incluye `rechazado`, `lib/utils/colas-cierre.ts:32`).
- Ni una acción, ni el orden ni las descargas cambian (R29/R31): `cierres-admin-descarga-columnas.ts`
  no se toca y su guardia sigue verde.

---

## 6. S4 — La franja de `/ordenes`

### 6.1 Lectura

`lib/actions/reprogramadas-retenidas.ts` (`'use server'`):

```ts
export type ResumenRetenidasResult =
  | { status: "ok"; resumen: ResumenRetenidas }   // YA recortado al ámbito central
  | { status: "forbidden" } | { status: "unauthenticated" };
export async function resumenReprogramadasRetenidasCentral(deps = {}): Promise<ResumenRetenidasResult>
```

- Autoriza con `esAccesoTotal(actor.rol)`; `adminTienda` → `forbidden` (R36). Construye
  `ReprogramadasRetenidasService` con `getPrismaClient()`, `hoyCR = startOfDayCR(now)` y recorta con
  `recortarPorAmbito(resumen, { tipo: "central" })`. Sin zod: no hay entrada.

### 6.2 Página y componente

- `app/(app)/ordenes/page.tsx`: si `esAccesoTotal(rol)`, `await` de la acción envuelto en `try` (R37:
  cualquier fallo → `null`, registrado, la página sigue) y `<FranjaReprogramadasRetenidas resumen={…} />`
  **antes** de `<OrdenesListado>` dentro de `AppPage`. Para `adminTienda` no se lee nada (ni una
  consulta).
- `app/(app)/ordenes/_components/FranjaReprogramadasRetenidas.tsx`: Server Component puro (sin
  hooks), sobre `components/ui/alert.tsx` (`Alert` de shadcn, ya en el repo). Props: `resumen:
  ResumenRetenidas | null`. Con `null` o `total === 0` devuelve `null` (R35).
  - Frase principal (R32/R34), singulares explícitos:
    - `M > 0`: «Hay N reprogramadas de hoy que no puedes asignar todavía: faltan M cierres por aprobar.»
    - `M === 0 && K > 0`: «Hay N reprogramadas de hoy que no puedes asignar todavía: sus mensajeros
      todavía no enviaron el cierre.»
    - `K > 0 && M > 0`: se añade «K de ellas son de mensajeros que todavía no enviaron su cierre.»
  - Enlace «Revisar cierres» → `RUTA_CIERRES_ADMIN`.
  - Lista de cierres (R33): `«{mensajeroNombre} · {fechaLegible(jornadaCR) ?? "cierre del día"} ·
    {ESTADO_LABEL[estado]} · retiene N»`, cada uno `Link` a `hrefDetalleCierre(cierreId)`.
  - Importa `hrefDetalleCierre`/`RUTA_CIERRES_ADMIN` de
    `app/(app)/cierres-admin/_components/cierre-enlace.ts` (módulo puro, ya compartido con `/wallet`) y
    `ESTADO_LABEL` de `cierre-labels.ts`. **Verificar** antes que `cierre-labels.ts` es puro (sin React);
    si no lo fuera, extraer `ESTADO_LABEL` a `lib/constants/cierre-estado-label.ts` y reexportarlo desde
    su sitio actual sin cambiar ningún importador.
  - Texto en tuteo («no puedes»), literal aprobado por el humano. `fechaLegible` de
    `lib/utils/dia-reparto-textos.ts` (pura), la misma conversión que los avisos.
  - Color: solo tokens semánticos (`warning`), como la campana de la 409. Sin hex.
- **Bloque removible (R39)**: dos archivos nuevos y ~8 líneas en `page.tsx`. Quitarlo es borrar los dos
  archivos y esas líneas.

---

## 7. Modelo de datos y migración

### 7.1 Enums (única migración)

```
db/migrations/<ts>_notificacion_evento_reprogramadas_esperan_cierre/
  migration.sql   ALTER TYPE "notificacion_evento"       ADD VALUE IF NOT EXISTS 'reprogramadas_esperan_cierre';
                  ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'reprogramadas_esperan_cierre_dia';
  down.sql        recrea los DOS tipos con la lista PREVIA (la de `origin/dev` al abrir el PR)
```

- `db/schema.prisma`: `NotificacionEvento` + 1, `NotificacionEntidadTipo` + 1, con su comentario fechado
  (patrón de los valores de la 409/413).
- `lib/types/notificacion.ts`: los dos valores en los tipos espejo, con el comentario de la entidad
  (`${ambito}:${diaCR}`, por qué el ámbito va dentro y por qué `"central"`).
- Aditiva: ni tablas, ni columnas, ni índices, ni RLS. Va sola: Postgres no deja usar un valor de enum en
  la transacción que lo añade (`55P04`).
- `<ts>` posterior a la última carpeta de `origin/dev` **al abrir el PR** (hoy la más nueva vista en el
  árbol es `20260923120100_orden_evento`; el pre-vuelo caduca — memoria). Jamás renumerar una aplicada.
- **`down.sql`**: comprobado en la 409 §6.1 que los downs de estos enums **recrean con lista**. Los
  previos **no se tocan** (fotos históricas). La lista de ESTE down se reescribe contra el
  `schema.prisma` de `origin/dev` justo antes del PR (memoria «El `down.sql` borra los valores
  posteriores»). Precondición ruidosa: si hay filas con los valores nuevos, el `USING` falla y el
  rollback aborta — es lo correcto; ningún `DELETE` para «hacer sitio».
- Tocar `db/schema.prisma` y `lib/types/**` obliga a **`./init.sh` completo**; `cierre` en nombres de
  archivo también. El gate de esta ficha es el completo.

### 7.2 Lo que NO cambia

`orden`, `gestion_orden`, `cierre_dia`, `orden_evento`, `notificacion`: ni una columna. Ningún índice
nuevo: A entra por `@@index([estatusId])` y la carga agrupada de gestiones; B por `estatusId` y el
índice único parcial de `orden_evento(gestion_orden_id)`; los cierres por PK. Con la población medida
(decenas) el planner no necesita más; añadir un índice «por si acaso» a `orden` es peor que medirlo.

---

## 8. Verificación

### 8.1 Dónde se prueba cada cosa

| Qué | Dónde | Por qué ahí |
|---|---|---|
| Forma B (`where`), exclusiones, `<= hoy`, dos gestiones vivas, borradas | `tests/integration/db/462/reprogramadas-retenidas-sql-real.test.ts` (Postgres real, tx revertida, helpers de `_postgres-real.ts`) | los dobles no ven el SQL (memoria «probar el WHERE donde vive») |
| Forma A = `!puedeLiberarse` sobre `findOrdenesLiberables` | mismo archivo, siembra en `reprogramado` con y sin visita real, cierre aprobado/solicitado/vencido/rechazado/nulo | R3 se afirma comparando el conteo del servicio con el `esperandoCierre` del reloj sobre la misma siembra |
| Agrupación, ámbito, `sinCierre`, `recortarPorAmbito`, orden | `tests/unit/services/reprogramadas-retenidas-service.test.ts` (dobles) | es memoria pura |
| Emisión por ámbito, dedupe por entidad, zonas no se pisan | `tests/integration/db/462/aviso-reprogramadas-dedupe.test.ts` | la dedupe la da el índice único |
| `AvisosDiariosService` (tercer agregado, best-effort, R10) | `tests/unit/services/avisos-diarios-service.test.ts` (extender) | dobles bastan |
| Vigencia (mapa de ámbito, lanza sin zona/rol/dep) | `tests/unit/services/vigencia-aviso-agregado.test.ts` (extender) | dobles |
| Catálogo y push (entrada nueva, ruta visible, sin parámetro) | `catalogo-avisos.test.ts`, `push-elegibles.test.ts`, `atajo-aviso-ruta-visible.guardia` | datos |
| Textos literales (título singular/plural, detalle, franja, marca) | `tests/unit/notificaciones/emitir-reprogramadas-esperan-cierre.test.ts` y tests RTL de los componentes | literales **a mano**, nunca contra la función que los genera (memoria) |
| Composition roots (cron, campana, cierres-admin) | `notificacion-notificadores-reales.test.ts` (extender) + guardia nueva | «alguien lo PASA», sobre el fuente sin imports ni comentarios |
| Solo lectura | `tests/unit/guards/reprogramadas-retenidas-solo-lectura.guardia.test.ts` (nueva) | R8: el repo y el servicio no contienen verbos de escritura |
| Marca: una llamada por página, campo poblado en cola/histórico/detalle, 0 en aprobado | `tests/unit/services/cierres-admin-retenidas.test.ts` | contar llamadas al doble |
| Badge y franja | `RetieneReprogramadasBadge.test.tsx`, `FranjaReprogramadasRetenidas.test.tsx` | RTL |
| Acción de la franja: acceso total ok, adminTienda forbidden, sin sesión unauthenticated | `tests/unit/actions/reprogramadas-retenidas.test.ts` | dobles |
| Migración up/down | correr `pnpm run db:migrate` y `pnpm run db:rollback` en local; test de `tests/integration/db` que afirma los dos valores en el enum | reversibilidad |

### 8.2 Mutaciones obligatorias (cada una pone un test concreto en rojo)

1. Quitar `fecha_reprogramacion <= hoy` en B → cuenta futuras → R2 rojo.
2. Quitar `estado <> aprobado` (usar `resumen` sin `!puedeLiberarse` en A) → cuenta liberables → R2/R3.
3. Quitar `resultado = 'reprogramado'` en B → cuenta entregados pendientes → R2.
4. Contar `en_reparto` sin gestión pendiente → R2.
5. Tomar la gestión más antigua en vez de la más reciente → R43 (dos gestiones vivas).
6. Ámbito global para maestro (incluir satélite) → R6/R44.
7. Quitar el ámbito del `entidad_id` → dos zonas el mismo día: la segunda muda → R12.
8. Borrar el argumento del notificador real en `avisos-diarios/route.ts` (dejando el import) → R19.
9. Hacer que la vigencia devuelva `0` en vez de lanzar sin zona → R14.
10. Contar órdenes borradas → R2.
11. Añadir un `update` al repositorio nuevo → guardia de solo lectura roja → R8.
12. Rellenar la marca con una consulta por fila → el test de llamadas cuenta N en vez de 1 → R26/R51.
13. Mostrar la franja al `adminTienda` (quitar `esAccesoTotal`) → R36.
14. Cambiar el título a «reprogramadas» sin el nombre visible → el test literal → R13.

### 8.3 Tabla R → test (la que el implementer copia a `progress/impl_462.md`)

| R | Test |
|---|---|
| R1, R2, R43, R47 | `reprogramadas-retenidas-sql-real.test.ts` (casos: A, B, en_reparto normal, pendiente entregado, futura, anulada, cierre aprobado, escritorio, borrada, bodega, dos vivas, sin cierre → con cierre) |
| R3 | mismo archivo: `esperandoCierre` del reloj = conteo Forma A sobre la misma siembra |
| R4 | `gestion-pendiente-unica-fuente.guardia` sigue verde + aserto de las tres columnas nuevas en `gestion-pendiente-sql-real.test.ts` |
| R5, R6 | `reprogramadas-retenidas-service.test.ts` |
| R7 | `reprogramadas-retenidas-service.test.ts` (contar/contarPorCierre/recortar derivan del mismo resumen) + recorrido (R56) |
| R8 | guardia de solo lectura |
| R9-R12, R18 | `avisos-diarios-service.test.ts` + `aviso-reprogramadas-dedupe.test.ts` |
| R13, R17 | `emitir-reprogramadas-esperan-cierre.test.ts` (literales a mano) |
| R14, R15 | `vigencia-aviso-agregado.test.ts` + `notificacion-service.test.ts` (fila oculta con 0, visible sin número al fallar) |
| R16 | `catalogo-avisos.test.ts` + `atajo-aviso-ruta-visible.guardia` |
| R19 | `notificacion-notificadores-reales.test.ts` (tres roots) |
| R20 | guardia: `LiberacionReprogramadaService.ts`, `liberacion-al-aprobar-cierre.ts` y `liberacion-tras-corregir-fecha.ts` no nombran el evento ni el notificador |
| R21-R25 | `push-elegibles.test.ts` (roles), `notificacion-repo-con-push.test.ts` (cupo, sigue verde), aserto de que la hora del cron no cambió (`vercel.json`) |
| R26, R29, R51 | `cierres-admin-retenidas.test.ts` (una llamada por página; acciones intactas: suites existentes verdes) |
| R27, R28 | `RetieneReprogramadasBadge.test.tsx` + `cierres-admin-retenidas.test.ts` (aprobado → 0 → sin marca) |
| R30 | `cierres-admin-retenidas.test.ts` con alcance satélite y central |
| R31 | `cierres-admin-descarga-columnas` guardia sigue verde |
| R32-R35, R38 | `FranjaReprogramadasRetenidas.test.tsx` (tres frases, lista, enlaces, `null` con 0) |
| R36, R37 | `reprogramadas-retenidas.test.ts` (acción) + test de `page.tsx` o recorrido (R56) |
| R39 | revisión: dos archivos + líneas en `page.tsx`; se afirma en `impl_462.md` |
| R40-R42, R44-R46 | `reprogramadas-retenidas-sql-real.test.ts` (aprobar → 0 aunque siga en `reprogramado`; rechazado y vencido cuentan; satélite en su ámbito; fecha corregida a hoy / a futuro) |
| R48, R49 | suites de 276/315/371 verdes + guardia de solo lectura + `feeds-no-leen-estatus.guardia` verde |
| R50 | suites de 409/413 verdes; `aviso-agregado-repository.test.ts` intacto |
| R52 | tests del emisor y del route (respuesta campo a campo) |
| R53 | migración up/down en local + test del enum |
| R54 | el archivo de integración con siembra que falla si está vacía |
| R55 | `scripts/medir-462-retenidas.sql` corrido en local con `psql` contra la siembra del test (mismo número) |
| R56 | `progress/impl_462.md` §recorrido con números por rol |

### 8.4 Rojos esperados y rojos que son regresión

- **Por diseño** (se actualizan con nota fechada): los tests que cuentan las entradas de
  `EVENTOS_AGREGADOS` (3 → 4), `PUSH_ELEGIBLE` (17 → 18), las suites que construyen
  `AvisosDiariosService`, `VigenciaAvisoAgregadoService` y `CierresAdminService` (parámetro nuevo), y la
  autocomprobación de `atajo-aviso-ruta-visible` si cuenta destinos (`>= 13` sigue cierto).
- **Regresión** (se arregla el código, no el test): cualquier suite de 276/315/371, de la 409/413,
  `gestion-pendiente-unica-fuente.guardia`, `correccion-fecha-reprogramacion.guardia`,
  `anclaje-vs-intentos.guardia`, `push-cableado-unico.guardia`, feeds de dinero.

---

## 9. El SQL de solo lectura para producción (R55)

`scripts/medir-462-retenidas.sql`. Una sola sentencia `WITH … SELECT`, sin escrituras. Se pega entera en
la consola SQL (MCP de Supabase) o se corre con `psql`. **Corre sobre el esquema con la 454 aplicada**
(usa `orden_evento`); antes de la release, para dimensionar la población legada, se comenta el CTE
`forma_b` (o se corre solo `forma_a`) — es la medida del día de despliegue (T5.1).

```sql
-- FICHA 462 — reprogramadas de hoy retenidas por un cierre sin aprobar, agrupadas por cierre.
-- SOLO LECTURA. El «hoy» es la fecha calendario de Costa Rica del instante de la corrida.
-- Las familias de visita real se copian de `ORIGEN_TIPOS_VISITA_REAL` (`lib/types/orden-historial.ts`)
-- al correr; hoy: 'gestion', 'gestion_tienda_ayuda' (verificar la lista antes de pegar).
WITH params AS (
  SELECT ((now() AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')::date AS hoy_cr
),
-- Forma A: orden en `reprogramado`, gestion reprogramada VIGENTE (mas reciente, no anulada),
-- nacida de visita real, con cierre no aprobado.
a_vigente AS (
  SELECT DISTINCT ON (g.orden_id)
         g.orden_id, g.id AS gestion_id, g.cierre_id, g.fecha_reprogramacion
    FROM gestion_orden g
   WHERE g.resultado = 'reprogramado' AND g.anulada_at IS NULL
   ORDER BY g.orden_id, g.created_at DESC
),
forma_a AS (
  SELECT 'A'::text AS forma, o.id AS orden_id, o.zona_id, o.mensajero_asignado_id,
         v.gestion_id, v.cierre_id, v.fecha_reprogramacion
    FROM orden o
    JOIN order_status s ON s.id = o.estatus_id AND s.value = 'reprogramado'
    JOIN a_vigente v ON v.orden_id = o.id
    LEFT JOIN cierre_dia c ON c.id = v.cierre_id
   CROSS JOIN params p
   WHERE o.deleted_at IS NULL
     AND v.fecha_reprogramacion <= p.hoy_cr
     AND EXISTS (SELECT 1 FROM orden_historial_estado h
                  WHERE h.gestion_orden_id = v.gestion_id
                    AND h.origen_tipo IN ('gestion', 'gestion_tienda_ayuda'))
     AND (v.cierre_id IS NULL OR c.estado <> 'aprobado')
),
-- Forma B (454): orden en `en_reparto`, gestion PENDIENTE de confirmar mas reciente con resultado
-- `reprogramado` y fecha <= hoy. Mismas tres condiciones que `gestion-pendiente.ts`.
b_pendiente AS (
  SELECT DISTINCT ON (g.orden_id)
         g.orden_id, g.id AS gestion_id, g.cierre_id, g.resultado, g.fecha_reprogramacion
    FROM gestion_orden g
    LEFT JOIN cierre_dia c ON c.id = g.cierre_id
   WHERE g.anulada_at IS NULL
     AND EXISTS (SELECT 1 FROM orden_evento e
                  WHERE e.gestion_orden_id = g.id AND e.tipo = 'gestion_registrada')
     AND (g.cierre_id IS NULL OR c.estado <> 'aprobado')
   ORDER BY g.orden_id, g.created_at DESC, g.id DESC
),
forma_b AS (
  SELECT 'B'::text AS forma, o.id AS orden_id, o.zona_id, o.mensajero_asignado_id,
         b.gestion_id, b.cierre_id, b.fecha_reprogramacion
    FROM orden o
    JOIN order_status s ON s.id = o.estatus_id AND s.value = 'en_reparto'
    JOIN b_pendiente b ON b.orden_id = o.id
   CROSS JOIN params p
   WHERE o.deleted_at IS NULL
     AND b.resultado = 'reprogramado'
     AND b.fecha_reprogramacion <= p.hoy_cr
),
retenidas AS (SELECT * FROM forma_a UNION ALL SELECT * FROM forma_b)
SELECT r.cierre_id,
       c.estado,
       c.destino_tipo,
       z.nombre                          AS bodega,
       u.nombre                          AS mensajero,
       (c.solicitado_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica' AS solicitado_cr,
       COUNT(*)                          AS retenidas,
       SUM((r.forma = 'A')::int)         AS forma_a,
       SUM((r.forma = 'B')::int)         AS forma_b,
       MIN(r.fecha_reprogramacion)       AS fecha_mas_antigua
  FROM retenidas r
  LEFT JOIN cierre_dia c ON c.id = r.cierre_id
  LEFT JOIN zona z ON z.id = c.destino_zona_id
  LEFT JOIN usuario u ON u.id = COALESCE(c.mensajero_id, r.mensajero_asignado_id)
 GROUP BY r.cierre_id, c.estado, c.destino_tipo, z.nombre, u.nombre, c.solicitado_at
 ORDER BY retenidas DESC, solicitado_cr ASC;
```

- `cierre_id IS NULL` en el resultado es el grupo «sin cierre enviado» (agrupado por mensajero).
- El total del sistema es `SUM(retenidas)`; la fila de un cierre es lo que la marca de S3 debe enseñar y
  la suma por `destino_tipo = 'bodega_central'` es la cifra de maestro/admin (R6/R7). Compararlo con la
  pantalla es parte del recorrido (T5.3).
- En local, el test de integración corre este mismo archivo con `psql`/`$queryRawUnsafe` contra su
  siembra y afirma que da el mismo número que el servicio (R55).

---

## 10. Archivos que toca la implementación

**Backend (van primero):**

| Archivo | Cambio |
|---|---|
| `db/schema.prisma` | +1 en `NotificacionEvento`, +1 en `NotificacionEntidadTipo` |
| `db/migrations/<ts>_notificacion_evento_reprogramadas_esperan_cierre/{migration,down}.sql` | **nuevos** |
| `lib/types/notificacion.ts` | +2 valores en los tipos espejo, con comentario |
| `lib/notificaciones/catalogo-avisos.ts` | +1 en `EVENTOS_AGREGADOS`, +1 entrada, +título |
| `lib/notificaciones/push-elegibles.ts` | +1 entrada |
| `lib/notificaciones/emitir.ts` | +texto, +contexto, +emisor |
| `lib/notificaciones/notificadores.ts` | +tipo, +`Con`, +`Real`, `notificadorNoOp` |
| `lib/interfaces/repositories/IReprogramadaRetenidaRepository.ts` | **nuevo** |
| `lib/repositories/ReprogramadaRetenidaRepository.ts` | **nuevo** (solo lecturas) |
| `lib/repositories/gestion-pendiente.ts` | LATERAL proyecta `gestion_id`, `cierre_id`, `fecha_reprogramacion` (aditivo) |
| `lib/interfaces/repositories/ILiberacionReprogramadaRepository.ts` + `lib/repositories/LiberacionReprogramadaRepository.ts` | `OrdenLiberableRow.mensajeroAsignadoId` (select aditivo) |
| `lib/interfaces/services/IReprogramadasRetenidasService.ts` | **nuevo** (+ `recortarPorAmbito`) |
| `lib/services/ReprogramadasRetenidasService.ts` | **nuevo** |
| `lib/interfaces/services/IAvisosDiariosService.ts` | +3 campos del resumen |
| `lib/services/AvisosDiariosService.ts` | +dep, +notificador, +`emitirAvisosDeRetenidas` |
| `app/api/cron/avisos-diarios/route.ts` | composition root (+servicio, +notificador real, +campos) |
| `lib/interfaces/services/IVigenciaAvisoAgregado.ts` | doc de la rama nueva |
| `lib/services/VigenciaAvisoAgregadoService.ts` | +mapa de ámbito, +rama, +dep opcional que lanza |
| `lib/actions/notificaciones.ts` | composition root: pasa el servicio de retenidas |
| `lib/interfaces/services/ICierresAdminService.ts` | `CierreAdminResumen.reprogramadasRetenidasHoy?` |
| `lib/services/CierresAdminService.ts` | +dep, +`rellenarRetenidas` en cola, histórico y detalle |
| `lib/actions/cierres-admin.ts` | composition root: pasa el servicio de retenidas |
| `lib/actions/reprogramadas-retenidas.ts` | **nuevo** (lectura para la franja, acceso total) |
| `scripts/medir-462-retenidas.sql` | **nuevo** (solo lectura) |

**Frontend (después):**

| Archivo | Cambio |
|---|---|
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | +`retieneReprogramadas(n)` |
| `app/(app)/cierres-admin/_components/RetieneReprogramadasBadge.tsx` | **nuevo** |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | chip en `CierreFacturaResumen` |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | marca en la cabecera del detalle |
| `app/(app)/cierres-admin/_components/CierresAdminHistoricoLista.tsx` | marca en filas `rechazado` |
| `app/(app)/ordenes/_components/FranjaReprogramadasRetenidas.tsx` | **nuevo** |
| `app/(app)/ordenes/page.tsx` | lectura + render de la franja (acceso total) |

**No se toca:** `LiberacionReprogramadaService.ts` (salvo nada), `liberacion-al-aprobar-cierre.ts`,
`liberacion-tras-corregir-fecha.ts`, `liberar-reprogramadas-handler.ts`, `CierresAdminRepository.ts`,
`vercel.json`, `NotificationsBell.tsx`, `presentacion-aviso.ts`, `NotificacionService.ts`,
`cierres-admin-descarga-columnas.ts`, ninguna tabla.

**Colisiones:** con la 461 (`feature/461-cobro-y-nombres`, dinero/wallet) ninguna por archivo; con la
455 (`order-status.ts`) solo lectura de `NOMBRE_ESTADO`. Base de la rama: `origin/dev` con la 454 ya
mergeada (`gestion-pendiente.ts` existe en `dev`).

---

## 11. Alternativas descartadas

### A · Un aviso por cierre en la campana (con enlace a su detalle en cada fila)
Habría puesto el «por qué cierre» en la campana. **Descartada**: el atajo del catálogo es estático por
(evento, rol) y `NotificacionService.cifrasVivas` resuelve la cifra **por evento**, no por fila; una fila
por cierre exigiría cifra por entidad y un atajo por fila (rediseño de la 409), y con varios cierres
abiertos serían varias campanadas por el mismo hecho. El «por qué cierre» vive en S3 y S4, que ya
autorizan por alcance. La campana dice cuántas y lleva a donde se aprueba.

### B · Emitir desde la corrida de medianoche (`ejecutarLiberacion`), como decía el `status_note`
Era la lectura literal de «reutiliza el conteo `esperandoCierre`». **Descartada**: el push saldría a las
00:00 CR; el corte nocturno y el job `liberar_reprogramadas` corren en el mismo minuto y los cierres
`vencido` que el corte crea podrían no existir aún; y tras la 454 ese contador solo ve la Forma A. Se
reutiliza la **regla** (`puedeLiberarse` sobre `findOrdenesLiberables`), no la corrida. S3 y S4 son vivas
desde la madrugada.

### C · Un cuarto disparador desde la corrección de fecha (371)
Cubría al instante el caso real (11:45). **Descartada**: quien corrige está delante de la pantalla y ya
lee «espera su cierre»; la franja y la marca lo reflejan al siguiente render; y emitir a media mañana
rompe «una al día por tipo» del push. Decisión 10 de requirements.

### D · Reescribir el predicado entero en un solo SQL nuevo (A y B)
Daba un solo `WHERE` y el mismo texto para el script de producción. **Descartada**: la guardia 371
prohíbe una segunda correlación de «la gestión reprogramada vigente» en `lib/**` y la 454 prohíbe leer
`gestion_registrada` fuera de su módulo; reescribirlas es exactamente el defecto mudo que esas guardias
existen para impedir. El script de `scripts/` sí las re-expresa (fuera de `lib/**`, como
`contraste-454.sql`), y el test de integración afirma que da el mismo número que el servicio.

### E · Columna `retenida_por_cierre_id` en `orden`, escrita por el reloj
Barata de leer. **Descartada** por la D1 de la 236 y su historia: una marca persistida con varias
salidas (aprobar, corregir fecha, liberar) que alguien olvidaría apagar. La derivación se cierra sola.

### F · Maestro y admin con el total del sistema (como `devoluciones_represadas`)
**Descartada**: en `/cierres-admin` solo ven cierres `bodega_central`; la cifra no coincidiría con las
marcas que ven y el aviso quedaría desacreditado el primer día (decisión 3).

### G · La franja también en `/recepcion-satelite/en-bodega`
El componente serviría tal cual con el ámbito de la zona. **Fuera de esta ficha** por alcance
(decisión 4); queda declarada.

---

## 12. Riesgos

1. **Cinco consultas por sondeo de campana** para quien tenga el aviso vivo (§2.1). Se mide en el
   recorrido con la campana abierta 5 minutos; si pesa, `contar` deja de pedir nombres y jornadas.
2. **Filas apiladas entre días** (decisión 5): patrón 409, se acepta. Si el humano lo ve ruidoso, la
   salida es «entidad sin día» y se decide entonces.
3. **`jornadaCR` nula** en cierres con gestiones de dos días: la franja dice «cierre del día» (R33), no
   inventa fecha (271/R60).
4. **Base local compartida**: la migración de enums pone rojo el gate de otros worktrees hasta que
   migren; avisar antes de aplicar (memoria).
5. **Población legada (Forma A) el día de la release**: se mide antes con la parte A del script (T5.1);
   ese número es lo que la oficina verá el primer día.
6. **Texto de la campana en tuteo, otros avisos a bodega en voseo**: se sigue el tuteo de los avisos de
   cierres a bodega («Aprueba el más antiguo», «Revisa Configuración > API»). Si el humano prefiere
   voseo, es un literal y su test.
