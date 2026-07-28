# Feature 142 — Diseño técnico

Referencia: `requirements.md` (R1–R40). Contexto verificado leyendo el worktree
en `feature/142-plantilla-carga-masiva-v2` (base `origin/dev` @ `97f6e91`).

## 0. Resumen de la decisión

Una columna nueva (`direccion_destinatario`) sustituye a las cuatro columnas
geográficas de la plantilla. Un **parser puro nuevo** en `lib/utils/` traduce esa
columna a la terna `provincia`/`canton`/`distrito` + `direccion` literal. El
punto ÚNICO donde se aplica ese parser es `BulkOrdenService.cargarMasiva` (vía
sesión), justo antes de la resolución geográfica. `resolverGeografia` (`resolveGeo`)
queda **intacto** en firma y mensajes. La vía API key (feature 88) **no cambia**.

**Sin migración. Sin cambios de RLS. Sin endpoints nuevos. Sin cambios en el
modelo `orden` ni en `db/schema.prisma`.**

## 1. Estado actual verificado (lo que existe hoy)

| Artefacto | Hoy |
| --- | --- |
| `app/(app)/ordenes/_components/carga-masiva-fields.ts` | `ORDENES_BULK_FIELDS`: 11 campos con `example`, orden `num_remision, destinatario, telefono, provincia, canton, distrito, direccion, producto, peso, monto_cobrar, notas` |
| `lib/types/carga-masiva.ts` | `REQUIRED_HEADERS = [num_remision, destinatario, telefono, provincia, canton]`, `findMissingHeaders`, `filaCargaSchema` (zod), `RowResult`, `BulkSummary` |
| `lib/services/BulkOrdenService.ts` | `resolveGeo(raw:{provincia,canton,distrito}, ...)` privado; `resolveFila` lo llama con `raw.provincia/canton/distrito`; `cargarMasiva` (sesión) y `cargarViaApi` (API key) comparten `resolveFila` |
| `app/api/ordenes/carga-masiva/chunk/route.ts` | valida `rows: Record<string,string>[]` + `dryRun`, delega en `cargarMasiva`. Sin lógica de negocio |
| `app/api/ordenes/api-key/carga/route.ts` | delega en `cargarViaApi`; contrato público documentado en `specs/88-api-key-carga-ordenes/design.md` con `provincia`/`canton`/`distrito`/`direccion` separados |
| `app/(app)/ordenes/_components/carga-masiva-parser.ts` | parseo CSV/XLSX en el navegador → `FilaParseada { row, linea }`. Cabecera lowercase+trim; valores `trim()` |
| `carga-masiva-chunks.ts` | dedup por `num_remision`, troceo, POST por lotes |
| `carga-masiva-error-chips.ts` | agrupa errores por `campo::mensaje canónico`; **genérico**, no menciona campos geográficos → no requiere cambios |
| `carga-masiva-clasificacion.ts` | clasifica `BulkSummary.filas`; **genérico** → no requiere cambios |
| `lib/utils/xlsx-template.ts`, `lib/utils/csv-template.ts` | generan la plantilla desde la lista de campos; agnósticos de qué campos son → no requieren cambios |

Observación relevante: `BulkOrdenService.resolveFila` fija hoy `peso: null` con el
comentario "la carga masiva no trae peso", aunque la plantilla ofrece la columna
`peso`. Es comportamiento preexistente y esta feature lo conserva (R39).

## 2. Modelo de datos

**Sin cambios.** No hay tabla nueva, columna nueva, índice nuevo ni política RLS
nueva. La dirección literal sigue guardándose en el mismo campo `direccion` de
`orden` (`CreateOrdenData.direccion`), y `zona_id`/`provincia_id`/`canton_id`/
`distrito_id` se siguen resolviendo por el mismo camino. No se ejecuta
`db:migrate:create` ni se toca `db/migrations/`.

## 3. Dónde vive el parser nuevo

### Ubicación elegida: `lib/utils/direccion-destinatario.ts`

