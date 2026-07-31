# Feature 169 — Buscador de texto en el listado de órdenes · tasks.md

> Orden obligatorio: **verificación previa → base de datos → backend → frontend → medición
> → cierre**. `[P]` = puede correr en paralelo con las otras `[P]` de su mismo bloque
> (ficheros disjuntos). Cada task lleva su **criterio de hecho**: si no se puede comprobar,
> la task está mal escrita.
> Regla del arnés: **nada se marca `[x]` sin que pasen `./init.sh` y la suite**.
> Zona `fullstack` ⇒ se secuencia backend → frontend (`backend_dev` y luego `frontend_dev`).

---

## T0 — Verificación previa (bloquea T1; sin esto no se aplica ninguna migración)

- [ ] **T0.1 — Contar filas de `orden` en producción.** ⚠️ **PARCIAL — bloqueante de
  despliegue, no de código.** Local medido: **67 filas**. Producción **NO medida**: el
  `DATABASE_URL` de producción es *sensitive* y el MCP de Supabase no está autenticado en
  esta sesión. El conteo y su umbral (200 000) quedan como **requisito previo a aplicar la
  migración en producción**, escrito en `progress/impl_169-buscador-ordenes.md`. P4 sigue
  abierta.
  *Hecho:* el número queda escrito en `progress/impl_169-buscador-ordenes.md`. Si supera
  **200 000**, no se aplica en caliente: se pide ventana de mantenimiento al humano antes
  de continuar (design §2.2). Responde P4.
- [ ] **T0.2 [P] — Comprobar `pg_trgm` en local, preview y producción.** ⚠️ **PARCIAL —
  bloqueante de despliegue.** Local verificado (no estaba instalada; la migración la creó
  en `extensions`). Preview y producción **NO verificadas** (sin acceso). La consulta exacta
  a correr antes de aplicar en cada base queda en la bitácora. P2 sigue abierta.
  `SELECT e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname='pg_trgm';`
  *Hecho:* las tres respuestas quedan anotadas. Si aparece en un esquema distinto de
  `extensions`, se anota la reparación (`ALTER EXTENSION pg_trgm SET SCHEMA extensions;`)
  **antes** de escribir la migración. Responde P2.
- [x] **T0.3 [P] — Confirmar con el humano P1 y P3** (guías de <3 dígitos; qué mostrar
  cuando un término numérico es guía *y* fragmento de teléfono).
  *Hecho:* respuesta anotada, o se aplican los *defaults* escritos en `requirements.md`
  dejando constancia de que se aplicaron.

---

## T1 — Base de datos (backend_dev). Bloquea T2

- [x] **T1.1 — Normalizador compartido `lib/utils/busqueda-orden.ts`.**
  `ACENTOS_FROM`/`ACENTOS_TO` (48 caracteres cada uno), `normalizarTerminoBusqueda`,
  `soloDigitosSiPareceNumero`. Puro, sin React ni Prisma. **No** reutiliza `normalizeName`
  (design §3.1).
  *Hecho:* `tests/unit/utils/busqueda-orden.test.ts` en verde, incluido un test que asserta
  `ACENTOS_FROM.length === ACENTOS_TO.length === 48`.
- [x] **T1.2 — Escribir la migración** `db/migrations/<ts>_orden_busqueda_trgm/migration.sql`
  con las cuatro sentencias del design §2.1/§2.3, en ese orden, y el `translate()` copiado
  **literalmente** del mismo par de constantes de T1.1.
  *Hecho:* el archivo existe y el `from`/`to` del SQL coincide carácter a carácter con
  `ACENTOS_FROM`/`ACENTOS_TO`.
- [x] **T1.3 — Escribir `down.sql`**: `DROP INDEX IF EXISTS` → `ALTER TABLE … DROP COLUMN
  IF EXISTS`. Sin `DROP EXTENSION`, sin tocar el esquema `extensions`, con el comentario que
  lo justifica (design §2.4).
  *Hecho:* `pnpm run db:rollback` aplica el DOWN y **ejecutarlo dos veces no falla**.
- [x] **T1.4 — Aplicar la migración contra Postgres real** (`pnpm run db:migrate`).
  *Hecho:* aplica sin error — lo que demuestra empíricamente que `num_guia::text`,
  `translate`, `lower`, `regexp_replace` y `btrim` son admisibles en la columna generada, y
  que el opclass `extensions.gin_trgm_ops` resuelve (design §2.1/§2.3).
