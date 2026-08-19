# Feature 230 — Descarga de cierres general y detallada · design

> El QUÉ está en `requirements.md`. Aquí van las decisiones técnicas, con la cita del código en
> el que se apoyan (`ruta:línea`, leído el 2026-08-18 sobre el árbol de trabajo actual).
>
> Este documento incorpora las respuestas de la gate F1.4 (**D6…D13**). Ya no hay propuestas
> abiertas: hay decisiones y, al final, dos avisos que el humano necesita antes de aprobar.
>
> **Sin migración. Sin tabla nueva. Sin RLS nueva. Sin ruta `app/api/` nueva.** La feature no
> escribe: son dos lecturas más sobre datos que ya existen (`gestion_orden` + `cierre_detail`),
> una declaración de columnas y un diálogo.

---

## 1. Lo que hay hoy, medido

### 1.1 La descarga GENERAL (se conserva tal cual, D1)

- `app/(app)/cierres-admin/_components/cierres-admin-descarga-columnas.ts:40-48` declara
  `COLUMNAS_DESCARGA_CIERRES_PENDIENTES` (7 columnas) y `:68-77`
  `COLUMNAS_DESCARGA_CIERRES_HISTORICO` (8, con «Motivo»). Grano: **una fila por cierre**.
- Proyecciones: `filaDescargaCierrePendiente` (`:55-65`) y `filaDescargaCierreHistorico`
  (`:88-99`), sobre `CierreAdminResumen`.
- Cableado: `CierresAdminModule.tsx:192-202` (`descargaColaCierres`), que llama a
  `listarPendientesCierresAdminCompleto({ filtros })`. Su cabecera (`:186-188`) fija la
  consigna del 2026-08-16: *«el archivo sale del MISMO conjunto que el listado enseña, filtros
  incluidos»*.
- `leerHistorico` (`CierresAdminModule.tsx:210-218`) es la mitad paginada, y su comentario
  (`:204-209`) enuncia el patrón **R44 de la 170**: *«el alcance NO viaja en el input —lo
  resuelve el servicio desde la sesión—; aquí solo van el número de página, el tamaño y los
  FILTROS, que recortan DENTRO de ese alcance y nunca lo ensanchan»*.
- El lado bodega tiene su gemelo: `cierres-bodega-descarga-columnas.ts:39-47`, `:67-76`,
  `:100-108` y `:124-132` (cuatro listas).

**Esta feature no toca ninguno de esos puntos.** R2 lo fija y su test lo mide.

### 1.2 La descarga DETALLADA de hoy: cinco archivos, un solo cierre

- `cierre-gestiones-descarga-columnas.ts:50-58` declara `COMUNES` (7 columnas) y `:97-106`,
  `:131-137`, `:159-167`, `:186-196`, `:223-230` las cinco listas por resultado.
- El mapa que elige cuál toca vive **fuera** de ese módulo, en
  `cierre-detalle-shared.tsx:1018-1042`, y su cabecera (`:1011-1017`) dice por qué: *«un
  `Record` exportado desde un `*-descarga-columnas.ts` se le escaparía a la guardia de datos
  sensibles, que solo reconoce arrays de columnas y funciones de proyección»*. Es la razón
  literal por la que R48 obliga a que la nueva declaración viva en su propio
  `*-descarga-columnas.ts`.
- El control se monta dentro del `DataTable` de cada sección
  (`cierre-detalle-shared.tsx:1109-1113`); el nombre del archivo se compone con la prop
  `contexto` (`:1052-1065`, `:1074-1076`), que hoy es **el nombre del mensajero**. Existe porque
  el detalle de un cierre de BODEGA monta las mismas cinco secciones **una vez por mensajero**
  (`CierresBodegaAdminModule.tsx:595-602`).
- **De ahí sale el invariante (vii) de la ficha:** «Mensajero» no está en `COMUNES` porque el
  archivo era de un solo cierre y el nombre iba en el NOMBRE del archivo. Al cruzar cierres,
  sin esa columna las filas no se distinguen. R8.
- La marca de evidencia (`TIENE_EVIDENCIA_COL/_SI/_NO` y `tieneEvidencia`,
  `cierre-gestiones-descarga-columnas.ts:43-47` y `:88-91`) **se queda intacta**: es de estas
  cinco descargas, que no se retiran (D8, R3).

### 1.3 El hueco: no hay lectura multi-cierre

- `CierreDetalleGestion` (`lib/interfaces/services/ICierreDiaService.ts:20-108`) es el DTO de
  **una gestión de un cierre**; no lleva mensajero.
- `CierreGrupos` (`ICierreDiaService.ts:192`) es `Record<CierreResultado, CierreDetalleGestion[]>`:
  **los grupos de UN cierre**.
- `ICierreDiaService` (`:318-375`) es el servicio **del mensajero**, acotado a
  `actor.usuarioId` como `mensajero_id` (`:333-344` lo dice explícitamente). **No es el
  servicio de esta feature.**
- Los dos únicos caminos que devuelven gestiones al admin son por ID:
  `CierresAdminRepository.findCierreByIdEnAlcance` (`lib/repositories/CierresAdminRepository.ts:718-756`)
  y `CierresBodegaAdminRepository.findCierreBodegaConDetalle`
  (`lib/repositories/CierresBodegaAdminRepository.ts:293-346`).

---

## 2. Los bordes de lectura

### 2.1 Decisión