Razones, contra `docs/architecture.md` y `docs/conventions.md`:

1. `docs/architecture.md > Estructura de carpetas` define `lib/utils/` como
   "helpers puros (sin side effects)". El parser es exactamente eso: `string` →
   resultado discriminado, sin I/O.
2. `lib/types/carga-masiva.ts` está reservado a **tipos de dominio + schemas
   zod** de la carga. Meter ahí una función de parseo de texto mezcla
   responsabilidades y engorda un módulo que ya importa el cliente.
3. Un archivo propio deja el contrato del parser testeable de forma aislada en
   `tests/unit/utils/`, con el nombre en `kebab-case.ts` que exige
   `docs/conventions.md`.

### ¿Puede el cliente importar de `lib/`?

Sí, y ya lo hace: `OrdenesCargaUpload.tsx` (`"use client"`) importa
`findMissingHeaders` de `@/lib/types/carga-masiva` y `cargaMasivaConfig` de
`@/lib/config/carga-masiva`. El nuevo módulo debe respetar la misma disciplina:
**cero imports de Prisma, `next/headers`, `next/server`, Supabase o `process.env`**;
solo `string` y tipos. Así no arrastra `server-only` al bundle del navegador.
El módulo no llevará la directiva `import "server-only"`.

## 4. Punto único de aplicación del parseo

### El problema real

`resolveFila` es **compartido** por `cargarMasiva` (vía sesión) y `cargarViaApi`
(vía API key, feature 88). Si el parseo se metiera dentro de `filaCargaSchema` o
dentro de `resolveFila` sin discriminar, se rompería el contrato público del
integrador (R38): sus payloads traen `provincia`/`canton`/`distrito` sueltos y
**no** traen `direccion_destinatario`. Eso convierte "un solo punto de verdad" en
"un solo punto de verdad **por vía**".

### Solución: extractor de geografía inyectado por vía

```
lib/utils/direccion-destinatario.ts        ← parser puro (nuevo)
  parseDireccionDestinatario(valor: string): ParseDireccionResult

lib/services/BulkOrdenService.ts
  type GeoInput =
    | { ok: true; provincia: string; canton: string; distrito: string; direccion: string }
    | { ok: false; fieldErrors: Record<string, string[]> }

  geoInputDesdeDireccionUnificada(raw: RawRow): GeoInput   // vía sesión  (usa el parser)
  geoInputDesdeColumnasSeparadas(raw: RawRow): GeoInput    // vía API key (contrato 88)

  resolveFila(raw, ctx, seen, geoInputOf)                  // recibe el extractor
    cargarMasiva   -> resolveFila(..., geoInputDesdeDireccionUnificada)
    cargarViaApi   -> resolveFila(..., geoInputDesdeColumnasSeparadas)
```

- El parseo ocurre **una sola vez**, en el servidor, dentro del service. Funciona
  idéntico para `dryRun: true` y para la carga en firme, y por tanto idéntico
  para cada chunk (R31): el chunk endpoint no hace nada especial.
- El **cliente NO reparsea** la dirección. Solo necesita cabeceras
  (`findMissingHeaders`) y `num_remision` (dedup). Duplicar el parseo en
  `carga-masiva-parser.ts` sería una segunda fuente de verdad divergible; se
  descarta explícitamente (ver §7, alternativa B).
- `resolveGeo` (la función que implementa `resolverGeografia`) **conserva su
  firma actual** `{ provincia, canton, distrito }` y todos sus mensajes (R33–R36).
  Los tres nombres le llegan del `GeoInput`, no de `raw.*`.

### Contrato del parser

```ts
export const FORMATO_DIRECCION_DESTINATARIO =
  "País / Provincia / Cantón (Distrito) / Dirección";

export interface DireccionDestinatarioPartes {
  provincia: string;   // trim, SIN normalizar acentos/mayúsculas (R27)
  canton: string;      // trim
  distrito: string;    // trim, extraído del paréntesis
  direccion: string;   // trim solo en extremos; conserva '/' y espacios internos
}

export type ParseDireccionResult =
  | { ok: true; partes: DireccionDestinatarioPartes }
  | { ok: false; mensaje: string };   // nunca lanza (R28)
```