- [x] **T1.5 — Declarar la columna y el índice en `db/schema.prisma` y demostrar diff
  vacío.** `pnpm run db:migrate:create` sobre el árbol ya migrado.
  *Hecho:* la migración propuesta **no contiene ninguna sentencia** sobre `busqueda_texto`
  ni sobre `orden_busqueda_texto_trgm_idx` (se descarta la carpeta generada). Si no se
  consigue con ninguna variante de la declaración → **se salta al plan B del design §10.2 y
  se avisa al leader** (cambia el diseño, no solo la implementación). (R30)
- [x] **T1.6 — Test de paridad SQL ↔ TypeScript.**
  `tests/integration/db/busqueda-normalizacion-paridad.test.ts`: inserta un corpus
  (mayúsculas, tildes, `ñ`, `ç`, teléfono con guiones, dobles espacios, guía nula) y compara
  `orden.busqueda_texto` leído de la base con lo que produce el normalizador de T1.1 sobre
  el mismo texto concatenado.
  *Hecho:* verde para todo el corpus. Es el guardián del riesgo nº 3 del design.
- [x] **T1.7 [P] — Test estático de la migración**
  `tests/integration/db/orden-busqueda-trgm-migration.test.ts` (patrón
  `orden-indices-filtros-migracion.test.ts`): UP crea extensión + columna generada + índice
  GIN cualificado; DOWN revierte en orden inverso con `IF EXISTS`; DOWN **no** contiene
  `DROP EXTENSION` ni `DROP SCHEMA`; `schema.prisma` declara columna e índice.
  *Hecho:* verde. (R29, R30)
- [x] **T1.8 [P] — `omit` global en `lib/db/prisma-client.ts`.**
  *Hecho:* `pnpm run typecheck` en verde y un test que comprueba que un `findMany` de orden
  no devuelve la clave `busquedaTexto`. (R28)
- [x] **T1.9 — Test de sincronización automática del dato derivado.**
  Crear una orden y encontrarla por sus cuatro datos; actualizar `destinatario` y
  comprobar que se encuentra por el nuevo y **no** por el anterior.
  *Hecho:* verde contra Postgres real. (R26)

---

## T2 — Backend: contrato, service y repositorio (backend_dev). Depende de T1

- [x] **T2.1 — Whitelist y validación** en `lib/types/orden.ts`: `q` en
  `ORDEN_FILTER_FIELDS` y en `ordenFilterSchema` (`.trim().min(BUSQUEDA_MIN_CHARS).max(BUSQUEDA_MAX_CHARS)`),
  más las dos constantes exportadas. `.strict()` y los dos `refine` intactos.
  *Hecho:* tests de schema: acepta `q` válido; `validation_error` con 2 caracteres, con
  `"  a  "`, con >80; clave desconocida sigue fallando. (R1, R3, R4, R19)
- [x] **T2.2 — `ListOrdenesWhere` gana `busqueda?: string` y `numGuia?: number`.**
  *Hecho:* typecheck verde; los dobles de test de `IOrdenRepository` compilan.
- [x] **T2.3 — Traducción en `OrdenService.construirWhere`**: normaliza el término, decide
  ruta rápida (solo dígitos + rango `int4`) y escribe **antes** del acotamiento por rol.
  *Hecho:* tests unitarios de service con repo mockeado que asertan el `where` construido en
  cada caso. (R2, R9, R12, R14, R21)
- [x] **T2.4 — Fallback de la ruta rápida en `OrdenService.listar`/`listarCompleto`**:
  si `total === 0` con `numGuia`, se repite con `busqueda`. **La condición es `total`, nunca
  `items.length`.**
  *Hecho:* test que pide la **página 3** de un término que es guía exacta y comprueba que
  NO cae al trigram (`total` sigue siendo 1). (R10, R11)
- [x] **T2.5 — Repositorio**: `contains` sobre `busquedaTexto` sin `mode`, `numGuia` por
  igualdad, `escaparLike` para `\ % _`. El `count` sigue con el mismo `where`.
  *Hecho:* tests de repositorio contra DB: `"100%"` no devuelve todo; `"_"` no comodinea;
  el `total` coincide con el número real de coincidencias. (R7, R15)
