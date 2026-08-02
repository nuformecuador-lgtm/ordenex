# chore — borrar la vista legacy del listado de órdenes

**Rama:** `chore/borrar-vista-legacy-ordenes` (desde `origin/dev` @ `c9fb63be`)
**Autorizado por el humano:** 2026-07-31, explícitamente.
**Naturaleza:** una RESTA. No se refactorizó nada de lo que queda.

---

## 1. Qué se borró

| Archivo | Por qué muere |
|---|---|
| `app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx` | La vista legacy. Ninguna página la monta; su único importador era su propio test. |
| `app/(app)/ordenes/_components/OrdenesApartado.tsx` | Su ÚNICO consumidor de producción era la vista legacy. Ver §2. |
| `tests/components/OrdenesRevisionMaestro.test.tsx` | 23 tests del componente borrado. |
| `tests/components/OrdenesApartado.test.tsx` | 6 tests del componente borrado. |
| `tests/components/descarga/OrdenesApartadoDescarga.test.tsx` | 5 tests de la descarga del componente borrado (feature 170, T A.1). |

### Cómo se verificó que la vista estaba muerta

- `app/(app)/ordenes/page.tsx` monta `OrdenesListado` (roles con filtro por estado:
  maestro, admin, adminTienda) u `OrdenesModule` (el resto). **Nunca**
  `OrdenesRevisionMaestro`.
- Búsqueda de importadores en todo el árbol: el único era
  `tests/components/OrdenesRevisionMaestro.test.tsx`.
- Sin `import()` dinámico, sin `dynamic()`, sin barrel/`index.ts` en `_components/`
  que pudiera re-exportarla: se comprobó explícitamente.
- Las menciones en `OrdenesListado.tsx` y `recepcion-satelite/_components/recibidas-columns.tsx`
  eran comentarios, no imports (confirmado).

Prueba extra de pudrición: `eslint` sobre la versión de `origin/dev` del archivo daba
`'mensajerosConRecoleccionIds' is assigned a value but never used` — una prop de la
feature 157 que se cableó en un componente que nadie veía.

---

## 2. `OrdenesApartado`: murió — con la evidencia delante

El encargo pedía verificarlo, no darlo por hecho en ninguna dirección. Resultado:

**Importadores en `origin/dev` (búsqueda `from "...OrdenesApartado"`):**

| Importador | ¿Vivo? |
|---|---|
| `app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx` | **No** — es la vista legacy que se borra |
| `tests/components/OrdenesApartado.test.tsx` | test *del propio componente* |
| `tests/components/descarga/OrdenesApartadoDescarga.test.tsx` | test *del propio componente* |
| `tests/components/descarga/ControlDescargaTransversal.test.tsx` | lo usaba como **representante** de una forma de cableado (ver §4) |

**Cero consumidores de producción fuera de la vista legacy.** Muere con ella.

La capacidad **no se pierde**: `/ordenes` ya lista órdenes filtrando por estado con
`OrdenesListado`/`OrdenesModule`, que además descarga a Excel (censo nº 1, «Órdenes
(listado principal)»). El apartado era una superficie redundante que nadie podía abrir.
Esto ya estaba anotado en `progress/impl_170-export-todas-las-tablas.md:1234`
(«`OrdenesApartado` está cableada pero NADIE la monta»).

---

## 3. Qué se conservó, y por qué

### 3.1 `RutearSateliteModal.tsx` — CONSERVADO (decisión que hay que mirar)

Es el único caso en que borrar «lo que cuelga» habría destruido capacidad viva.

- Su único montador de producción era la vista legacy.
- **Pero** su backend está entero y probado: `rutearABodegaSatelite`
  (`lib/actions/ordenes-guia.ts:231`), `GuiaAsignacionService.rutearABodegaSatelite`
  (`:548`), con tests de servicio y de acción.
- `OrdenesListado` **no** ofrece esa acción: el comentario del propio archivo dice que
  se retiró de `en_bodega_central` «por decisión humana», dejando a la vista legacy como
  única superficie.
- Conserva sus tests vivos: `tests/components/RutearSateliteModal.test.tsx` y
  `tests/components/ManifiestoFlujos.test.tsx`.

Consecuencia real, dicha sin adornos: **tras este borrado, «Rutear a bodega satélite» se
queda sin NINGUNA superficie de UI.** El modal se dejó en su sitio, listo para volver a
montarse. Retirar una capacidad de producto es una decisión del humano, no de un chore de
limpieza — y «es mucho peor llevarse por delante algo en uso». Queda declarado en el
código, en el comentario de `OrdenesListado.accionesDe`.

### 3.2 `listarCatalogoEstatus` — CONSERVADA

Server Action de `lib/actions/ordenes-guia.ts:253`. Tras el borrado su único consumidor
es `tests/integration/actions/ordenes-guia-action.test.ts`. Es **backend**, fuera del
alcance de este encargo (y de un frontend_dev), así que no se toca. Se declara como
posible huérfana para una limpieza de backend futura.