**Un método nuevo en `ICierresAdminService` + uno en `CierresAdminRepository`** (camino
«cierres del día») **y un método nuevo en `ICierresBodegaAdminService` + uno en
`CierresBodegaAdminRepository`** (camino «cierres de bodega»). Ni servicio nuevo, ni
repositorio nuevo, ni nada en `ICierreDiaService`.

**Son dos y no uno por una razón medida, no por simetría.** Ver §2.6: los dos listados no son
dos vistas del mismo conjunto, son **particiones disjuntas**.

### 2.2 Por qué dentro de los servicios que ya existen

1. **El alcance por rol es privado de cada servicio.** `resolveAlcance(actor)` se invoca en
   `lib/services/CierresAdminService.ts:338`, `:365` y `:377`; el guard del lado bodega es
   `esAccesoTotal` (`ICierresBodegaAdminService.ts:11-15`: *«Solo el rol maestro; sin filtro de
   zona: todo va a la central»*). Un servicio nuevo tendría que **reimplementarlos** — lo que
   R16 prohíbe.
2. **Ya hay hermanos con esta forma exacta.** `listarHistoricoCierresAdminCompleto` y
   `listarPendientesCierresAdminCompleto` (`ICierresAdminService.ts:225-247`, implementados en
   `CierresAdminService.ts:334-350`), y sus gemelos de bodega
   (`ICierresBodegaAdminService.ts:52-60`). El orden es siempre `forbidden` → `sinZona` → repo
   → tope.
3. **El tope lo evalúa el servicio** (`CierresAdminService.ts:344-347`, con
   `descargaConfig.MAX_FILAS`, `lib/config/descarga.ts:22`, default 5000). D13 lo ratifica tal
   cual: R21 sale de reusar ese bloque, sin constante nueva.

### 2.3 Por qué dentro de los repositorios que ya existen

Los predicados de alcance y recorte son **funciones privadas de módulo**:
`alcanceWhere` (`CierresAdminRepository.ts:353-358`), `filtrosWhere`, `historicoWhere` y
`colaWhere` (`:452-459`); en bodega, `historicoBodegaWhere` / `colaBodegaWhere` y
`rangoSolicitadoAt` (`CierreBodegaRepository.ts:117-125`). El comentario de
`CierresAdminRepository.ts:442-451` explica qué se rompe cuando dos mitades dejan de leer la
misma constante. El orden también es constante única:
`ORDEN_CIERRES_ADMIN = { solicitadoAt: "desc" }` (`:417`). R11 lo necesita.

### 2.4 Contrato compartido

```ts
// lib/interfaces/services/ICierresAdminService.ts (añadido; el de bodega lo importa)

/** Una GESTIÓN de un cierre, lista para proyectar a una fila de la hoja fundida. */
export interface CierreGestionDescargaDTO {
  // --- identidad del cierre (lo que la fila de hoy NO tenía: el archivo era de uno) ---
  mensajeroNombre: string;
  cierreSolicitadoAt: string;      // ISO; la fila lo emite como día calendario
  // --- identidad de negocio de la gestión (SIN uuid, R42) ---
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  direccion: string | null;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
  producto: string;
  tiendaNombre: string;
  resultado: CierreResultado;
  // --- datos por rama, money-safe STRING tal cual ---
  montoRecibido: string | null;
  pagos: { metodo: MetodoPagoValue; monto: string }[];
  motivo: string | null;
  fechaReprogramacion: string | null;
  esRechazoSla: boolean;
  causaIncidente: CausaIncidente | null;
  indemnizacion: string | null;
  pagoMensajero: string | null;
  ingresoBodegaRechazo: string | null;
  ingresoOrdenex: IngresoOrdenexDTO | null;
}

export type ListarGestionesDescargaServiceResult =
  ListarCompletoServiceResult<CierreGestionDescargaDTO>;
```

`ListarCompletoServiceResult<T>` es el union ya existente
(`lib/types/descarga-listado.ts:48-51`): `ok | limite_excedido | forbidden`, con la garantía
escrita de que ni `limite_excedido` ni `forbidden` llevan `items`.

Métodos:

```ts
// ICierresAdminService
listarGestionesCierresAdminCompleto(
  actor: Actor,
  filtros?: FiltrosDescargaGestiones,
): Promise<ListarGestionesDescargaServiceResult>;

// ICierresBodegaAdminService
listarGestionesCierresBodegaCompleto(
  actor: Actor,
  filtros?: FiltrosDescargaGestiones,
): Promise<ListarGestionesDescargaServiceResult>;
```

### 2.5 El DTO NO es `CierreDetalleGestion`, y ya no lleva NADA de evidencia (D8)

Tres campos de `CierreDetalleGestion` **no pueden existir** en este DTO:

| Campo | Por qué se va |
| --- | --- |
| `evidenciaUrl` (`ICierreDiaService.ts:50`) | Es la **URL FIRMADA** (R22 de la 170): una hoja reenviada por correo con ella dentro es acceso a la foto sin sesión. |
| `gestionId`, `ordenId` (`:21-22`) | uuid internos (R23 de la 170 / R42 de ésta). |

**Y, tras D8, tampoco lleva `tieneEvidencia`.** El spec anterior proponía sustituir la URL por
un booleano derivado; el humano retiró la columna entera, así que el booleano no tiene
consumidor. Se retira **también del DTO**: la forma más fuerte de cumplir R40/R41 es que el
servidor **no emita nada relativo a la evidencia por este camino**, ni siquiera un `boolean`.
No hay campo que pueda convertirse mañana en columna por descuido.