Algoritmo (determinista, sin regex sobre la dirección literal):

1. Si `valor.trim() === ""` → error "obligatorio" (R25).
2. Localizar los índices del 1.º, 2.º y 3.º `/`. Si hay menos de 3 → error de
   formato (R13).
3. `pais` = tramo `[0, i1)` → **descartado sin validar** (R12).
4. `provincia` = `trim(tramo(i1+1, i2))`; vacío → error (R23).
5. `cantonDistrito` = `trim(tramo(i2+1, i3))`; se procesa en el paso 7.
6. `direccion` = `trim(valor.slice(i3+1))` — el `slice` conserva `/` internos y
   finales y los espacios internos (R15, R16, R17). Vacía es válida (R26).
7. Del `cantonDistrito`: `a = indexOf("(")`, `b = indexOf(")", a)`.
   - `a < 0` → error "falta el distrito entre paréntesis" (R19, D2).
   - `b < 0` → error "paréntesis del distrito sin cerrar" (R21).
   - `trim(entre a y b) === ""` → error "distrito vacío" (R20).
   - `trim(despuésDeB) !== ""` → error "texto inesperado tras el distrito" (R22).
   - `trim(antesDeA) === ""` → error "cantón vacío" (R24).

Los mensajes de error **no interpolan el valor crudo** salvo entre comillas
simples: `carga-masiva-error-chips.ts` canoniza `'…'` para agrupar por tipo, así
que cualquier fragmento variable debe ir entrecomillado o no ir.

### Propagación de la dirección literal

Hoy `resolveFila` toma `data.direccion` de `filaCargaSchema`. Pasa a tomar
`geoInput.direccion`. En consecuencia, `filaCargaSchema` deja de declarar
`provincia`, `canton`, `distrito` y `direccion` (su lugar es el `GeoInput`), y
gana `direccion_destinatario: z.string().trim().optional().default("")` solo como
paso-a-través tipado. `geoInputDesdeColumnasSeparadas` hace el `trim()` que antes
hacía el schema, de modo que la vía API key no cambia de comportamiento (R38).

## 5. Cambios por archivo

### Backend (`lib/`, `app/api/`)

| Archivo | Cambio |
| --- | --- |
| `lib/utils/direccion-destinatario.ts` | **NUEVO**. Parser puro + `FORMATO_DIRECCION_DESTINATARIO` (§4) |
| `lib/types/carga-masiva.ts` | `REQUIRED_HEADERS = [num_remision, destinatario, telefono, direccion_destinatario]` (R6); `filaCargaSchema` pierde `provincia/canton/distrito/direccion` y gana `direccion_destinatario` |
| `lib/services/BulkOrdenService.ts` | `GeoInput` + los dos extractores; `resolveFila` recibe el extractor; `resolveGeo` **sin tocar**; `createData.direccion` desde `geoInput.direccion` |
| `app/api/ordenes/carga-masiva/chunk/route.ts` | **sin cambios** (sigue pasando `rows` crudos) |
| `app/api/ordenes/api-key/carga/route.ts` | **sin cambios** |

### Frontend (`app/(app)/`)

| Archivo | Cambio |
| --- | --- |
| `carga-masiva-fields.ts` | `ORDENES_BULK_FIELDS` = 8 campos en el orden de R1, con `example` nuevos (R3) |
| `OrdenesCargaUpload.tsx` | mensaje de cabecera faltante: cuando falta `direccion_destinatario`, añade la indicación de descargar la plantilla nueva (R8); revisar el texto del `hint` |
| `carga-masiva-parser.ts` | **sin cambios de lógica** (sigue devolviendo `RawRow` por cabecera) |
| `carga-masiva-chunks.ts`, `carga-masiva-clasificacion.ts`, `carga-masiva-error-chips.ts` | **sin cambios** (agnósticos del campo) |

