# Feature 151 — Descarga del dataset completo desde el DataTable · design

> El QUÉ está en `requirements.md`. Aquí van las decisiones técnicas: reparto
> cliente/servidor, contratos, capas, tope y alternativas descartadas.
> Todas las rutas y símbolos citados fueron verificados leyendo el archivo real en el
> worktree `feature/151-descarga-datatable`.

## §0 — Decisiones ya cerradas por el humano (no se reabren)

| # | Decisión |
| --- | --- |
| D1 | El generador es una FUNCIÓN COMÚN, indiferente de filtros y dominio: recibe `{tipo, título, columnas, datos}` y devuelve el contenido. |
| D2 | Ese generador YA EXISTE casi entero y se REUSA: `buildXlsxRows` en `lib/utils/xlsx-template.ts`, `lib/utils/csv-template.ts`, `components/shared/descargar-blob.ts`. Lo nuevo es solo un despachador delgado por tipo. Default `xlsx`. |
| D3 | El acceso sin paginación pasa por el MISMO servicio que lista (`OrdenService.listar` y equivalentes), para heredar autorización y acotamiento por rol/zona. No se duplica la query ni se consulta el repositorio por fuera del servicio. |
| D4 | Enganche en `components/shared/DataTable.tsx` como prop opt-in `descarga?: { titulo, columnas, obtenerFilas, formatos? }`. Se pasa una FUNCIÓN, no una url ni el objeto de filtros. |
| D5 | Las columnas del export se declaran APARTE, con valor CRUDO. No se reusa `Column<T>`. |
| D6 | TOPE DURO de filas con error explícito. Nunca truncado silencioso. |

Justificación de D4 que el diseño debe dejar por escrito:

1. **El repo no expone los listados por route handler.** Verificado: los únicos
   `app/api/**/route.ts` son `cron/*` (6), `webhooks/whatsapp`, `docs/openapi`,
   `ordenes/api-key/*` (API pública por api-key) y `ordenes/carga-masiva/chunk` (lote de
   filas JSON, no un listado). `docs/architecture.md` fija la tabla: mutación interna →
   Server Action; webhook/API pública/cron → Route Handler. Un listado interno no tiene
   ruta que pegarle a un `<a href>`.
2. **`DataTable` es genérico sobre `T` y tiene decenas de consumidores** con filtros de
   forma distinta (`OrdenesFilterUI` es `Partial<Record<OrdenFilterField, string |
   string[] | boolean>>`, pero otras tablas ni siquiera tienen filtros). Recibir los
   filtros obligaría a la tabla a serializarlos y a saber a qué action llamar: se
   acoplaría al dominio y rompería su contrato actual («UI pura, data-driven, sin
   dominio», comentario del propio componente). Con `obtenerFilas`, el consumidor cierra
   sobre sus propios filtros y la tabla sigue sin saber nada.

Justificación de D5, comprobada en el código: `Column<T>.render` es
`((row: T) => ReactNode) | keyof T | string` (`components/shared/DataTable.tsx:41`) y las
columnas reales del listado devuelven insignias y botones (`ordenes-columns.tsx`: `estatus`,
`mensajero`, `tiempo`…). Un `ReactNode` no es una celda de hoja de cálculo.

---

## §1 — Punto abierto RESUELTO: quién arma el binario y cómo viaja

**Decisión: el SERVIDOR devuelve FILAS; el NAVEGADOR arma el archivo.** No viaja ningún
binario por el cable, ni en base64 ni por streaming.

Evidencia del repo (patrón vigente, no invención):

- Feature 148: `lib/actions/manifiesto.ts > obtenerManifiesto` devuelve **filas**
  (`ManifiestoResult`), y `components/shared/DescargarManifiestoButton.tsx` importa
  dinámicamente `lib/utils/manifiesto-xlsx.ts`, llama a `buildManifiestoXlsx(result.filas)`
  y descarga con `descargarBlob(buffer, XLSX_MIME, nombre)`. El comentario del módulo lo
  dice explícitamente: «el binario se arma en el NAVEGADOR (design.md §0/D1), nunca en el
  servidor ni en almacenamiento».