> **Ojo, R3:** esto NO toca `TIENE_EVIDENCIA_COL/_SI/_NO` ni `tieneEvidencia()`
> (`cierre-gestiones-descarga-columnas.ts:43-47`, `:88-91`), que siguen sirviendo a las cinco
> descargas por sección. Solo la fundida no los usa.

**Un requisito que se cumple «porque la columna no existe» necesita su test igual** (R40/R41):
sin él, la próxima persona añade la columna sin enterarse de que hay una decisión detrás. Ver
T3.4 en `tasks.md`.

**Corolario operativo (R22): ninguno de los dos servicios llama al firmador.**
`verCierreDetalle` firma en lote en `CierresAdminService.ts:388-408`
(`this.signedUrls.createSignedUrls(paths, ...)`). Ese bloque **no se copia**. Mismo
razonamiento que la 184 escribió para el histórico del mensajero
(`ICierreDiaService.ts:276-283`): *«firmarlas para generarlo era trabajo perdido, y pagado en
red»* — aquí además sería un agujero.

### 2.6 ⚠️ HALLAZGO — los dos listados son PARTICIONES DISJUNTAS, no dos vistas de lo mismo

Esto contradice lo que el spec anterior daba por hecho y es el motivo real de D10 («los dos
puntos de entrada, incluida GAM»). Verificado leyendo el código:

1. `CierresAdminService.resolveAlcance` (`lib/services/CierresAdminService.ts:117-130`):
   - acceso total (maestro) → `{ destinoTipo: "bodega_central", destinoZonaId: null }`;
   - `adminSatelite` → `{ destinoTipo: "bodega_satelite", destinoZonaId: suZona }`.
2. `alcanceWhere` (`CierresAdminRepository.ts:353-358`) **siempre** filtra por `destinoTipo`.

   ⇒ **El maestro, en `cierres-admin`, ve SOLO los cierres del día con destino bodega central,
   es decir los de los mensajeros de la GAM.** Los de zonas satélite no están ahí para él.

3. `CierreBodegaRepository.consolidablesWhere` (`lib/repositories/CierreBodegaRepository.ts:146-161`)
   exige `destinoTipo: DESTINO_SATELITE` y `cierreBodegaId: null`.

   ⇒ **Un cierre del día con destino `bodega_central` NUNCA se consolida en un cierre de
   bodega.** No hay camino que lo meta ahí.

**Conclusión:** para el maestro, «cierres del día» y «cierres de bodega» cubren conjuntos de
gestiones **disjuntos**, y su unión es el total. Un solo botón —en cualquiera de las dos
pantallas— dejaría fuera la mitad del negocio. Por eso D10 pide los dos, y por eso «incluida
GAM» no es un caso especial: **la GAM es precisamente lo que cubre el botón de
`cierres-admin`**, y las satélite lo que cubre el de bodega.

**No hace falta ningún tratamiento especial para GAM** (R27): «GAM» es la zona `esCentral`
(columna que la 54 renombró desde `es_gam`, `CierresAdminRepository.ts:656-660`), y sus
cierres entran por el `destinoTipo: "bodega_central"` que el alcance del maestro ya fija. No se
escribe ni un `if` sobre `esCentral` en esta feature.

### 2.7 Los dos métodos de repositorio

**A · `CierresAdminRepository.findGestionesPorAlcanceCompleto(alcance, filtros)`**

Misma mecánica que `findCierreByIdEnAlcance:733-755` —dos consultas, `gestion_orden` +
`cierre_detail`, unidas por `ordenId`, con `CierreDetalleFaltanteError` como error DURO si
falta la fila congelada— pero:

- `where` de las gestiones: `{ cierre: { ...alcanceWhere(alcance), ...recortes } }` — **el
  alcance en el WHERE, vía la relación**, exactamente como ya hace
  `findGestionesIncidenteDelCierre` (`:507-517`);
- `orderBy`: `[{ cierre: { solicitadoAt: "desc" } }, { createdAt: "desc" }]` — la primera clave
  es `ORDEN_CIERRES_ADMIN` (`:417`) elevada a la relación, la segunda la que ya usa el detalle
  (`:736`). R11;
- `select`: añade `cierre.mensajero.nombre` y `cierre.solicitadoAt`. **No** selecciona
  `evidenciaStoragePath` (R41).

**B · `CierresBodegaAdminRepository.findGestionesDeCierresBodegaCompleto(filtros)`**

Reusa `GESTION_ADMIN_SELECT`, `DETALLE_ADMIN_SELECT` y `toPendienteRowDesdeSnapshot`, que ese
repositorio ya importa (`CierresBodegaAdminRepository.ts:321-342`), pero **sin el bucle por
cierre_dia**: una sola consulta con

```
where: { cierre: { cierreBodegaId: { not: null }, ...recortes } }
orderBy: [{ cierre: { solicitadoAt: "desc" } }, { createdAt: "desc" }]
```

`cierreBodegaId: { not: null }` es la traducción exacta de R24 («los cierres del día
consolidados en un cierre de bodega, y ninguna otra gestión»). No hay alcance por zona que
aplicar: ese listado es de acceso total (`ICierresBodegaAdminService.ts:49-50`).