Ejemplos propuestos para `ORDENES_BULK_FIELDS` (R3; el valor de
`direccion_destinatario` queda sujeto a R4, ver §6):

```
destinatario           "Juan Pérez"
telefono               "88887777"
direccion_destinatario "Costa Rica / Cartago / Jimenez (Juan Vinas) / Frente gasolinera JSM, 200m sur"
monto_cobrar           "25.90"
producto               "Camiseta talla M"
num_remision           "REM-0001"
peso                   "1.5"
notas                  "Entregar en la tarde"
```

## 6. Plan para los tests existentes que rompen

Inventario obtenido por grep sobre `ORDENES_BULK_FIELDS`, `REQUIRED_HEADERS`,
`findMissingHeaders`, `filaCargaSchema`, `resolverGeografia`:

| Test | Estado | Acción |
| --- | --- | --- |
| `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` | **rompe** | **Reescribir.** Sus 6 casos siguen siendo válidos en intención (cabecera = clave máquina, cada clave verbatim, sin obligatorias ausentes) pero el caso "el VALOR obligatorio de ejemplo (distrito) llega bajo su clave correcta" ya no aplica: pasa a ser "el valor de ejemplo de `direccion_destinatario` llega verbatim bajo su clave y **se parsea** a una terna completa". Añadir el guard de orden exacto de las 8 columnas (R1) |
| `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts` | **rompe** (`exampleFor("provincia")` lanza) | **Reescribir.** Obtiene la terna aplicando el parser nuevo sobre el ejemplo de `direccion_destinatario` y mantiene las dos aserciones actuales contra los XLSX del seed (terna existe / distrito con zona). Este test es el que **verifica R4** y el que decide si `Jimenez (Juan Vinas)` sirve como ejemplo o hay que cambiarlo |
| `tests/unit/services/bulk-orden-service.test.ts` | **rompe** (31 apariciones de prov/cantón/distrito en las filas de fixture) | **Reescribir las fixtures** de la vía sesión para usar `direccion_destinatario`; los casos de geografía (no encontrada / ambigua / sin zona) se conservan tal cual porque los mensajes no cambian (R34–R36). Añadir casos de fallo de parseo (R29, R30) |
| `tests/unit/services/bulk-orden-service.carga-api.test.ts` | **NO debe romper** | Se deja intacto: es el guard de regresión de R38. Si rompe, el diseño está mal aplicado |
| `tests/integration/api/ordenes-api-key-carga.route.test.ts` | **NO debe romper** | Se deja intacto (usa un service fake) |
| `tests/integration/api/ordenes-carga-masiva-chunk.route.test.ts` | no rompe (service fake, `ROW` opaco) | Sin cambios |
| `tests/unit/config/carga-masiva-config.test.ts` | no rompe (solo config de topes) | Sin cambios |
| `tests/components/OrdenesCargaUpload.test.tsx` | **rompe** (`HEADERS_OK` con `provincia`/`canton`) | Actualizar `HEADERS_OK` y añadir el caso del corte duro D1 (archivo viejo → mensaje que apunta a la plantilla nueva, R7/R8) |
| `tests/unit/utils/xlsx-template.test.ts`, `csv-template.test.ts` | no rompen (usan campos propios) | Sin cambios |
| `tests/components/CargaMasivaErrorChips.test.ts` | no rompe (genérico) | Sin cambios |

## 7. Alternativas descartadas

**A) Meter el parseo dentro de `filaCargaSchema` (zod `transform`).**
Descartada: `filaCargaSchema` es compartido por `cargarMasiva` y `cargarViaApi`;
transformar ahí obligaría al integrador de la API key a migrar a
`direccion_destinatario`, rompiendo un contrato público ya publicado
(`specs/88-api-key-carga-ordenes`), lo cual está fuera del alcance de esta
feature. Además zod tendría que emitir el `fieldError` mezclado con el resto de
issues del schema, perdiendo el control fino de los mensajes accionables (R29).