- Feature 143: `carga-masiva-export-errores.ts` compone las filas en el cliente y delega el
  binario a `buildXlsxRows`.
- `exceljs` se importa **dinámicamente dentro de la función** (`xlsx-template.ts:96` y
  `:215`) justo para no entrar en el bundle inicial: ese diseño solo tiene sentido en el
  cliente.

Consecuencias y encaje con D2/D3/D6:

- **D2 se cumple sin tocar nada**: `buildXlsxRows` ya es agnóstico, ya calcula anchos, ya
  ignora claves no declaradas. Si el binario se generara en el servidor habría que revisar
  `exceljs` en runtime Node de Vercel y su coste de memoria por request.
- **D3 se cumple igual**: el servidor sigue siendo el que autoriza y acota; lo que devuelve
  son filas ya filtradas por rol.
- **D6 se cumple mejor**: el tope se aplica **antes** de transportar nada, sobre el
  `total` que el repositorio ya cuenta. Nunca se serializa un dataset gigante.
- **Cero infraestructura nueva**: sin route handler interno, sin `Content-Disposition`, sin
  base64 (que inflaría el payload ~33 %), sin almacenamiento temporal.
- **R32 se cumple por construcción**: el archivo nace y muere en el navegador.

### Alternativas descartadas

**A1 — Binario en el servidor, transportado en base64 por la Server Action.**
Descartada: infla el payload un 33 % sobre un binario que ya es grande, obliga a
decodificar en el cliente igualmente, mete `exceljs` en el bundle de servidor y deja el
pico de memoria del libro en la función serverless (justo lo que el tope quiere evitar).
Además rompe la simetría con 143/148, que ya generan en el navegador.

**A2 — Route Handler `app/api/descargas/...` con streaming y `Content-Disposition`.**
Descartada: sería el primer route handler interno de lectura de la aplicación, contra la
tabla de `docs/architecture.md` (`app/api/` = webhook / API pública / cron). Obligaría a
serializar los filtros a query string —exactamente lo que D4 prohíbe— y a duplicar en el
handler la resolución de actor y la lista blanca de filtros que hoy vive en el borde de las
Server Actions. El beneficio real (streaming de decenas de miles de filas) queda anulado
por D6: con tope duro nunca hay un dataset lo bastante grande como para necesitarlo.

**A3 — Exportar solo lo que el cliente tiene en memoria (la página visible).**
Descartada por el planteamiento del problema: `OrdenService.listar` pagina server-side
(`skip = (page - 1) * pageSize`, `take = pageSize`, `OrdenService.ts:269-276`), así que
serían 20 filas de 3000.

**A4 — Consultar el repositorio directamente desde una action de export.**
Descartada por D3: `OrdenService.listar` es quien escribe el acotamiento por rol AL FINAL
del `where` para que pise cualquier `filter` inyectado (`OrdenService.ts:262-267`,
comentario de la feature 144/R36). Saltárselo reabre la fuga que ese código cerró.

---

## §2 — Piezas nuevas y piezas reutilizadas

| Pieza | Ruta | Estado |
| --- | --- | --- |
| Tipos de la descarga | `lib/types/descarga.ts` | NUEVO |
| Despachador por tipo | `lib/utils/descarga-dataset.ts` | NUEVO (delgado) |
| Generador `xlsx` de filas | `lib/utils/xlsx-template.ts > buildXlsxRows` | REUSO, sin cambios |
| MIME xlsx | `lib/utils/xlsx-template.ts > XLSX_MIME` | REUSO |
| Generador `csv` de filas | `lib/utils/csv-template.ts > buildCsvRows` | **NUEVO dentro de un módulo existente** (ver §4.2) |
| Side effect de descarga | `components/shared/descargar-blob.ts > descargarBlob` | REUSO, sin cambios |
| Prop `descarga` + control | `components/shared/DataTable.tsx` (+ `components/shared/DescargarDatasetButton.tsx`) | NUEVO |
| Config del tope | `lib/config/descarga.ts` | NUEVO |
| Modo sin paginación | `lib/services/OrdenService.ts` + `lib/interfaces/services/IOrdenService.ts` | AMPLIACIÓN |
| Schema del modo completo | `lib/types/orden.ts` | AMPLIACIÓN |
| Borde | `lib/actions/ordenes.ts` | AMPLIACIÓN |
| Columnas de export de órdenes | `app/(app)/ordenes/_components/ordenes-descarga-columnas.ts` | NUEVO |
| Cableado del consumidor | `app/(app)/ordenes/_components/OrdenesModule.tsx` y `OrdenesListado.tsx` | AMPLIACIÓN |