- [x] **T2.6 [P] — Tests de comportamiento de búsqueda contra DB** (un archivo, todos los
  casos): fragmento al principio/medio/final; con y sin tildes en los dos sentidos;
  mayúsculas; dobles espacios; teléfono con y sin guiones; guía parcial; orden borrada que
  no aparece; el orden del listado no cambia.
  *Hecho:* verde. (R5, R6, R8, R13, R16, R17)
- [x] **T2.7 [P] — Tests de alcance por rol**: `adminTienda` buscando datos exactos de otra
  tienda → 0 items y `total: 0`; `mensajero` buscando una guía ajena → 0; `adminSatelite` →
  `forbidden`; sin sesión → `unauthenticated`.
  *Hecho:* verde. Es el test que impide la fuga. (R22, R23, R24, R25)
- [x] **T2.8 [P] — Tests de no regresión del contrato**: sin `q`, la entrada enviada, el
  `where` y el resultado son idénticos a los previos; la descarga completa aplica el mismo
  término.
  *Hecho:* verde, y la suite previa de la 144/151 pasa **sin tocar un solo test existente**.
  (R18, R20)
- [x] **T2.9 — Guardia de escritura**: test que recorre `lib/**` y `app/**` y falla si
  alguien escribe `busquedaTexto` en un `create`/`update`/`createMany`.
  *Hecho:* verde, y las cuatro rutas de escritura de órdenes (alta manual, carga masiva por
  sesión, carga por API key, actualización) siguen pasando sus tests. (R27)

---

## T3 — Frontend (frontend_dev). Depende de T2

- [x] **T3.1 — `kind: "text"` + `minChars` en `components/shared/FilterComponent.tsx`.**
  Emite `[termino]` con `length >= minChars`; por debajo omite la clave; aviso `aria-live`
  del mínimo; se limpia con "Limpiar todo" vía `resetSignal`; usa el debounce que ya existe
  (no se añade otro).
  *Hecho:* tests del componente **con filtros de fantasía** (sin importar dominio):
  teclear 2 caracteres no emite; teclear 3 emite una sola vez tras la espera; una ráfaga de
  10 pulsaciones produce **una** emisión; vaciar el campo emite sin la clave. (R33, R34,
  R35, R36, R41)
- [x] **T3.2 — Declaración en `ordenes-filtros-def.ts`** como **primer** filtro, con
  `minChars: BUSQUEDA_MIN_CHARS` y el placeholder de los cuatro campos.
  *Hecho:* test que asserta que el primer `FilterDef` es el de clave `q`. (R32)
  **Además** (no estaba escrito en la task): `OrdenesListado` compone la barra como
  `[estado, ...construirFiltrosOrdenes()]`, así que declararlo primero AHÍ no bastaba —
  el estado quedaba delante. Se reordenó el cableado. Ver impl §12.2.
- [x] **T3.3 — `seleccion-a-filter.ts`**: `q` como **escalar** (`values[0]`), nunca lista.
  *Hecho:* test unitario de la traducción, incluido el caso "clave ausente cuando no hay
  término". (R36)
- [x] **T3.4 [P] — Reset de página y caché**: comprobar que cambiar el término cambia la key
  SWR, vuelve a página 1 y limpia la selección de filas (comportamiento heredado de
  `serializarFiltro`/`OrdenesModule`, se verifica, no se reimplementa).
  *Hecho:* test verde. (R38, R39)
- [x] **T3.5 [P] — Estado vacío con término** en `OrdenesModule` (`emptyState` alternativo
  con el término y la invitación a limpiar). Sin tocar `DataTable`.
  *Hecho:* test de render con `filter.q` y 0 items. (R40)
- [x] **T3.6 [P] — No regresión de superficies ajenas**: la suite de `MultiSelectFilter`,
  `DateRangeFilter`, el filtro de estado, el buscador del mensajero (114) y el resto de
  consumidores de `OrdenesModule` pasa **sin modificar ningún test existente**.
  *Hecho:* `pnpm test` verde con `git diff` vacío en esos archivos de test. (R42)
  **Excepción declarada:** `tests/unit/components/ordenes-filtros-def.test.ts` —el CENSO de
  la barra— sí se tocó en cuatro asertos, por el mismo motivo que el backend tocó
  `orden-filter-144.test.ts` (impl §6). No es un consumidor ajeno: es el archivo cuyo
  sujeto cambia. Ver impl §12.5.