**B) Parsear en el cliente al construir la `FilaParseada` y enviar al servidor la
terna ya separada.**
Descartada: crearía dos fuentes de verdad (el navegador decide la geografía, el
servidor confía) y dejaría el endpoint de chunk aceptando filas cuya geografía
nadie validó — un cliente modificado podría saltarse el formato. También
duplicaría el parser en el bundle y haría divergir cliente y servidor en la
primera corrección de un caso borde.

**C) Modo compatibilidad (si viene `direccion_destinatario` usa el parser, si no
usa las 4 columnas viejas).**
Descartada **por decisión D1 del humano** (corte duro): dos caminos de código
sobre la misma vía duplican los casos borde a testear para siempre y esconden
archivos viejos que se cargan "a medias". Se documenta aquí solo para dejar
constancia de que se evaluó y quedó cerrada antes del spec.

**D) Distrito opcional cuando el paréntesis falta (crear la orden sin distrito).**
Descartada **por decisión D2 del humano**: `zona_id` se deriva del distrito y
determina tarifa y ruteo; `orden.zona_id` es NOT NULL, así que una fila sin
distrito no puede crearse sin trabajo manual posterior.

## 8. Riesgos

1. **Ripple en tests**: 4 archivos de test se reescriben. Mitigado por el
   inventario de §6 y por la tarea de trazabilidad final.
2. **Ejemplo de la plantilla inválido**: si `Cartago / Jimenez (Juan Vinas)` no
   existe en el catálogo del seed o su distrito no tiene zona, el test de §6
   (`carga-masiva-ejemplos-geo`) falla. Es el comportamiento deseado: obliga a
   elegir una terna real en vez de romper la plantilla en producción.
3. **Usuarios con archivos viejos**: por D1 fallan en cabecera. Mitigado por el
   mensaje de R8.

## Preguntas abiertas — ✅ TODAS CERRADAS en la puerta F1.4 (humano, 2026-07-27)

> El humano aprobó el spec con un "aprobado" a secas = **se toman las 6 propuestas
> tal cual**. Ya no son preguntas: son contrato. No las re-abras al implementar.

1. **(R22) Texto tras el `)` del distrito → ERROR DE FILA.** `Jimenez (Juan Vinas) extra`
   es `fieldError` en `direccion_destinatario`. No se descartan datos en silencio.
2. **(R26) Dirección literal vacía → SE ACEPTA.** Equivale a la columna `direccion`
   vacía de hoy: persiste `null`. No es error de fila.
3. **(R8) Copy del corte duro → el propuesto, literal:**
   `Faltan columnas obligatorias: direccion_destinatario. La plantilla cambió: descarga la plantilla nueva y vuelve a cargar tus datos.`
4. **Ejemplo canónico → `Costa Rica / Cartago / Jimenez (Juan Vinas) / Frente gasolinera JSM, 200m sur`,
   sustituible** por otra terna real si el guard de geografía contra el seed lo
   rechaza (distrito sin zona). Si se sustituye, documentarlo en `impl_142.md`.
5. **Columna `peso` → FUERA DE ALCANCE.** Sigue en la plantilla y el service la
   sigue ignorando (`peso: null`). Es deuda preexistente; esta feature no la abre (R39).
6. **Documentación al integrador → NO HAY.** No existe doc público de la plantilla
   fuera de `specs/`; nada que actualizar.

### Confirmado además en la puerta F1.4

El **extractor de geografía inyectado por vía** (sección 4) es la decisión
estructural aprobada: `filaCargaSchema`/`resolveFila` los comparte `cargarViaApi`
(feature 88, **contrato público** con `provincia`/`canton`/`distrito` separados),
así que el parseo de `direccion_destinatario` **no** entra en `filaCargaSchema`.
La vía UI parsea; la vía API key sigue recibiendo los 3 campos separados y **no
cambia**. Romper esto es hallazgo bloqueante para el reviewer.
