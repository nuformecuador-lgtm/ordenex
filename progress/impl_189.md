# 189 — Fijar columnas y orden de los 12 listados descargables del Anexo A

> Rama: `feature/189-columnas-descarga-listados` · Fecha: 2026-08-06 · Rol: FRONTEND_DEV
> `sdd: false` — sin spec; el encargo es el enunciado de la ficha. Zona frontend, complejidad small.
>
> **Veredicto en una línea: las 12 constantes quedan clavadas por clave Y por encabezado con 12
> casos nuevos en 7 archivos, y las 24 mutaciones (12 reordenar + 12 quitar) se ejecutaron una a
> una con veredicto ROJO 24/24 —cada una tumbando EXACTAMENTE su caso y dejando verdes a sus
> hermanos del mismo archivo—, con el árbol de producción restaurado y verificado por SHA-256
> tras cada mutación; código de producción, cero líneas tocadas.**

---

## 1. Qué había antes, y por qué no bastaba

Lo único que sujetaba estas columnas eran `toContain` de un encabezado suelto y aserciones sobre
`filas[i].campo`. Las dos son **insensibles al orden**: `expect(headers).toContain("Estado")` sigue
verde con "Estado" en cualquier posición, y `filas[0].motivo` no sabe si `motivo` es la tercera
columna o la última. Reordenar o quitar una columna de un archivo que un usuario descarga no ponía
rojo nada.

El molde es el de `tests/unit/descarga/api-keys-descarga-columnas.test.ts:23-38`: **dos**
aserciones por constante, `clave` y `encabezado`, con el esperado escrito **a mano**. Nunca
`COLUMNAS.map(...)` a los dos lados, que es una tautología que pasa siempre — el patrón que este
repo lleva dos semanas cazando.

Detalle deliberado: los encabezados que vienen de constantes compartidas (`PAGO_MENSAJERO_COL`,
`INGRESO_BODEGA_RECHAZOS_COL`, `GANANCIA_COL`) se fijan por su **texto** (`"Pago mensajero"`,
`"Ingreso bodega"`, `"Ganancia"`), no importando la constante. Lo que llega al archivo del usuario
es el texto; si alguien lo cambia, el test tiene que enterarse.

---

## 2. Los 12 casos: archivo del test y nombre literal

| # | Constante | Archivo del test | Nombre literal del caso |
| --- | --- | --- | --- |
| 1 | `COLUMNAS_DESCARGA_CIERRES_PENDIENTES` | `tests/unit/descarga/cierres-admin-descarga-columnas.test.ts` | `la COLA de pendientes declara sus columnas en el orden de la pantalla (R5)` |
| 2 | `COLUMNAS_DESCARGA_CIERRES_HISTORICO` | `tests/unit/descarga/cierres-admin-descarga-columnas.test.ts` | `el HISTÓRICO de resueltos declara sus columnas en el orden de la pantalla (R5)` |
| 3 | `COLUMNAS_DESCARGA_BODEGA_PENDIENTES` | `tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts` | `la COLA de pendientes del maestro declara sus columnas en el orden de la pantalla (R5)` |
| 4 | `COLUMNAS_DESCARGA_BODEGA_RESUELTOS` | `tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts` | `el HISTÓRICO de resueltos declara sus columnas en el orden de la pantalla (R5)` |
| 5 | `COLUMNAS_DESCARGA_CONSOLIDABLES` | `tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts` | `los cierres del día A CONSOLIDAR declaran sus columnas en el orden de la pantalla (R5)` |
| 6 | `COLUMNAS_DESCARGA_BODEGA_SOLICITADOS` | `tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts` | `los cierres de bodega YA SOLICITADOS declaran sus columnas en el orden de la pantalla (R5)` |
| 7 | `COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS` | `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts` | `el histórico de CIERRES PASADOS declara sus columnas en el orden de la pantalla (R5)` |
| 8 | `COLUMNAS_DESCARGA_INCIDENTES_PENDIENTES` | `tests/unit/descarga/incidentes-descarga-columnas.test.ts` | `la COLA de pendientes declara sus columnas en el orden de la pantalla (R5)` |
| 9 | `COLUMNAS_DESCARGA_INCIDENTES_HISTORICO` | `tests/unit/descarga/incidentes-descarga-columnas.test.ts` | `el HISTÓRICO de resueltos declara sus columnas en el orden de la pantalla (R5)` |
| 10 | `COLUMNAS_DESCARGA_SATELITE` | `tests/unit/descarga/satelite-descarga-columnas.test.ts` | `declara sus columnas en el orden de la pantalla (R5)` |
| 11 | `COLUMNAS_DESCARGA_GASTOS_FIJOS` | `tests/unit/descarga/gastos-fijos-descarga-columnas.test.ts` | `declara sus columnas en el orden de la pantalla (R5)` |
| 12 | `COLUMNAS_DESCARGA_SALDOS_TIENDAS` | `tests/unit/descarga/saldos-tiendas-descarga-columnas.test.ts` | `declara sus columnas en el orden de la pantalla (R5)` |