**En ninguno de los dos se reusa el método por id en bucle:** serían N+1 consultas y, en el de
cierres del día, N lotes de firma de URL.

---

## 3. Los bordes (Server Actions) y la lista blanca

### 3.1 Un schema NUEVO y dedicado, no `filtrosCierresSchema`

D11 hace que esta descarga sea **independiente de la barra de filtros**, y D9 quita «Destino»
de la hoja. Consecuencia: la entrada de esta lectura NO es `FiltrosCierres`
(`lib/types/filtros-cierres.ts:73-76`), porque `destinoZonaIds` no tiene ningún papel aquí y
un `.strict()` debe **rechazarla**, no aceptarla y no usarla.

```ts
// lib/types/filtros-cierres.ts (añadido, reusando sus propias primitivas)
export const filtrosDescargaGestionesSchema = z
  .object({ mensajeroIds: listaDeIds, desde: fechaCalendario.optional(), hasta: fechaCalendario.optional() })
  .strict()
  .refine(rangoCoherente, MENSAJE_RANGO);          // R32

export type FiltrosDescargaGestiones = z.infer<typeof filtrosDescargaGestionesSchema>;
```

Se declara **en el mismo módulo** y desde las **mismas primitivas** (`listaDeIds` `:34-38`,
`fechaCalendario` `:30-32`, `rangoCoherente`/`MENSAJE_RANGO` `:62-67`) por el motivo que ese
archivo ya escribe para el schema de bodega (`:88`): *«el día que las fechas cambien de
criterio, cambian para todos los listados a la vez»*.

`FiltrosDescargaGestiones` es un subconjunto estructural de `FiltrosCierres`, así que
`filtrosWhere` se reusa sin tocarlo.

> **Punto que hay que leer, no asumir:** el 2026-08-16 se decidió que los listados de bodega
> **no** llevan filtro de mensajero (`lib/types/filtros-cierres.ts:78-88`), y el motivo escrito
> es que *«un cierre de bodega consolida los cierres del día de VARIOS mensajeros, así que ‹el
> mensajero de este cierre› no es una pregunta con respuesta»*. **Esto no lo contradice.** Esa
> decisión es sobre el LISTADO, cuyas filas son cierres de bodega. Aquí el grano es la GESTIÓN,
> y toda gestión pertenece a exactamente un cierre del día, que tiene exactamente un mensajero.
> La pregunta sí tiene respuesta a este grano.

### 3.2 Las dos Server Actions

Hermanas exactas de `listarPendientesCierresAdminCompleto`
(`lib/actions/cierres-admin.ts:216-228`), una en `lib/actions/cierres-admin.ts` y otra en
`lib/actions/cierres-bodega-admin.ts`:

```ts
export async function listarGestionesCierresAdminCompleto(
  input: unknown = {},
  deps: CierresAdminDeps = {},
): Promise<ListarGestionesDescargaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();               // R17, ANTES de validar
    const data = filtrosDescargaGestionesSchema.parse(input);    // R19 / R32
    const service = deps.service ?? buildService();
    return service.listarGestionesCierresAdminCompleto(actor, data);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}
```

**Server Action, no `app/api/`**: R3/R4 de la 134 lo prohíben y el archivo se arma en el
navegador (`components/shared/DescargarDatasetButton.tsx:103-113`).

---

## 4. El diálogo y la «puerta única» — qué se cede y qué NO (D11)

**El spec anterior justificaba la compatibilidad diciendo que el objeto que viaja al borde es
`{ ...filtrosDePantalla, mensajeroIds: seleccion }`. Con D11 eso ya no es cierto y el argumento
hay que rehacerlo. Se rehace, y se dice qué se cede.**

La «puerta única» de las features 134/184 tiene dos mitades
(`specs/134-analitica-export-csv/requirements.md:23-39`):

- **R1 de la 134 — fuente única:** las filas salen exclusivamente de una Server Action, nunca
  de un módulo de export que arme el dataset por su cuenta.
- **R2 de la 134 — mismo filtro que el panel:** el export envía el MISMO `raw` derivado del
  MISMO objeto de filtro que la pantalla usa para pintar.

**Lo que esta feature CUMPLE, y sin excepción:**

1. **Fuente única (R13).** Cada pantalla tiene UN punto de entrada; el módulo de columnas no
   importa servicio, repositorio ni Prisma, y no existe ruta `app/api/`. Guardia en T6.1.
2. **El alcance lo resuelve el servicio desde la sesión y se compone con `AND` (R14/R15/R16).**
   Esto es **innegociable y no cambia**. El diálogo no puede ensanchar nada: un `mensajeroIds`
   de otra zona se cruza con `alcanceWhere` y da vacío (R37), que es la doctrina que
   `lib/types/filtros-cierres.ts:1-20` ya tiene escrita y que
   `tests/unit/guards/filtros-cierres-alcance.guardia.test.ts` fija.
3. **La entrada pasa por una lista blanca `.strict()`** validada en el borde (R19).

**Lo que esta feature CEDE, por decisión explícita del humano:**

> **La mitad R2 de la puerta única —«el archivo es lo que la pantalla enseña»— NO se cumple en
> la descarga detallada, y es deliberado (D11).** El conjunto no se deriva del estado de la
> pantalla: lo redacta el usuario en el diálogo.