**Sin modelo de datos nuevo.** Esta feature NO crea tablas, NO altera columnas, NO añade
índices y NO tiene migración Prisma (y por tanto tampoco `down.sql`). El acceso al dato es
el mismo `OrdenRepository.list` que ya usa el listado. No hay cambios de RLS porque no hay
tabla nueva ni superficie de lectura nueva: el dataset completo es el mismo conjunto de
filas que el actor ya puede leer paginado.

---

## §3 — Contrato de la función común (capa `lib/utils`, pura)

```ts
// lib/types/descarga.ts
export type DescargaTipo = "xlsx" | "csv";

/** Celda de export: valor CRUDO. Espejo deliberado de XlsxCellValue (D5). */
export type DescargaCelda = string | number | null;

/** Columna de export declarada aparte de Column<T> (D5). */
export interface DescargaColumna {
  clave: string;
  encabezado: string;
}

export type DescargaFila = Record<string, DescargaCelda>;

export interface DescargaConfig {
  tipo?: DescargaTipo;            // R2: ausente => "xlsx"
  titulo: string;                 // R8: hoja + base del nombre de archivo
  columnas: DescargaColumna[];    // R5/R9
  filas: DescargaFila[];
}

export interface DescargaArchivo {
  contenido: ArrayBuffer | string; // R7
  mime: string;
  nombreArchivo: string;
}
```

```ts
// lib/utils/descarga-dataset.ts
export async function construirDescarga(config: DescargaConfig): Promise<DescargaArchivo>;
```

Comportamiento:

- `columnas.length === 0` → `throw` explícito (R9), mismo contrato defensivo que
  `buildXlsxTemplate`/`buildXlsxRows`/`buildCsvTemplate`.
- `tipo ?? "xlsx"` (R2).
- `xlsx` → `buildXlsxRows(columnas.map(c => ({ key: c.clave, header: c.encabezado })),
  filas, titulo)`; MIME `XLSX_MIME` (R3, R5, R6, R8).
- `csv` → `buildCsvRows(...)`; MIME `text/csv;charset=utf-8` (R4).
- `nombreArchivo` = `slug(titulo)-YYYY-MM-DD.<ext>`, con la fecha recibida por parámetro
  opcional para ser determinista en test (patrón `nombreArchivoErrores(fecha: Date)` de la
  feature 143 y `manifiestoFileName` de la 148).
- Sin DOM ni React (R10). El side effect vive en `descargarBlob`.
- R5/R6 se heredan del generador reusado: `buildXlsxRows` solo emite las columnas
  declaradas y escribe `row[column.key] ?? null` (celda vacía).

### §3.1 — `buildCsvRows`: lo que NO existe hoy

Hecho verificado: `lib/utils/csv-template.ts` solo exporta `buildCsvTemplate(fields)`, que
emite cabecera + **una** fila de ejemplo. NO hay generador CSV de N filas de datos. Se
añade `buildCsvRows(columns, rows)` como HERMANO en el mismo módulo, reutilizando
`escapeCsvValue`/`toCsvRow` (privadas del módulo) y el mismo `ROW_DELIMITER`. Es
exactamente el movimiento que ya hizo `xlsx-template.ts` cuando `buildXlsxRows` nació al
lado de `buildXlsxTemplate`. `null`/ausente → celda vacía (R6); `number` → su
representación decimal.

---

## §4 — Backend: modo sin paginación (D3)

### §4.1 — Servicio

`lib/interfaces/services/IOrdenService.ts` gana:

```ts
export type ListarOrdenesCompletoServiceResult =
  | { status: "ok"; items: OrdenListItemDTO[]; total: number }
  | { status: "limite_excedido"; total: number; limite: number }   // R20
  | { status: "forbidden" };                                       // R14

listarCompleto(
  input: ListarOrdenesCompletoInput,
  actor: Actor,
): Promise<ListarOrdenesCompletoServiceResult>;
```

`OrdenService.listarCompleto` **no reimplementa** la construcción del `where`. La
construcción del `where` que hoy vive inline en `listar` (`OrdenService.ts:224-267`) se
extrae a un método privado `construirWhere(input, actor)` y `listar` pasa a usarlo, de modo
que ambos caminos comparten literalmente el mismo código: mismo `FILTER_TO_COLUMN`, mismo
`rangoCreacion`, y —clave— el mismo acotamiento por rol escrito AL FINAL, que pisa
`filter.tienda_id` para `adminTienda` y fuerza `mensajeroAsignadoId` para `mensajero`
(R12, R16). Extraer sin cambiar comportamiento está protegido por la batería existente
`tests/unit/services/orden-service-filtros.test.ts`.

Luego:

```
where = construirWhere(input, actor)
{ items, total } = repo.list({ where, sortBy, sortDir, skip: 0, take: LIMITE + 1 })
si total > LIMITE  -> { status: "limite_excedido", total, limite: LIMITE }   // descarta items
intentos = historial.contarIntentosEnLote(items.map(i => i.id))
-> { status: "ok", items: itemsConIntentos, total }
```

- `take: LIMITE + 1` acota la memoria por construcción: aunque el dataset sean 50 000
  filas, nunca se materializan más de `N + 1` (R22). El `total` es exacto porque
  `OrdenRepository.list` lo obtiene con un `count` independiente del `take`
  (`ListOrdenesResult { items, total }`).
- `sortBy`/`sortDir` conservan los defaults del schema (`created_at` / `desc`) → R17.
- El borrado lógico lo sigue excluyendo el repositorio, igual que en `listar` → R18.
- `intentosEntrega` se resuelve con el mismo `OrdenHistorialService.contarIntentosEnLote`
  que ya usa `listar`, así que la columna «intentos» del export no diverge del listado.

**Alternativa descartada (A5):** añadir un `contar(where)` nuevo al repositorio para
comprobar el tope con una consulta previa antes de leer filas. Descartada porque exige un
método nuevo en `IOrdenRepository` + una consulta extra en el 100 % de los casos, cuando el
`count` que `list` ya ejecuta da el mismo dato en la misma llamada y el `take: N + 1` ya
acota la memoria.

### §4.2 — Entrada y borde

`lib/types/orden.ts`:

```ts
export const listarOrdenesCompletoSchema = listarOrdenesSchema.omit({
  page: true,
  pageSize: true,
});
export type ListarOrdenesCompletoInput = z.infer<typeof listarOrdenesCompletoSchema>;

export type ListarOrdenesCompletoResult =
  | { status: "ok"; items: OrdenListItemDTO[]; total: number }
  | { status: "limite_excedido"; total: number; limite: number }
  | ActionError;
```

Reusar `listarOrdenesSchema` (que ya incluye `filter: ordenFilterSchema` con `.strict()` y
sus dos `refine`) es lo que da R15 gratis: una clave fuera de la lista blanca es
`ZodError` → `validation_error` sin devolver filas.

`lib/actions/ordenes.ts` gana `listarOrdenesCompleto(input, deps)` calcado de
`listarOrdenes`: `withErrorHandler` → `resolveActorFromSession` → `UnauthenticatedError` si
no hay actor (R13) → `parse` (R15) → `service.listarCompleto` → `toActionError`. Mismo
`OrdenActionDeps` (inyección para test).

### §4.3 — Config del tope

```ts
// lib/config/descarga.ts  (patrón de lib/config/ordenes.ts)
export interface DescargaConfigEnv { MAX_FILAS: number }
export const descargaConfig = { MAX_FILAS: readPositiveInt("DESCARGA_MAX_FILAS", 5000) };
```

Config, no literal, por la regla «sin hardcode de contexto» de `docs/architecture.md`.

---

## §5 — Prop `descarga` del `DataTable`