Los casos 1/8 y 2/4/9 repiten nombre, pero viven en archivos distintos: vitest los identifica por
`archivo > describe > it` y cada `describe` nombra su pantalla. La tabla de mutaciones de §3
confirma que no hay ambigüedad —cada mutación tumba uno y solo uno—.

**El homónimo, esquivado:** `tests/unit/descarga/plantillas-descarga-columnas.test.ts` ya existía y
cubre `COLUMNAS_DESCARGA_PLANTILLAS`, las plantillas **de mensaje** de `configuracion/plantillas`.
Las «Plantillas de gasto fijo» son `COLUMNAS_DESCARGA_GASTOS_FIJOS` y son otra pantalla: van a
`gastos-fijos-descarga-columnas.test.ts`, archivo nuevo. Ni se sobrescribió ni se reutilizó nombre;
el aviso queda escrito en la cabecera del archivo nuevo para el próximo que pase por aquí.

### Nota de alcance — `cierre-dia-descarga-columnas.test.ts`

El módulo de origen declara **seis** constantes; la ficha pide **una**
(`_DIA_CIERRES_PASADOS`). Las otras cinco (`_DIA_ENTREGADAS`, `_DIA_REPROGRAMADAS`,
`_DIA_DEVUELTAS`, `_DIA_RECHAZADAS`, `_DIA_INCIDENTES`) **NO** se cubrieron y están censadas en §4.
Añadirlas de propina, sin ejecutar su mutación, sería exactamente el test que no se ha visto fallar.

---

## 3. Las 24 mutaciones

Método, y por qué así. Un banco automatizado (script efímero, fuera del repo) que por cada
constante: (1) muta el bloque en el archivo de producción, (2) **relee del disco y compara** —si el
`writeFileSync` no llegó, aborta ahí mismo—, (3) corre SOLO el archivo de test correspondiente,
(4) restaura con `git checkout -- <ruta>`, (5) compara el **SHA-256** del archivo contra el de
antes de mutar y exige `git status --porcelain -- app/` **vacío**; si cualquiera de las dos falla,
el banco para en seco y no sigue con la siguiente.

Esa parada no es ceremonia: en este repo ya le pasó a un agente que un `writeFileSync` falló por un
lock de Windows y **dejó la mutación aplicada en código de producción**. Restaurar con `git
checkout` en vez de reescribir el contenido original es la otra mitad de la precaución — no depende
de que un segundo write tenga éxito.

`reordenar` = intercambia las **dos primeras** columnas contiguas del bloque.
`quitar` = borra la **primera** columna del bloque.