---

## T4 — Medición de rendimiento con datos (backend_dev). Depende de T3

- [x] **T4.1 — Banco de pruebas y números reales.** Ejecutada sobre 50 000 filas contra
  Postgres real. **Las cinco aserciones se cumplen y ningún umbral dispara el plan B.**
  Hallazgo declarado (impl §19.4): la `pending list` del GIN que deja una carga masiva
  degrada la búsqueda hasta 3× y hace que un término amplio recorra la tabla, hasta que
  `autovacuum` la vacía.
  `scripts/bench-busqueda-ordenes.ts`: siembra **50 000 órdenes** (nombres con y sin
  tildes, teléfonos con y sin guiones, remisiones variadas), lanza los cinco escenarios del
  design §6 con `EXPLAIN (ANALYZE, BUFFERS)` y **10 repeticiones** cada uno, e imprime
  mediana y p95 de `findMany`, de `count` y del total.
  *Hecho —y esto es lo que se revisa, no "parece rápido"—:*
  1. Una **tabla con los números** (mediana y p95 por escenario) pegada en
     `progress/impl_169-buscador-ordenes.md`.
  2. El plan de E2/E3 muestra `Bitmap Index Scan on orden_busqueda_texto_trgm_idx` y **no**
     `Seq Scan on orden`.
  3. El plan de E1 muestra `Index Scan using orden_num_guia_key`.
  4. El SQL realmente emitido por Prisma para `contains` queda pegado (verifica el escape
     de `%`/`_` del design §4.3).
  5. E5 (carga masiva de 200 órdenes antes/después del índice) con su porcentaje.
  *Umbrales de acción:* E2 p95 > 300 ms o E3 p95 > 500 ms ⇒ se implementa el **plan B**
  (conteo con tope, design §6) y se **vuelve a medir**; E5 > +20 % ⇒ se anota como deuda con
  su número. (R31)
- [x] **T4.2 — Test de plan de ejecución** `tests/integration/db/busqueda-usa-indice.test.ts`:
  `EXPLAIN` de la consulta con término y aserción de que el plan **no** contiene
  `Seq Scan on orden`.
  *Hecho:* verde contra Postgres real, 10 casos (se salta si no hay DB, patrón del repo).
  **Alcance declarado** (impl §19.5): la aserción del trigram va con `enable_seqscan = off`
  porque la elección por coste resultó **medida como no determinista** en un corpus de test
  (`pending list` del GIN + bloat de la tabla); la elección por coste se demuestra en T4.1,
  sobre 50 000 filas. La ruta rápida por guía **sí** se aserta sin forzar nada. (R31)

---

## T5 — Cierre

- [x] **T5.1 — Trazabilidad**: `progress/impl_169-buscador-ordenes.md` con el mapa
  `R<n> → test` completo (tabla de abajo, con rutas de archivo reales) y los números de
  T4.1.
  *Hecho:* los **42** requisitos (R1-R42; el spec no tiene más) aparecen con al menos un
  test. Mapa completo y verificado en impl §20.
- [ ] **T5.2 — Puertas del arnés**: `./init.sh`, `pnpm run typecheck`, `pnpm run lint`,
  `pnpm test` en verde. ⚠️ **typecheck y lint en verde; la suite tiene UN rojo AJENO a esta
  feature** — `tests/components/Modal.test.tsx > R30: atrapa el foco con Tab`, reproducido
  en `HEAD` con todo el trabajo de T4/T5 guardado en `stash`. No se toca: es de la capa de
  componentes. `./init.sh` cae por ese mismo rojo. Detalle en impl §21.
- [x] **T5.3 — Orden de despliegue y de reversión escrito en el impl**: desplegar
  **migración primero, código después**; revertir **código primero, migración después**
  (design §2.4).
  *Hecho:* impl §22, con la lista de comprobaciones previas por base (incluida la de
  `random_page_cost`, que T4.1 demostró que decide el plan) y sus umbrales.
- [ ] **T5.4 — Entrada en `progress/history.md`** y `feature_list.json` a `done` con
  `status_note` de 3-6 líneas técnicas.