```ts
// components/shared/DataTable.tsx
export type DescargaFilasResult =
  | { status: "ok"; filas: DescargaFila[] }
  | { status: "error"; mensaje: string };   // R27: mensaje YA saneado por el consumidor

export interface DataTableDescarga {
  titulo: string;
  columnas: DescargaColumna[];
  obtenerFilas: () => Promise<DescargaFilasResult>;
  formatos?: DescargaTipo[];   // R28; ausente => ["xlsx"]
}

export interface DataTableProps<T> {
  /* … props actuales … */
  descarga?: DataTableDescarga;
}
```

- Sin la prop: cero cambios de render (R24). Se mantiene la retrocompatibilidad exigida
  por los ~31 consumidores actuales.
- Con la prop, el `DataTable` renderiza `DescargarDatasetButton` sobre la tabla. El botón
  se modela sobre `DescargarManifiestoButton` (mismo `Button` `variant="brand-outline"`,
  icono `Download`, `loading`/`disabled`, `useToast` para los mensajes) — pero **sin
  dominio**: no importa nada de `lib/actions/` ni de `lib/types/orden`.
- Flujo del click (R25): guard de reentrada → `obtenerFilas()` → si `error`, toast y
  return (R27) → si `filas.length === 0`, toast «no hay datos que descargar» y return
  (R23) → `import("@/lib/utils/descarga-dataset")` dinámico → `construirDescarga` →
  `descargarBlob(contenido, mime, nombreArchivo)`.
- `disabled` + `loading` mientras corre, con guard de carrera (R26), copiando el patrón
  `generando` del botón de manifiesto.
- El botón no toca `page`, `data` ni la selección: vive fuera del `<table>` y no llama a
  ningún setter de la tabla (R31).
- `aria-label`/texto visible «Descargar» + título del dataset (R30).
- Con `formatos.length > 1` se despliega un menú de elección; con 0 o 1, click directo
  (R28).
- El import dinámico del despachador mantiene `exceljs` fuera del bundle inicial de todas
  las tablas de la app: importante, porque el `DataTable` está en casi todas las pantallas.

---

## §6 — Tope `N`: valor propuesto y justificación (PROPUESTA para el gate)

**Propuesta: `N = 5000`, override por `DESCARGA_MAX_FILAS`.**

- **Contra `MAX_PAGE_SIZE`**: `ordenesConfig.MAX_PAGE_SIZE` es 100
  (`ORDENES_MAX_PAGE_SIZE`, `lib/config/ordenes.ts:40`), y la UI ofrece páginas de
  10/25/50 (`PAGE_SIZE_OPTIONS`, `OrdenesModule.tsx:41`). `N = 5000` = 50 páginas máximas:
  una cota de otro orden de magnitud, coherente con «esto es un export, no una página».
- **Contra el peso real de una fila**: `OrdenListItemDTO` son ~25 escalares más
  `relaciones` (estatus, tienda con su tarifa activa, zona, provincia, cantón, distrito,
  mensajero). Estimación conservadora: 1–2 KB por fila serializada ⇒ 5000 filas ≈ 5–10 MB
  de payload RSC. Es grande pero de un solo viaje y sin persistencia; el archivo `xlsx`
  resultante ronda 0,5–1,5 MB.
- **Contra el problema real**: el planteamiento habla de listados de ~3000 órdenes. Un tope
  por debajo de eso haría la feature inútil, así que `N` debe quedar holgadamente por
  encima del caso típico y por debajo del «vuelca la base entera».

Marcado como **propuesta** (`requirements.md` P1/P2): si el humano prefiere pagar menos
payload, la salida es `N = 2000` o proyectar en servidor, no truncar.

Mensaje de error propuesto (R20), accionable y sin PII:
> «La descarga supera el máximo de 5000 filas (hay 12 480). Acota los filtros —por
> ejemplo, el rango de fechas o el estado— y vuelve a intentarlo.»

---

## §7 — Consumidor: listado de órdenes

`app/(app)/ordenes/_components/ordenes-descarga-columnas.ts` (módulo puro, sin React):