| # | Constante | Mutación | Qué se mutó | Veredicto | Caso que se puso rojo | Hermanos del archivo | Restauración |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `_CIERRES_PENDIENTES` | reordenar | `estado` ↔ `mensajero` | **ROJO** | «la COLA de pendientes…» | 1 verde | hash igual · `app/` limpio |
| 2 | `_CIERRES_PENDIENTES` | quitar | fuera `estado` | **ROJO** | «la COLA de pendientes…» | 1 verde | hash igual · `app/` limpio |
| 3 | `_CIERRES_HISTORICO` | reordenar | `estado` ↔ `mensajero` | **ROJO** | «el HISTÓRICO de resueltos…» | 1 verde | hash igual · `app/` limpio |
| 4 | `_CIERRES_HISTORICO` | quitar | fuera `estado` | **ROJO** | «el HISTÓRICO de resueltos…» | 1 verde | hash igual · `app/` limpio |
| 5 | `_BODEGA_PENDIENTES` | reordenar | `zona` ↔ `solicito` | **ROJO** | «la COLA de pendientes del maestro…» | 3 verdes | hash igual · `app/` limpio |
| 6 | `_BODEGA_PENDIENTES` | quitar | fuera `zona` | **ROJO** | «la COLA de pendientes del maestro…» | 3 verdes | hash igual · `app/` limpio |
| 7 | `_BODEGA_RESUELTOS` | reordenar | `estado` ↔ `zona` | **ROJO** | «el HISTÓRICO de resueltos…» | 3 verdes | hash igual · `app/` limpio |
| 8 | `_BODEGA_RESUELTOS` | quitar | fuera `estado` | **ROJO** | «el HISTÓRICO de resueltos…» | 3 verdes | hash igual · `app/` limpio |
| 9 | `_CONSOLIDABLES` | reordenar | `mensajero` ↔ `efectivo` | **ROJO** | «los cierres del día A CONSOLIDAR…» | 3 verdes | hash igual · `app/` limpio |
| 10 | `_CONSOLIDABLES` | quitar | fuera `mensajero` | **ROJO** | «los cierres del día A CONSOLIDAR…» | 3 verdes | hash igual · `app/` limpio |
| 11 | `_BODEGA_SOLICITADOS` | reordenar | `estado` ↔ `fechaSolicitud` | **ROJO** | «los cierres de bodega YA SOLICITADOS…» | 3 verdes | hash igual · `app/` limpio |
| 12 | `_BODEGA_SOLICITADOS` | quitar | fuera `estado` | **ROJO** | «los cierres de bodega YA SOLICITADOS…» | 3 verdes | hash igual · `app/` limpio |
| 13 | `_DIA_CIERRES_PASADOS` | reordenar | `estado` ↔ `destino` | **ROJO** | «el histórico de CIERRES PASADOS…» | — | hash igual · `app/` limpio |
| 14 | `_DIA_CIERRES_PASADOS` | quitar | fuera `estado` | **ROJO** | «el histórico de CIERRES PASADOS…» | — | hash igual · `app/` limpio |
| 15 | `_INCIDENTES_PENDIENTES` | reordenar | `numRemision` ↔ `numGuia` | **ROJO** | «la COLA de pendientes…» | 1 verde | hash igual · `app/` limpio |
| 16 | `_INCIDENTES_PENDIENTES` | quitar | fuera `numRemision` | **ROJO** | «la COLA de pendientes…» | 1 verde | hash igual · `app/` limpio |
| 17 | `_INCIDENTES_HISTORICO` | reordenar | `estado` ↔ `numRemision` | **ROJO** | «el HISTÓRICO de resueltos…» | 1 verde | hash igual · `app/` limpio |
| 18 | `_INCIDENTES_HISTORICO` | quitar | fuera `estado` | **ROJO** | «el HISTÓRICO de resueltos…» | 1 verde | hash igual · `app/` limpio |
| 19 | `_SATELITE` | reordenar | `numGuia` ↔ `numRemision` | **ROJO** | «declara sus columnas…» | — | hash igual · `app/` limpio |
| 20 | `_SATELITE` | quitar | fuera `numGuia` | **ROJO** | «declara sus columnas…» | — | hash igual · `app/` limpio |
| 21 | `_GASTOS_FIJOS` | reordenar | `concepto` ↔ `monto` | **ROJO** | «declara sus columnas…» | — | hash igual · `app/` limpio |
| 22 | `_GASTOS_FIJOS` | quitar | fuera `concepto` | **ROJO** | «declara sus columnas…» | — | hash igual · `app/` limpio |
| 23 | `_SALDOS_TIENDAS` | reordenar | `tienda` ↔ `saldo` | **ROJO** | «declara sus columnas…» | — | hash igual · `app/` limpio |
| 24 | `_SALDOS_TIENDAS` | quitar | fuera `tienda` | **ROJO** | «declara sus columnas…» | — | hash igual · `app/` limpio |