Y hay que decir por qué eso **no es el fallo que la puerta única vino a evitar**. Lo que aquel
patrón prohíbe es que el borde de descarga **reconstruya** el filtrado —que adivine, a partir
de la pantalla, un criterio equivalente-pero-no-idéntico, y acabe entregando un conjunto que
nadie ha visto y que nadie puede auditar—. Aquí no se reconstruye nada: **no hay ningún
criterio de pantalla que replicar**, porque la descarga detallada es, por diseño, otra pregunta
a otro grano (gestiones, no cierres). El riesgo de divergencia silenciosa entre «lo que veo» y
«lo que bajo» desaparece porque **nunca se afirma que sean lo mismo**: el diálogo es explícito
sobre qué se va a llevar.

**Consecuencia obligada, y por eso R31 existe:** si la descarga no hereda las fechas de la
pantalla, sin controles propios de fecha el conjunto por defecto sería *todo el histórico de
ese mensajero*, que a grano de gestión choca contra el tope de 5000 (R21) casi de inmediato y
convierte la feature en un botón que solo sabe fallar. **El diálogo lleva sus propios `desde` /
`hasta`.**

**El diálogo NO lleva selector de bodega**, y no es un olvido: D9 quitó «Destino» de la hoja, y
en cada pantalla el eje de zona ya está determinado por el alcance —en `cierres-admin` del
maestro todo es la central (§2.6); en cierres de bodega el listado es de acceso total—. Un
control que no discrimina es peor que no ofrecerlo, que es literalmente el criterio que
`CierreBodegaRepository.ts:134-137` ya dejó escrito.

---

## 5. Módulos nuevos y tocados

| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts` | **NUEVO.** `COLUMNAS_DESCARGA_GESTIONES_FUNDIDA` + `filaDescargaGestionFundida`. PURO (R49). En un `*-descarga-columnas.ts` propio por R48 / `columnas-sensibles.guardia.test.ts:73-97`. **Una sola declaración para las dos pantallas** (R26). |
| `app/(app)/cierres-admin/_components/DescargarGestionesDialog.tsx` | **NUEVO.** Diálogo (mensajeros + rango) y control. Cliente, sin dominio. Compartido por las dos pantallas. |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | `RESULTADO_FILA_LABEL` (singular). Ver §6.1. |
| `app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas.ts` | **Solo la cabecera** (R52). Ver §8. Ni una línea de código. |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | Monta el control junto al general. |
| `app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx` | Idem, en el listado de cierres de bodega. |
| `lib/types/filtros-cierres.ts` | `filtrosDescargaGestionesSchema` + `FiltrosDescargaGestiones`. |
| `lib/interfaces/services/ICierresAdminService.ts` | `CierreGestionDescargaDTO`, el result y el método. |
| `lib/interfaces/services/ICierresBodegaAdminService.ts` | El método de bodega (importa el DTO). |
| `lib/interfaces/repositories/ICierresAdminRepository.ts` · `ICierresBodegaAdminRepository.ts` | Los dos métodos. |
| `lib/services/CierresAdminService.ts` · `CierresBodegaAdminService.ts` | Implementaciones (reusan su guard y el bloque del tope). |
| `lib/repositories/CierresAdminRepository.ts` · `CierresBodegaAdminRepository.ts` | Los dos métodos de consulta. |
| `lib/actions/cierres-admin.ts` · `lib/actions/cierres-bodega-admin.ts` | Las dos Server Actions. |

**Nada de esto toca `middleware.ts`, `prisma/schema.prisma` ni `app/api/`.**

---

## 6. La hoja fundida — 26 columnas (D6 · D7 · D8 · D9). DECIDIDA

Los encabezados se **leen** de `cierre-labels.ts:67-83`, no se teclean, para que la pantalla y
el archivo no puedan decir cosas distintas (`cierre-labels.ts:10-11`).

| # | `clave` | Encabezado | Origen |
| --- | --- | --- | --- |
| 1 | `mensajero` | Mensajero | `mensajeroNombre` |
| 2 | `fechaCierre` | Fecha del cierre | `fechaDiaISO(cierreSolicitadoAt)` |
| 3 | `numGuia` | Nº Guía | `numGuia` |
| 4 | `numRemision` | Nº Remisión | `numRemision` |
| 5 | `destinatario` | Destinatario | `destinatario` |
| 6 | `direccion` | Dirección | `direccion` |
| 7 | `ubicacion` | Ubicación | zona · provincia · cantón · distrito |
| 8 | `producto` | Producto | `producto` |
| 9 | `tienda` | Tienda | `tiendaNombre` |
| 10 | `resultado` | Resultado | `RESULTADO_FILA_LABEL[resultado]` |
| 11 | `montoCobrar` | A cobrar | `ingresoOrdenex.montoCobrar` |
| 12 | `recibido` | Recibido | `montoRecibido` |
| 13 | `metodo` | Método | `desgloseDescarga(pagos)` |
| 14 | `nuevaFecha` | Nueva fecha | `fechaReprogramacion` |
| 15 | `origenRechazo` | Origen | `RECHAZO_SLA/MANUAL_BADGE_LABEL` |
| 16 | `causa` | Causa | `CAUSA_INCIDENTE_LABEL[causaIncidente]` |
| 17 | `motivo` | Motivo | `motivo` |
| 18 | `fleteConIva` | Flete + IVA | `ingresoOrdenex.fleteConIva` |
| 19 | `comisionConIva` | Comisión + IVA | `ingresoOrdenex.comisionConIva` |
| 20 | `fleteDevolucion` | Flete devolución | `ingresoOrdenex.fleteDevolucion` |
| 21 | `ivaFleteDevolucion` | IVA flete dev. | `ingresoOrdenex.ivaFleteDevolucion` |
| 22 | `fleteDevolucionConIva` | Flete devolución + IVA | `ingresoOrdenex.fleteDevolucionConIva` |
| 23 | `ingresoTotal` | Total Ordenex | `ingresoOrdenex.total` |
| 24 | `pagoMensajero` | Pago mensajero | `pagoMensajero` |
| 25 | `ingresoBodega` | Ingreso bodega | `ingresoBodegaRechazo` |
| 26 | `indemnizacion` | Indemnización | `indemnizacion` |

**26 columnas.** Las diez primeras se pueblan SIEMPRE; las dieciséis restantes son específicas.

| Resultado | Específicas POBLADAS | Específicas VACÍAS |
| --- | --- | --- |
| entregada | 11, 12, 13, 18, 19, 23, 24 | 14, 15, 16, 17, 20, 21, 22, 25, 26 |
| reprogramada | 11, 14, 17, 24 | 12, 13, 15, 16, 18, 19, 20, 21, 22, 23, 25, 26 |
| devuelta | 11, 17, 20, 21, 23, 24 | 12, 13, 14, 15, 16, 18, 19, 22, 25, 26 |
| rechazada | 11, 15, 17, 22, 23, 24, 25 | 12, 13, 14, 16, 18, 19, 20, 21, 26 |
| incidente | 11, 16, 17, 26 | 12, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24, 25 |

**Lo que hay que leer y no deducir:**

- **No hay columna de evidencia** (D8, R40). Se retiró entera; no es que quede vacía.
- **Flete de devolución: las tres columnas, cada una fiel a su sección** (D7). La devuelta
  puebla el par partido (20, 21), que es lo que su tabla enseña
  (`cierre-detalle-shared.tsx:954-955`); la rechazada puebla el agrupado (22), que es lo que
  enseña la suya (`:968-972`). Es la lectura fiel a R24 de la 170 («no se emite lo que la
  pantalla no muestra»). *La otra lectura posible de D7 —poblar las tres en ambos resultados—
  se anota en §12 como el único punto donde la respuesta admitía dos lecturas.*
- **#11 `montoCobrar`** aplica a los cinco resultados, pero es `null` cuando la orden no tenía
  tarifa vigente al solicitar (`ingresoOrdenex === null`, gap conocido de la feature 69,
  `ICierreDiaService.ts:136-139`) ⇒ celda vacía, R46.
- **#26 `indemnizacion`:** `null` es celda **vacía y NUNCA cero** (R47). El monto lo captura el
  admin al aprobar; un `0` diría «no se indemniza», que es lo contrario
  (`cierre-gestiones-descarga-columnas.ts:232-238`, `ICierreDiaService.ts:85-100`).
- Un incidente **no** paga al mensajero (#24 vacía) ni genera ingreso de bodega (#25 vacía):
  `cierre-detalle-shared.tsx:899-903` lo declara.

### 6.1 `RESULTADO_FILA_LABEL` — por qué hace falta

`RESULTADO_LABEL` (`cierre-labels.ts:19-25`) está en **plural** («Entregadas»): nombra la
SECCIÓN. Una celda por fila necesita el singular. Se añade un segundo mapa al mismo módulo —no
se reusa el plural ni se derivan cadenas quitando la «s»— y se cubre con su propio caso. R45
exige que la celda sea la etiqueta, jamás el value del enum.

---

## 7. Los dos puntos de entrada en la UI (D10)

**Ambos usan el MISMO componente de diálogo, la MISMA declaración de columnas y la MISMA
proyección** (R26). Lo único que cambia es qué Server Action se le pasa.

- **`cierres-admin`** (`CierresAdminModule.tsx`): control junto al general que ya monta
  `descargaColaCierres` (`:192-202`), visible en las dos pestañas. Cubre las gestiones de la
  **GAM** (§2.6).
- **Cierres de bodega del maestro** (`CierresBodegaAdminModule.tsx`): control en la cabecera
  del listado, junto a los suyos. Cubre las gestiones de las **bodegas satélite** ya
  consolidadas.

**Lista de mensajeros del diálogo, en las dos:** `obtenerCatalogoFiltrosCierres`
(`lib/actions/cierres-admin.ts:239-249` → `CierresAdminService.ts:360-371` →
`CierresAdminRepository.findCatalogoFiltros:674-711`). Ya viene acotada al alcance del actor y,
para un actor de acceso total, trae **todos** los mensajeros sin filtrar por zona ni por estado
(`:691-698` y el porqué en `:662-666`: un mensajero dado de baja sigue siendo dueño de sus
cierres pasados). R29 sin una consulta nueva y sin caso especial para la GAM.

- Confirmar llama a `DescargarDatasetButton` con
  `obtenerFilas: () => filasDesdeResultado(<la acción de esa pantalla>({ ...seleccion }), filaDescargaGestionFundida)`
  — el mismo adaptador que ya usa la general (`CierresAdminModule.tsx:196-200`), que traduce
  `limite_excedido`, `forbidden` y `unauthenticated` a mensajes accionables. **De ahí sale D12
  gratis:** «sin cierres» y «fuera de alcance» llegan los dos como `{ ok, items: [] }` y el
  botón muestra el mismo `MENSAJE_SIN_DATOS`
  (`components/shared/DescargarDatasetButton.tsx:50-51`, `:99-102`). No hay rama que los
  distinga, que es exactamente lo que R38 pide.
- `titulo`: `"Gestiones de cierres"` → hoja saneada y archivo
  `gestiones-de-cierres-YYYY-MM-DD.xlsx` (`lib/utils/descarga-dataset.ts:96-106`, `:123-129`).
  Distinto del de la general, R51.
- Cancelar o confirmar con cero mensajeros **no llama al borde** (R39).

**`ConsolidacionBodegaModule` (adminSatelite) queda fuera**, y se dice explícitamente: D10
nombra «cierres de bodega», y la pantalla que monta `DetalleSecciones` por mensajero —la que el
humano describió— es `CierresBodegaAdminModule` (`:595-602`). La de consolidación no monta
ninguna (comprobado: `DetalleSecciones` solo aparece en ese módulo). El `adminSatelite` sigue
teniendo su descarga detallada por el botón de `cierres-admin`, donde su alcance es su zona.

---

## 8. La prosa de la cabecera de la 170 (R52)

`cierre-gestiones-descarga-columnas.ts:6-10` dice hoy:

> *«**Una declaración POR SECCIÓN, y una descarga por sección** (decisión del humano, P2
> ratificada). No hay un archivo único del cierre porque las cinco secciones no comparten
> columnas… Fundirlas daría una hoja llena de celdas vacías que nadie sabría leer.»*

Con esta feature esa afirmación queda **falsa**. Se reescribe **sin borrar la razón
histórica**, en esta forma (texto exacto propuesto):

> *«**Una declaración POR SECCIÓN, y una descarga por sección** (decisión del humano, P2 de la
> feature 170). Cada sección declara sus columnas porque las cinco no comparten las
> específicas: una entrega lleva método de pago y comisión; una reprogramación, la fecha nueva;
> un rechazo, el origen y el ingreso de bodega; un incidente, la causa y la indemnización.
> Fundirlas da una hoja con celdas vacías, y ése fue el motivo de no hacerlo aquí.*
>
> ***Feature 230 (2026-08-18): ese archivo único AHORA EXISTE**, en
> `cierres-gestiones-fundida-descarga-columnas.ts`, y su punto de entrada es otro: cruza los
> cierres de varios mensajeros desde los listados, no una sección de un cierre abierto. El
> humano vio el ejemplo con las celdas vacías y aceptó el coste para ESE caso de uso. **Las
> cinco descargas de este módulo NO se retiran** —siguen siendo la salida estrecha y legible de
> un cierre concreto—, así que lo de arriba sigue explicando por qué existen cinco y no una.
> La marca de evidencia (`TIENE_EVIDENCIA_*`, `tieneEvidencia`) es de ELLAS: la hoja fundida no
> lleva columna de evidencia en absoluto.»*

---

## 9. Alternativas descartadas

### 9.1 Un libro Excel de CINCO HOJAS, una por resultado (descartada por el HUMANO, D3)

Conserva las columnas estrechas y evita toda celda vacía. **Descartada:** el humano eligió el
archivo único con el ejemplo de las celdas vacías delante. Técnicamente además cuesta:
`construirDescarga` produce **una sola hoja** (`lib/utils/descarga-dataset.ts:174-180`;
`nombreHoja` documenta *«cada archivo lleva UNA sola hoja»*, `:88-95`), así que un libro
multi-hoja obliga a tocar el generador COMÚN de ~35 descargas. Y no resuelve el problema real:
cruzar cierres.

### 9.2 Heredar el filtro de mensajero de la pantalla (descartada por el HUMANO, D5)

Cero UI nueva. **Descartada:** el filtro de pantalla también recorta el LISTADO, así que para
descargar tres mensajeros habría que dejar la pantalla filtrada a esos tres — se cambia lo que
se ve para poder descargar.

### 9.3 Heredar los filtros de fecha y bodega de la pantalla (descartada por el HUMANO, D11)

Era la propuesta del spec anterior (R29 antiguo) y habría hecho trivial la mitad R2 de la
puerta única. **Descartada:** el humano quiere la detallada del todo independiente. El coste
está asumido y documentado en §4, y obliga a R31 (controles de fecha propios).

### 9.4 Una sola columna «Flete devolución + IVA» agrupada (descartada por el HUMANO, D7)

Quitaba dos columnas de una hoja ya ancha y no requería aritmética. **Descartada:** el humano
quiere el desglose de IVA de las devoluciones, tal como su sección lo muestra hoy. La hoja
sube de 24 a 26 columnas por esta decisión y por la retirada de la evidencia.

### 9.5 «Tiene evidencia» poblada solo en rechazadas e incidentes (descartada por el HUMANO, D8)

Era la propuesta Q1.b del spec anterior, fiel a R24 de la 170. **Descartada:** dejaba una
entrega CON foto con la celda vacía, que se lee como «no tiene».

### 9.6 «Tiene evidencia» poblada en los cinco resultados (descartada por el HUMANO, D8)

Era la alternativa que se ofreció junto a la anterior. **Descartada:** emite en el archivo un
dato que la pantalla no muestra para tres de los cinco resultados (R24 de la 170). El humano
eligió una tercera vía —retirar la columna— que no tiene ninguno de los dos problemas.

### 9.7 Reusar `CierreDetalleGestion` con `evidenciaUrl: null` (descartada, técnica)

Ver §2.5: un `null` por convención no lo sostiene ninguna guardia; un campo ausente del tipo
sí. Con D8 el argumento se refuerza: ni siquiera hay booleano derivado.

### 9.8 Un servicio nuevo `ICierreGestionesDescargaService` (descartada, técnica)

Tendría que reimplementar `resolveAlcance` y `esAccesoTotal` y redeclarar los `where`. Es lo
que R16 prohíbe, y `CierresAdminRepository.ts:442-451` documenta el fallo que aparece cuando
dos mitades dejan de leer la misma constante.

### 9.9 UN solo borde para las dos pantallas (descartada, técnica — y era mi hipótesis previa)

Parecía lo natural hasta medir §2.6. **Descartada:** los dos alcances no son comparables —uno
filtra por `destinoTipo` desde la sesión, el otro es acceso total sobre `cierreBodegaId != null`—
y unificarlos exigiría un parámetro que dijera «dame el otro conjunto», es decir, alcance
viajando en la entrada. Justo lo que R15 prohíbe.

### 9.10 Llamar a `verCierreDetalle` en bucle desde el cliente (descartada, técnica)

N consultas + N lotes de firma de URL (`CierresAdminService.ts:388-408`) para tirar todas las
URL después. Rompe R13 y R22.

---

## 10. Riesgos conocidos

1. **Volumen.** A grano de gestión el tope de 5000 se alcanza mucho antes que a grano de
   cierre. D13 lo ratifica tal cual, y R21 lo convierte en un error accionable, nunca en un
   truncado — pero el usuario lo verá. **R31 (rango de fechas en el diálogo) es la mitigación
   de producto**, no un adorno: sin él, el conjunto por defecto es todo el histórico.
2. **`CierreDetalleFaltanteError`.** Los dos repositorios lanzan duro si una gestión no tiene
   su fila congelada (`CierresAdminRepository.ts:750-753`,
   `CierresBodegaAdminRepository.ts:339-341`). Al cruzar cierres, **un** cierre corrupto tumba
   la descarga entera. Se conserva ese criterio a propósito (no se inventa un fallback que
   muestre datos vivos disfrazados de congelados) y se documenta como riesgo aceptado. El
   riesgo **crece** con esta feature: antes afectaba a un cierre abierto a mano; ahora a un
   rango de meses.
3. **Hoja ancha: 26 columnas.** Es el coste que el humano aceptó en D3, subido por D7 (tres
   columnas de flete de devolución en vez de una).
4. **NUEVO, por D10 — dos caminos que deben decir lo mismo.** Dos servicios, dos repositorios y
   una sola declaración de columnas. El riesgo es que uno de los dos derive (un `orderBy`
   distinto, un `select` que se queda corto) y el mismo mensajero salga con filas distintas
   según desde dónde se descargue. **Mitigación exigida por R26 y verificada en T6.3:** un test
   que ejecuta los dos caminos sobre datos equivalentes y compara la fila producida.
5. **NUEVO — el usuario tiene que saber qué botón usar.** §2.6 significa que en `cierres-admin`
   el maestro no encontrará a un mensajero de zona satélite, y en bodega no encontrará a uno de
   la GAM. El diálogo ofrece **todos** los mensajeros en ambos sitios (el catálogo es de acceso
   total), así que elegir el equivocado devuelve «no hay datos» sin explicar por qué. **Es
   producto, no código, y hay que decidirlo:** ver §12.

---

## 11. Sobre el tamaño de la feature

La ficha está dada de alta como `complexity: medium`. Con D10 y D11 el trabajo real es:
**2 bordes de lectura + 2 métodos de servicio + 2 métodos de repositorio + 1 schema nuevo +
1 declaración de columnas + 1 diálogo con controles propios + 2 montajes de UI**, más ~15
casos de test y 3 guardias.

**Recomendación:** subir la ficha a `complexity: high`, o partirla en dos entregas —
`cierres-admin` (tandas 1-6) y bodega (tanda 7)— con la segunda dependiendo de la primera. Las
tandas de `tasks.md` ya están cortadas para permitirlo.

---

## 12. Lo único que quedó sin cerrar del todo

No es una pregunta nueva: son dos puntos donde el spec no puede avanzar sin inventar.

- **§6, lectura de D7.** «Se conservan las TRES columnas… descarta la columna agrupada» admite
  dos lecturas, porque las tres columnas de hoy INCLUYEN la agrupada. Se implementa la lectura
  **fiel a cada sección** (devuelta → par partido; rechazada → agrupada), que es la que respeta
  R24 de la 170 y la que hace que las tres columnas existan. La otra lectura —poblar las tres
  en ambos resultados— cambiaría solo dos celdas de la tabla de §6 y **no bloquea**: si el
  humano la prefiere, es una corrección de una línea en T3.1 y dos en su test.
- **§10.5, el desenlace «no hay datos» cuando el mensajero está en la otra partición.** No se
  inventa un aviso: hoy el desenlace es el `MENSAJE_SIN_DATOS` genérico, y eso es coherente con
  D12 (no distinguir). Si el humano quiere que el diálogo de cada pantalla ofrezca solo los
  mensajeros de SU partición, eso **sí** es una decisión suya, y tiene un coste: el catálogo
  actual no distingue `destinoTipo`, así que habría que ampliarlo.