- `COLUMNAS_DESCARGA_ORDENES: DescargaColumna[]` con los encabezados legibles del listado:
  `Nº Guía`, `Nº Remisión`, `Estado`, `Destinatario`, `Producto`, `Dirección`, `Tienda`,
  `Zona`, `Provincia`, `Cantón`, `Distrito`, `Monto a cobrar`, `Mensajero`, `Intentos`,
  `Fecha de creación`. Se enumeran a mano, igual que `COLUMNAS_MANIFIESTO`: si el DTO
  crece, el archivo no publica el campo nuevo en silencio.
- `filaDescargaOrden(o: OrdenListItemDTO): DescargaFila` proyecta a valores CRUDOS: ids →
  nombres legibles vía `o.relaciones`/`o.tiendaNombre`/`o.zonaNombre`, estado → etiqueta de
  `ORDER_STATUS_LABELS`, `montoCobrar` → `number | null`, fecha → `YYYY-MM-DD`,
  `intentosEntrega ?? 0`. Nada de `ReactNode` (R35).
- **No se exponen** `id`, `deletedAt` ni datos ajenos a la orden (misma regla que el
  manifiesto).

Cableado (D4, el consumidor cierra sobre SUS filtros):

- `OrdenesModule` ya recibe `filter?: OrdenesFilterUI` y ya es quien renderiza el
  `DataTable` (`OrdenesModule.tsx:318`). Gana una prop opt-in `permitirDescarga?: boolean`
  (default `false`, para que el dashboard del adminTienda y el resto de superficies no
  cambien) y, cuando es `true`, construye:

```ts
descarga={{
  titulo: "Órdenes",
  columnas: COLUMNAS_DESCARGA_ORDENES,
  obtenerFilas: async () => {
    const res = await listarOrdenesCompleto(filter ? { filter } : {});
    if (res.status === "limite_excedido") return { status: "error", mensaje: mensajeLimite(res) };
    if (res.status !== "ok") return { status: "error", mensaje: MENSAJE_ERROR[res.status] };
    return { status: "ok", filas: res.items.map(filaDescargaOrden) };
  },
}}
```

  El closure lee el `filter` vigente en el render, así que la descarga siempre refleja los
  filtros aplicados (R33, R36).
- `OrdenesListado` pasa `permitirDescarga` a `OrdenesModule`. El resto de su lógica
  (filtros de la feature 144, acciones por lote, SWR) queda intacta (R38).

---

## §8 — Fuera de alcance, dicho explícitamente

El rollout de la descarga a las ~30 tablas restantes de la app **es la feature 145 y NO se
hace aquí**. Esta feature entrega la capacidad genérica (§3, §5) más UN consumidor (§7).
Cualquier otra tabla que quiera descarga en el futuro solo tiene que declarar sus columnas
de export y su `obtenerFilas`; no debe tocar `DataTable`, ni el despachador, ni
`descargar-blob`. Si al cablear la segunda tabla hiciera falta modificar el contrato de
`DataTableDescarga`, eso es una señal de que este diseño falló y hay que revisarlo en 145,
no un permiso para meter dominio en la tabla.

---

## §9 — Errores, seguridad y observabilidad

- Sin `catch` vacíos: el botón captura, avisa por toast con mensaje accionable y no
  reintenta (patrón `DescargarManifiestoButton`).
- No se registra PII: el mensaje de tope solo lleva conteos.
- El borde nunca devuelve filas junto a un error (R13/R14/R15/R20).
- El tope se evalúa en el SERVICIO, no en el cliente: un cliente manipulado no puede
  pedir más de `N + 1` filas.

## §10 — Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Payload de 5–10 MB en una Server Action | Tope duro (§6) + P1/P2 en el gate. |
| Regresión al extraer `construirWhere` de `listar` | Refactor sin cambio de comportamiento, cubierto por `tests/unit/services/orden-service-filtros.test.ts` (que debe seguir verde sin tocarse). |
| `exceljs` entrando al bundle de todas las pantallas con `DataTable` | Import dinámico del despachador dentro del handler del botón (§5). |
| Divergencia entre lo que se ve y lo que se descarga | Columnas de export enumeradas a mano y derivadas del MISMO DTO del listado (§7). |