**24 de 24 en ROJO. Ninguna mutación quedó verde**, así que no hay hallazgo de test flojo que
arreglar.

Lo que la columna «Hermanos» añade, y que la ficha no pedía pero es la diferencia entre «el archivo
falla» y «el test mide lo suyo»: en los archivos con 2 y 4 constantes, cada mutación puso rojo
**exactamente un** caso y dejó verdes los demás (`1 failed | 3 passed (4)` en los cuatro de bodega,
`1 failed | 1 passed (2)` en los pares). Un esperado copiado de una tabla a otra habría salido aquí
como dos casos rojos a la vez.

### Restauración, comprobada por hash

Hash SHA-256 (16 hex) de cada archivo de producción **antes de la primera mutación** y **después de
cada una de las 24 restauraciones** — idénticos en las 24:

| Archivo de producción | SHA-256 (prefijo) |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierres-admin-descarga-columnas.ts` | `b3da3fcc87f152bf` |
| `app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas.ts` | `010aaf9ef6eff17d` |
| `app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas.ts` | `3f640e888fa70780` |
| `app/(app)/incidentes/_components/incidentes-descarga-columnas.ts` | `6b7ee24b6d206271` |
| `app/(app)/recepcion-satelite/_components/satelite-descarga-columnas.ts` | `c28e4a6c68217fac` |
| `app/(app)/wallet/_components/gastos-fijos-descarga-columnas.ts` | `ea04d64ab1708948` |
| `app/(app)/wallet/tiendas/_components/saldos-tiendas-descarga-columnas.ts` | `cbdc14d64441a859` |

Comprobación final independiente del banco, ya con todo restaurado:

```
$ git status --porcelain -- app/ components/ lib/     # (sin salida)
$ git diff --stat                                     # solo progress/current.md, ajeno a esta ficha
```

El banco se corrió **dos veces enteras** (48 mutaciones en total): la primera para el veredicto, la
segunda para capturar qué caso concreto caía en cada una. Las dos terminaron con `app/` limpio.

---

## 4. Censo de las 35 constantes `COLUMNAS_DESCARGA_*`

El árbol declara **35** constantes de columnas de export (`app/` + `components/`, por la convención
`*-descarga-columnas.ts`).

- **11** ya tenían aserción de orden antes de esta ficha.
- **12** la ganan aquí.
- **12** siguen **sin** aserción de orden.

### Las 12 que quedan sin cubrir (dato para decidir si hace falta ficha hermana)

| Constante | Archivo |
| --- | --- |
| `COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS` | `app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas.ts` |
| `COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS` | ídem |
| `COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS` | ídem |
| `COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS` | ídem |
| `COLUMNAS_DESCARGA_GESTIONES_INCIDENTES` | ídem |
| `COLUMNAS_DESCARGA_DIA_ENTREGADAS` | `app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas.ts` |
| `COLUMNAS_DESCARGA_DIA_REPROGRAMADAS` | ídem |
| `COLUMNAS_DESCARGA_DIA_DEVUELTAS` | ídem |
| `COLUMNAS_DESCARGA_DIA_RECHAZADAS` | ídem |
| `COLUMNAS_DESCARGA_DIA_INCIDENTES` | ídem |
| `COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR` | `app/(app)/wallet/mensajeros/_components/cuentas-por-pagar-descarga-columnas.ts` |
| `COLUMNAS_DESCARGA_RANKING` | `app/(app)/ranking/_components/ranking-descarga-columnas.ts` |

Tres observaciones sobre esa lista, por si sirven para dimensionar la ficha hermana:

1. **Diez de las doce son las secciones por resultado** de dos módulos gemelos (el detalle del
   admin y el del mensajero). Comparten un bloque `COMUNES` de 7 columnas y se diferencian en las
   2-4 finales: es el caso donde una permuta pasa más desapercibida, porque el 70 % del archivo se
   ve idéntico en los cinco. Son también las diez más baratas de cubrir, por la misma razón.
2. **`COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR` no aparece ni una vez en `tests/`.** No es que su
   aserción de orden sea débil: es que ningún test la nombra. De las 35 es la única en ese estado.
3. **`COLUMNAS_DESCARGA_RANKING` parece cubierta y no lo está.** En
   `tests/components/descarga/RankingDescarga.test.tsx:138` hay
   `expect(columnas.map((c) => c.key)).toEqual(COLUMNAS_DESCARGA_RANKING.map((c) => c.clave))`.
   Eso comprueba que el **componente** pasa al `xlsx` las columnas declaradas —cosa útil—, pero el
   esperado **es la propia constante**: reordenar la constante mueve los dos lados a la vez y el
   test sigue verde. Es la tautología del enunciado, con disfraz de test de integración. Quien tome
   la ficha hermana tiene aquí un caso ya escrito que hay que **sustituir**, no completar.

### Las 11 que ya estaban cubiertas (verificado, no asumido)

`_API_KEYS`, `_USUARIOS`, `_PLANTILLAS`, `_MI_WALLET`, `_WALLET_CAJA`, `_DESGLOSE_TIENDA`,
`_DESGLOSE_MENSAJERO`, `_MIS_PAGOS`, `_PAGOS_REGISTRADOS`, `_ANALITICA_OPERATIVA` y `_ORDENES`.

Dos matices comprobados uno a uno, no dados por buenos por el nombre del test:

- **`_ANALITICA_OPERATIVA`** asserta contra `CLAVES_CONTRATO` / `ENCABEZADOS_CONTRATO`
  (`tests/unit/analytics/export-csv-columnas.test.ts:29,40`), que **son listas escritas a mano** en
  el propio test. Es una aserción de orden legítima, no una tautología.
- **`_ORDENES` está cubierta A MEDIAS**: `tests/unit/components/ordenes-descarga-columnas.test.ts:175`
  fija los 15 **encabezados** en orden, pero **no** las claves —la línea 52 hace
  `const CLAVES = COLUMNAS_DESCARGA_ORDENES.map((c) => c.clave)` y solo la usa con `not.toContain`—.
  Una permuta de dos columnas se detecta por el encabezado, así que el agujero es estrecho; pero si
  alguien cambiara la `clave` de una columna sin tocar su encabezado, nada lo vería. Queda anotado,
  **no tocado** (fuera del alcance de esta ficha, que enumera 12 constantes y `_ORDENES` no es una).

---

## 5. Defectos vistos y NO tocados

La ficha prohíbe arreglar el código de producción: un cambio en una constante cambia un archivo que
un usuario descarga. Se anotan, no se corrigen.

1. **`incidentes-descarga-columnas.ts` duplica dos textos que ya tienen constante compartida.**
   Escribe `encabezado: "Causa"` (línea 31 y 60) y `encabezado: "Indemnización"` (línea 61) como
   literales, mientras `cierres-admin/_components/cierre-labels.ts:82-83` exporta
   `CAUSA_INCIDENTE_COL = "Causa"` e `INDEMNIZACION_COL = "Indemnización"` — que **sí** importan
   `cierre-gestiones-descarga-columnas.ts:222,225` y `cierre-dia-descarga-columnas.ts:158`. Y el
   módulo de incidentes ya importa de `cierre-labels` (`ESTADO_LABEL`, línea 23), así que no es que
   no llegara. Es justo lo que la cabecera de `cierre-labels.ts` dice que quiere evitar: «dos copias
   de un texto compartido es como el archivo y la tabla acaban divergiendo». Hoy coinciden; el día
   que alguien traduzca o retoque la etiqueta compartida, el archivo de incidentes se queda atrás en
   silencio. **Impacto hoy: ninguno visible. Riesgo: divergencia futura.** No tocado.

2. **Sin hallazgo en las 24 mutaciones.** No hubo ninguna verde, así que no hay ningún test que
   haya habido que reforzar ni ninguna constante bajo sospecha.

Dos cosas que **parecían** defecto y no lo son, comprobadas contra la pantalla para no dejar la duda
abierta:

- **`_DIA_CIERRES_PASADOS` usa `"Total"` y `"Ganancia"`** donde las tablas de admin usan `"Total
  general"` y `"Pago mensajero"`. Es correcto: `CierreDiaModule.tsx:1019` pinta `value: "Total"`, y
  `GANANCIA_COL` está documentado como «su palabra para el mismo dato». El archivo usa la palabra de
  la pantalla que lo produce (R8).