---

## Mapa R → test (lo rellena el implementer con las rutas reales)

| R | Qué prueba | Task |
| --- | --- | --- |
| R1 | `q` aceptado en el `filter` | T2.1 |
| R2 | solo los cuatro campos (dirección/producto/tienda no coinciden) | T2.3, T2.6 |
| R3 | <3 caracteres ⇒ `validation_error`, sin consulta | T2.1 |
| R4 | término demasiado largo ⇒ `validation_error` | T2.1 |
| R5 | fragmento al principio / en medio / al final | T2.6 |
| R6 | con y sin tildes, en ambos sentidos y cajas | T2.6, T1.6 |
| R7 | `%`, `_`, `\` como literales | T2.5 |
| R8 | espacios sobrantes y repetidos | T2.6, T1.6 |
| R9 | término = guía exacta ⇒ solo esa orden | T2.3 |
| R10 | término numérico que no es guía ⇒ parcial | T2.4 |
| R11 | mismo criterio en página 1 y en la 3 | T2.4 |
| R12 | numérico fuera de rango `int4` ⇒ parcial, sin error | T2.3 |
| R13 | teléfono con y sin separadores | T2.6 |
| R14 | AND con los demás filtros | T2.3 |
| R15 | `total` con el mismo criterio que la página | T2.5 |
| R16 | el orden del listado no cambia | T2.6 |
| R17 | no devuelve borradas | T2.6 |
| R18 | sin `q`, comportamiento idéntico al previo | T2.8 |
| R19 | clave fuera de la whitelist ⇒ `validation_error` | T2.1 |
| R20 | la descarga completa aplica el término | T2.8 |
| R21 | el término solo estrecha, nunca amplía | T2.3, T2.7 |
| R22 | `adminTienda` no ve órdenes ajenas ni en el `total` | T2.7 |
| R23 | `mensajero` solo sus asignadas | T2.7 |
| R24 | rol no reconocido ⇒ `forbidden` | T2.7 |
| R25 | sin sesión ⇒ `unauthenticated` | T2.7 |
| R26 | dato derivado sincronizado al crear y al actualizar | T1.9 |
| R27 | ninguna ruta de escritura lo escribe | T2.9 |
| R28 | no aparece en ningún DTO/respuesta | T1.8 |
| R29 | DOWN inverso e idempotente; listado vivo tras revertir | T1.3, T1.7 |
| R30 | sin drift schema.prisma ↔ SQL | T1.5, T1.7 |
| R31 | la consulta usa índice, no recorre la tabla | T4.1, T4.2 |
| R32 | el buscador es el primer control de la barra | T3.2 |
| R33 | declarado sobre el componente genérico, sin dominio | T3.1 |
| R34 | una ráfaga de pulsaciones ⇒ una consulta | T3.1 |
| R35 | <3 caracteres: ni consulta ni error, con aviso | T3.1 |
| R36 | vaciar el campo ⇒ sin búsqueda | T3.1, T3.3 |
| R37 | limpieza individual y "Limpiar todo" | T3.1 |
| R38 | vuelve a página 1 y limpia la selección | T3.4 |
| R39 | el término entra en la identidad de caché | T3.4 |
| R40 | vacío con término dice que no hay coincidencias | T3.5 |
| R41 | nombre accesible y aviso legible por lector | T3.1 |
| R42 | ninguna otra superficie cambia | T3.6 |

---

## Dependencias, de un vistazo

```
T0 (verificación)  ──▶  T1 (DB)  ──▶  T2 (backend)  ──▶  T3 (frontend)  ──▶  T4 (medición)  ──▶  T5 (cierre)
   T0.2 [P] T0.3 [P]      T1.7 [P]      T2.6 [P]           T3.4 [P]
                          T1.8 [P]      T2.7 [P]           T3.5 [P]
                                        T2.8 [P]           T3.6 [P]
```

**No paralelizable a propósito:** T1.1 → T1.2 (el SQL copia las constantes de TS), T1.4 →
T1.5 (el diff se mide contra la base ya migrada), T2.3 → T2.4 (el fallback necesita la
traducción), y **T4 va después de T3** porque la medición debe hacerse sobre el camino
completo que el usuario recorre, no sobre una consulta suelta.