### 3.3 Vivos por otras vías — no se tocaron

`GenerarGuiaModal`, `AsignarBodegaModal`, `AsignarRecoleccionModal`,
`QuitarRecoleccionModal`, `EtiquetasGuiaModal` (todos en `OrdenesListado`, y los dos
últimos también en `OrdenesCargaResumen`/`EtiquetaOrdenAccion`);
`BodegaLiberadasHoy` (en `RecepcionSateliteModule`); `mensajero-options.ts` (en
`AsignarRecoleccionModal`); `listarMensajerosParaAsignacion` (en `OrdenesListado`).

### 3.4 Keys de SWR — comprobadas, sin acoplamiento vivo

Era el riesgo señalado en el encargo. Resultado: **ninguna key compartida con código vivo.**

| Key | Antes | Después |
|---|---|---|
| `"ordenes:catalogo-estatus"` | solo la vista legacy | desaparece |
| `"ordenes:apartado"` | `OrdenesApartado` + el `mutate` por prefijo de la vista legacy | desaparece |
| `"ordenes:mensajeros"` | vista legacy **y** `OrdenesListado:259` | queda solo `OrdenesListado` |

`"ordenes:mensajeros"` era la única compartida. No había dependencia de comportamiento
(la vista legacy no se montaba nunca), pero **la regla que la motivó sigue viva** y se
dejó escrita en `OrdenesListado.mensajerosFetcher`: quien añada otro fetcher bajo esa key
debe devolver la misma forma, o se reproduce el bug de formas incompatibles de 2026-07-16.

### 3.5 Documentos históricos — NO se reescriben

`specs/**` y los `progress/impl_*.md` son el registro de lo que se decidió y se hizo en su
momento: eran ciertos cuando se escribieron. Falsearlos borraría el motivo por el que hoy
los números son otros. En particular `specs/170-export-todas-las-tablas/design.md §1`
sigue diciendo «31 tablas = 25 + 6»; la divergencia se explica en el censo (§4).

`feature_list.json` **tampoco se tocó**: la descripción de la feature 71 cita
`OrdenesApartado.tsx:129-165` como «el punto a tocar». Re-alcanzar una feature pendiente
es decisión humana. Lo que sí se corrigió es la auditoría viva (§5).

---

## 4. El censo del export, después

`OrdenesApartado` era una de las 25 tablas `con_descarga` (Anexo I nº 2, «Apartado de
órdenes por estado»). Al desaparecer:

| Magnitud | Antes | Después |
|---|---|---|
| Tablas censadas totales | 31 | **30** |
| Dentro de alcance (`con_descarga`) | 25 | **24** |
| Fuera de alcance (`fuera`) | 6 | **6** (sin cambio) |
| Instancias de `<DataTable>` | 30 | **29** |
| Archivos con `<DataTable>` | 25 | **24** |
| `<table>` HTML cruda | 1 | 1 |
| Instancias `fuera` que son `<DataTable>` | 5 | 5 (sin cambio) |

El borrado se llevó una tabla **que descargaba**; no cambió ninguna decisión de alcance,
por eso las exclusiones siguen en 6/5.

**Archivos ajustados:**

- `tests/unit/descarga/censo-tablas.ts`: fuera la entrada de `OrdenesApartado.tsx`;
  cabecera con la divergencia respecto del spec 170 explicada y fechada.
- `tests/unit/descarga/cobertura-tablas.guardia.test.ts`: los números que fijaba la
  guardia — `TOTAL_ARCHIVOS_CON_DATATABLE` 25→**24**, `TOTAL_INSTANCIAS_DATATABLE`
  30→**29**, `totalCensado` 31→**30**, `con_descarga` 25→**24**. `fuera` se queda en 6 y
  las excluidas en 5.
- `tests/components/descarga/ControlDescargaTransversal.test.tsx`: **el suelo del barrido
  estático** `MODULOS_CON_DESCARGA.length >= 20` → `>= 19`, porque el archivo borrado
  declaraba `descarga={…}`. Sigue siendo un suelo, no una igualdad.

### El representante sustituido (no se perdió cobertura)

`ControlDescargaTransversal` juzga que **las tres formas de cableado se comportan igual**,
montando un componente real por forma. `OrdenesApartado` era el representante de «Familia A
con filtros». Se sustituyó por **`OrdenesModule`** (`filter={{ status_id }}`,
`permitirDescarga`), que es la misma forma —recorte server-side, filtro vigente, paginación
propia, `obtenerFilas` contra `listarOrdenesCompleto`— y **sí está montado** en `/ordenes`.
Además reusa los mocks que el archivo ya tenía (`@/lib/actions/ordenes`).