- **`_SATELITE` declara 13 columnas** y la tabla parecía tener 12, con los intentos como badge. No:
  `recibidas-columns.tsx:51` inserta `columnaIntentos()` como columna propia justo tras `estatus`,
  que es exactamente la posición 4 del archivo. Coinciden.

---

## 6. Verificación ejecutada

Lo que corrió este rol (el gate completo lo corre el leader, `AGENTS.md`):

| Comprobación | Resultado |
| --- | --- |
| `pnpm typecheck` | verde (`tsc --noEmit`, sin salida) |
| `pnpm lint` | **0 errores**, 48 avisos — todos preexistentes y en archivos ajenos; **cero** en los 7 archivos nuevos (comprobado filtrando la salida por sus rutas) |
| `pnpm exec vitest run <los 7 archivos>` | **7 archivos / 12 tests, todos verdes** |
| `pnpm exec vitest related --run <los 7 archivos nuevos>` | 7 archivos / 12 tests, verdes |
| `pnpm exec vitest related --run <los 7 módulos de producción>` | **39 archivos / 560 tests, verdes** (45 s) |
| 24 mutaciones dirigidas | 24 ROJO / 0 VERDE (§3) |

La última fila es la que importa para el gate rápido: confirma que **el grafo relaciona los tests
nuevos con las constantes**, así que `./init.sh --rapido` los seleccionará cuando alguien edite uno
de los 7 módulos. Un test de columnas que el grafo no engancha al archivo que vigila es un test que
solo corre en el gate completo, es decir, tarde.

No se corrió la suite completa (regla del repo). No se vio ningún rojo en archivo ajeno.

---

## 7. Archivos

**Creados** (7, todos solo-tests):

- `tests/unit/descarga/cierres-admin-descarga-columnas.test.ts`
- `tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts`
- `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts`
- `tests/unit/descarga/incidentes-descarga-columnas.test.ts`
- `tests/unit/descarga/satelite-descarga-columnas.test.ts`
- `tests/unit/descarga/gastos-fijos-descarga-columnas.test.ts`
- `tests/unit/descarga/saldos-tiendas-descarga-columnas.test.ts`

**Modificados:** ninguno de producción. **Cero líneas** tocadas en `app/`, `components/` y `lib/`,
verificado con `git status --porcelain` tras las 48 mutaciones de las dos pasadas.