Se sustituyó en vez de eliminar la forma porque las 5 propiedades transversales
(R33/R34/R35/R37/R38) se afirman *por forma*: dejarlo en dos habría convertido «las tres se
comportan igual» en una afirmación sobre dos. El nº de tests del archivo no cambia (las
formas se recorren dentro de cada `it`).

---

## 5. Comentarios y referencias actualizados

Un comentario que remite a un archivo inexistente es peor que no tener comentario.

| Archivo | Qué decía → qué dice |
|---|---|
| `app/(app)/ordenes/_components/OrdenesListado.tsx` (fetcher) | «la key la comparte OrdenesRevisionMaestro» → hoy es el único fetcher; se conserva la REGLA de la forma común y el porqué |
| `app/(app)/ordenes/_components/OrdenesListado.tsx` (`accionesDe`) | «la vista legacy sí la ofrece» → «la acción se quedó sin ninguna superficie de UI»; apunta al backend vivo y al modal conservado |
| `app/(app)/recepcion-satelite/_components/recibidas-columns.tsx` | «igual que `OrdenesApartado` prepende su checkbox» → `OrdenesModule` (que hace exactamente lo mismo y existe) |
| `e2e/historial-orden.spec.ts` | «maestro/admin ven `OrdenesRevisionMaestro` SIN este botón» → ven `OrdenesListado`, que sí lo monta; se conserva el porqué del usuario semilla |
| `tests/integration/wallet-mensajeros-page.test.tsx`, `tests/components/CierreDetalleIncidente.test.tsx`, `tests/components/CuentasPorPagarTable.test.tsx` | citaban `OrdenesApartado.test.tsx` como precedente del `ToastProvider` → queda el precedente que sobrevive (`OrdenesDescarga.test.tsx`, 151) |
| `progress/current.md` (backlog, fila 71) | ver abajo |

### Hallazgo de paso: la feature 71 estaba diagnosticada contra código muerto

`progress/current.md` afirmaba: *«Sin empezar. `OrdenesApartado.tsx` no tiene `disabled` en
el checkbox de fila»*. Ese diagnóstico se hizo **sobre la vista legacy**. La superficie viva
(`OrdenesModule`) **sí** tiene `bloqueoSeleccion`: checkbox `disabled`, motivo en el tooltip
y un aviso cuando la página entera está bloqueada. La fila se marcó para **reevaluar**, sin
cambiar su estado en `feature_list.json` (re-alcanzarla es decisión humana).

---

## 6. Verificación

Entorno: el worktree no traía `.env` ni `node_modules`; `pnpm install --frozen-lockfile` +
`prisma generate` con `DATABASE_URL` de marcador antes del typecheck.

| Puerta | Resultado |
|---|---|
| `pnpm run typecheck` | **verde**, sin salida |
| `pnpm run lint` | **0 errores**, 18 warnings (baseline 20) |
| `pnpm test` | **711 archivos / 8537 tests — 8463 pasan, 74 se saltan, 0 fallos** |
| `./init.sh` | `== init OK ==` |

### El delta, explicado

| | Baseline `dev` | Ahora | Δ |
|---|---|---|---|
| Archivos de test | 714 | 711 | **−3** |
| Tests | 8571 | 8537 | **−34** |
| Tests que pasan | 8497 | 8463 | **−34** |
| Tests que se saltan | 74 | 74 | 0 |
| Fallos | 0 | 0 | 0 |
| Warnings de lint | 20 | 18 | **−2** |

**−3 archivos** = los 3 test files borrados.
**−34 tests** = 23 (`OrdenesRevisionMaestro`) + 6 (`OrdenesApartado`) + 5
(`OrdenesApartadoDescarga`). Contados uno a uno con `vitest run <archivo>` **antes** de
borrar: 23 + 6 + 5 = 34. Ni un test más: no se perdió ningún caso de un archivo que
sobreviva, y `ControlDescargaTransversal` mantiene sus 7.

**−2 warnings**: medidos, no supuestos. `eslint` sobre la versión `origin/dev` de los dos
componentes borrados devuelve exactamente 2 warnings —
`OrdenesApartado.tsx:129` (`react-hooks/exhaustive-deps` sobre `items`) y
`OrdenesRevisionMaestro.tsx:118` (`mensajerosConRecoleccionIds` nunca usada). 20 − 2 = 18.

---

## 7. Lo que NO se tocó (resumen para el revisor)

1. **`RutearSateliteModal.tsx`** y sus tests — conservado; su acción queda sin UI. **Pide
   decisión humana.**
2. **`listarCatalogoEstatus`** — posible huérfana de backend; fuera de alcance.
3. **`feature_list.json`** — la ficha de la feature 71 sigue citando el archivo borrado; se
   marcó en `current.md` en vez de reescribir la ficha.
4. **`specs/**` y `progress/impl_*.md`** — registro histórico, intacto.
5. **Nada se refactorizó.** Los cambios en archivos vivos son comentarios, salvo los
   números del censo/guardia y el representante sustituido en el test transversal.
