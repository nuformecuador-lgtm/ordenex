# Columnas de descarga sin aserción de orden — cierre de la deuda que dejó la 189

> Rama: `chore/columnas-sin-asercion-orden` · Fecha: 2026-08-07 · Rol: FRONTEND_DEV
> Sin spec: el encargo es el enunciado. Solo tests, **cero líneas de producción**.
>
> **Veredicto en una línea: las 15 constantes pendientes quedan clavadas por clave Y por
> encabezado con esperado escrito a mano, las 15 mutaciones de control salieron ROJO 15/15
> —cada una tumbando su caso y dejando verdes a sus hermanos, con el árbol de producción
> restaurado y verificado por SHA-256 tras cada una—, y el caso nuevo de `_RANKING` caza la
> permuta que el test tautológico dejaba pasar: bajo la MISMA mutación, aquél VERDE (5/5) y
> éste ROJO. Quedan 0 constantes sin aserción de orden.**

---

## 1. El censo, medido antes y después

Detector propio (`.map((c) => c.clave)).toEqual([…])` y `.encabezado` anclados **al nombre de
la constante**, sobre `git ls-files -co` de `tests/**`), corrido contra el árbol antes y
después. La medición no se heredó del enunciado.

| | Antes | Después |
| --- | --- | --- |
| Constantes `COLUMNAS_DESCARGA_*` declaradas | **35** | 35 |
| Con aserción de **clave + encabezado**, directa | 19 | **34** |
| Parciales | 1 (`_ORDENES`) | 1 (`_ANALITICA_OPERATIVA`, ver más abajo) |
| Sin ninguna | 14 | **0** |

### Dos correcciones al censo del enunciado, medidas

**(a) Son 35, no 34.** La que falta en el conteo del encargo es
`COLUMNAS_DESCARGA_PAGOS_REGISTRADOS`, que vive en `components/shared/liquidacion/` y no en
`app/`. Un detector que recorra solo `app/` da exactamente 34 = 19 + 15, que es el número del
enunciado. **No falta trabajo por esto**: `_PAGOS_REGISTRADOS` ya tenía su aserción de orden
completa (`tests/unit/descarga/pagos-registrados-descarga-columnas.test.ts`), verificado, no
supuesto. Se anota porque el siguiente que mida esto va a volver a obtener 34 si recorre un
solo árbol, y porque la guardia de cobertura de tablas ya aprendió esa lección en la 172
(«los DOS árboles de UI, no solo `app/`»).

**(b) `_MIS_PAGOS` y `_DESGLOSE_MENSAJERO` SÍ tenían aserción de orden.** El enunciado las
lista como «mencionan pero sin afirmar el orden». No es cierto: `wallet-mensajero-descarga-
columnas.test.ts` las cubría desde la 170 con el esperado escrito a mano —pero dentro de un
`describe.each`, asertando sobre el parámetro `columnas`, no sobre la constante nombrada—. Ni
un grep ni un detector textual ven ahí una aserción sobre `COLUMNAS_DESCARGA_MIS_PAGOS`.

**Medido, no razonado.** Se recuperó la versión ANTERIOR del test a un archivo temporal, se
permutó cada constante y se corrió:

| Mutación sobre la versión ANTERIOR del test | Veredicto |
| --- | --- |
| `_MIS_PAGOS`, `fecha` ↔ `tipo` | **ROJO** (2 failed / 13 passed) — caía «columnas de descarga del ledger: 'mis pagos (mensajero)' › declara sus columnas ENUMERADAS…» |
| `_DESGLOSE_MENSAJERO`, `fecha` ↔ `tipo` | **ROJO** (2 failed / 13 passed) — caía el gemelo del `describe.each` |

Así que era un **falso positivo del detector, no un agujero**. Lo que se hizo: sacar esa
aserción del `describe.each` a **dos casos que nombran su constante**. Misma cobertura, cero
duplicación, y encontrable por quien la busque. Escribir dos casos nuevos «para tapar el
hueco» habría dejado el archivo con la afirmación por duplicado. El temporal se borró y el
árbol quedó limpio (`git status --porcelain` vacío, comprobado en el `finally` del script).

### La parcial que queda, y por qué no es deuda

`COLUMNAS_DESCARGA_ANALITICA_OPERATIVA` sale «parcial» en mi detector: su aserción de claves
es directa, pero la de encabezados va contra `ENCABEZADOS_CONTRATO`
(`tests/unit/analytics/export-csv-columnas.test.ts:40-49`), que es una **lista escrita a mano
en el propio test**, con un comentario que explica que se declara así a propósito para no
comparar el módulo consigo mismo. Es cobertura legítima —leída, no asumida— y por eso **no se
tocó**. Es el mismo tipo de indirección que tenían las dos del wallet; la diferencia es que
aquí el esperado sí es una constante del test, no un parámetro, así que el nombre está a la
vista de quien lea el archivo.

---

## 2. Los 15 casos: dónde viven y por qué agrupados así

El criterio de agrupación es el de la 189: **un archivo de test por módulo de producción**, no
uno por constante. Lo que decide es de dónde SALE la constante, no cómo se llama.

| Constantes | Archivo de test | Nuevo / Modificado | Por qué juntas |
| --- | --- | --- | --- |
| `_GESTIONES_ENTREGADAS`, `_GESTIONES_REPROGRAMADAS`, `_GESTIONES_DEVUELTAS`, `_GESTIONES_RECHAZADAS`, `_GESTIONES_INCIDENTES` | `tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts` | **nuevo** | Salen del MISMO módulo y comparten el bloque `COMUNES` de 7 columnas |
| `_DIA_ENTREGADAS`, `_DIA_REPROGRAMADAS`, `_DIA_DEVUELTAS`, `_DIA_RECHAZADAS`, `_DIA_INCIDENTES` | `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts` | modificado | Ídem, y ese archivo ya cubría la sexta constante del módulo (`_DIA_CIERRES_PASADOS`) |
| `_CUENTAS_POR_PAGAR` | `tests/unit/descarga/cuentas-por-pagar-descarga-columnas.test.ts` | **nuevo** | Módulo propio, una sola constante |
| `_RANKING` | `tests/unit/descarga/ranking-descarga-columnas.test.ts` | **nuevo** | Módulo propio; ver §4 |
| `_ORDENES` | `tests/unit/components/ordenes-descarga-columnas.test.ts` | modificado | Ya tenía casa desde la 151; partirlo habría dejado media pantalla en cada sitio |
| `_MIS_PAGOS`, `_DESGLOSE_MENSAJERO` | `tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts` | modificado | Ya tenía casa desde la 170 (§1b) |

**Las cinco y cinco piden agruparse, y el motivo no es la comodidad.** El 60-70 % de cada
listado de esos dos módulos es el mismo bloque `COMUNES`: leyendo un diff, una permuta dentro
de él —o una columna de dinero que se cuela en la sección equivocada— se ve idéntica en las
cinco. Cinco esperados independientes, escritos a mano y en el mismo archivo, es lo que
convierte esa confusión en cinco casos rojos a la vez en vez de en un archivo que nadie mira.

**Por qué `_DIA_*` va al archivo que ya existía y no a uno nuevo:** ese archivo lleva desde la
189 una nota de cabecera que dice literalmente que cubre SOLO `_DIA_CIERRES_PASADOS` y que las
otras cinco están censadas como pendientes. Meterlas en un archivo aparte habría dejado esa
nota mintiendo y las seis declaraciones de un mismo módulo repartidas en dos sitios. La nota
se actualizó en el mismo commit que las cubre.

### El homónimo, esquivado (y por escrito)

Las diez secciones por resultado son **homónimas dos a dos**:

```
_DIA_ENTREGADAS      (mensajero)  ≠  _GESTIONES_ENTREGADAS      (admin)
_DIA_REPROGRAMADAS   (mensajero)  ≠  _GESTIONES_REPROGRAMADAS   (admin)
_DIA_DEVUELTAS       (mensajero)  ≠  _GESTIONES_DEVUELTAS       (admin)
_DIA_RECHAZADAS      (mensajero)  ≠  _GESTIONES_RECHAZADAS      (admin)
_DIA_INCIDENTES      (mensajero)  ≠  _GESTIONES_INCIDENTES      (admin)
```

No son la misma pantalla y **no llevan las mismas columnas**: el mensajero no ve el ingreso de
Ordenex (flete, comisión, IVA, «Total Ordenex») ni la indemnización de un incidente, porque
ese dinero no es suyo (R24). Copiar un esperado de un archivo al otro da un listado plausible
y falso. Cada uno de los diez esperados se leyó de SU módulo, y el aviso queda en la cabecera
de **los dos** archivos de test —no en uno—, que es donde lo va a leer el próximo que llegue
por cualquiera de los dos lados. Se añadió el mismo tipo de aviso en `cuentas-por-pagar` (su
homónimo es el desglose del wallet, otra tabla del mismo módulo de etiquetas).

Una comprobación cruzada de que el aviso no es decorativo: las cinco parejas se diferencian en
**cuántas** columnas llevan (`_DIA_DEVUELTAS` 9 vs `_GESTIONES_DEVUELTAS` 13, por ejemplo), y
la tabla de mutaciones de §3 confirma que cada mutación tumbó **exactamente un** caso.

---

## 3. Las 15 mutaciones de control, una por constante

Método: un banco (script efímero, fuera del repo) que por cada constante (1) intercambia las
**dos primeras columnas literales** de SU bloque en el archivo de producción, (2) **relee del
disco y compara** —si el `writeFileSync` no llegó, aborta ahí mismo y no sigue—, (3) corre
SOLO el/los archivo(s) de test que la cubren, con `--reporter=verbose` para saber qué caso
concreto cayó, (4) reescribe el contenido original, (5) exige que el **SHA-256** coincida con
el de antes de mutar **y** que `git status --porcelain -- <ruta>` esté vacío.

Los archivos con varias constantes se mutaron **una constante a la vez**, no en bloque: las
cinco de gestiones son cinco mutaciones, y las cinco del día otras cinco.

| # | Constante | Permuta | Veredicto | Caso que se puso rojo | Hermanos | Restauración |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `_GESTIONES_ENTREGADAS` | `montoCobrar` ↔ `recibido` | **ROJO** | «la sección ENTREGADAS…» | 4 verdes | hash igual · limpio |
| 2 | `_GESTIONES_REPROGRAMADAS` | `montoCobrar` ↔ `nuevaFecha` | **ROJO** | «la sección REPROGRAMADAS…» | 4 verdes | hash igual · limpio |
| 3 | `_GESTIONES_DEVUELTAS` | `montoCobrar` ↔ `motivo` | **ROJO** | «la sección DEVUELTAS…» | 4 verdes | hash igual · limpio |
| 4 | `_GESTIONES_RECHAZADAS` | `origenRechazo` ↔ `montoCobrar` | **ROJO** | «la sección RECHAZADAS…» | 4 verdes | hash igual · limpio |
| 5 | `_GESTIONES_INCIDENTES` | `montoCobrar` ↔ `causa` | **ROJO** | «la sección INCIDENTES…» | 4 verdes | hash igual · limpio |
| 6 | `_DIA_ENTREGADAS` | `monto` ↔ `metodo` | **ROJO** | «la sección ENTREGADAS…» | 5 verdes | hash igual · limpio |
| 7 | `_DIA_REPROGRAMADAS` | `nuevaFecha` ↔ `motivo` | **ROJO** | «la sección REPROGRAMADAS…» | 5 verdes | hash igual · limpio |
| 8 | `_DIA_DEVUELTAS` | `motivo` ↔ `ganancia` | **ROJO** | «la sección DEVUELTAS…» | 5 verdes | hash igual · limpio |
| 9 | `_DIA_RECHAZADAS` | `motivo` ↔ `tieneEvidencia` | **ROJO** | «la sección RECHAZADAS…» | 5 verdes | hash igual · limpio |
| 10 | `_DIA_INCIDENTES` | `causa` ↔ `motivo` | **ROJO** | «la sección INCIDENTES…» | 5 verdes | hash igual · limpio |
| 11 | `_CUENTAS_POR_PAGAR` | `mensajero` ↔ `devengado` | **ROJO** | «declara sus columnas…» | — | hash igual · limpio |
| 12 | `_DESGLOSE_MENSAJERO` | `fecha` ↔ `tipo` | **ROJO** | «el DESGLOSE por cierre (admin)…» + el de paridad | 13 verdes | hash igual · limpio |
| 13 | `_MIS_PAGOS` | `fecha` ↔ `tipo` | **ROJO** | «MIS PAGOS (mensajero)…» + el de paridad | 13 verdes | hash igual · limpio |
| 14 | `_ORDENES` | `numGuia` ↔ `numRemision` | **ROJO** | «declara sus CLAVES…» + el de encabezados | 3 verdes | hash igual · limpio |
| 15 | `_RANKING` | `posicion` ↔ `mensajero` | **ROJO** | «declara sus columnas…» (ver §4) | 5 verdes | hash igual · limpio |

**15 ROJO / 0 VERDE.** Ninguna mutación quedó verde, así que no hay ningún test flojo que
reforzar.

La columna «Hermanos» es la que separa «el archivo falla» de «el test mide lo suyo»: en los
dos archivos de cinco constantes, cada mutación puso rojo **exactamente un** caso
(`1 failed | 4 passed (5)` y `1 failed | 5 passed (6)`). Un esperado copiado de una sección a
su hermana habría salido aquí como dos rojos a la vez, que era justo el riesgo del homónimo.

En #12 y #13 cae también el caso de **paridad** que ya existía («las dos vistas de la misma
tabla proyectan la MISMA fila»), y es correcto: permutar una sola de las dos constantes las
hace divergir, que es exactamente lo que ese caso vigila.

### Restauración, comprobada por hash

SHA-256 (prefijo de 16) de cada archivo de producción antes de mutar y después de restaurar —
**idénticos en las 15**, más las 2 mutaciones dirigidas de §5 y las 2 de §1b:

| Archivo de producción | SHA-256 (prefijo) |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas.ts` | `8f8bcb332893a9b3` |
| `app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas.ts` | `3f640e888fa70780` |
| `app/(app)/wallet/mensajeros/_components/cuentas-por-pagar-descarga-columnas.ts` | `faf4d2f3fe124c66` |
| `app/(app)/wallet/mensajeros/_components/desglose-mensajero-descarga-columnas.ts` | `03018bad4121d1d9` |
| `app/(app)/mis-pagos/_components/mis-pagos-descarga-columnas.ts` | `566dec5922cdd747` |
| `app/(app)/ordenes/_components/ordenes-descarga-columnas.ts` | `31a2c859eac91fcc` |
| `app/(app)/ranking/_components/ranking-descarga-columnas.ts` | `0ad902e039472913` |

El de `cierre-dia` (`3f640e888fa70780`) coincide con el que registró la 189 hace un día: el
módulo no se ha tocado desde entonces, y no lo tocó tampoco esta ficha.

Comprobación final, ya con todo restaurado: `git status --porcelain` **sin salida**.

---

## 4. `_RANKING`: el veredicto que se pedía

El caso que ya existía (`tests/components/descarga/RankingDescarga.test.tsx:138`) hace:

```ts
expect(columnas.map((c) => c.key)).toEqual(COLUMNAS_DESCARGA_RANKING.map((c) => c.clave));
```

El esperado **es la propia constante**: permutar dos columnas mueve los dos lados a la vez.
Verifica el cableado componente → `xlsx` (útil), pero no dice nada del orden.

**Los dos resultados bajo la MISMA mutación** (`posicion` ↔ `mensajero`, aplicada al módulo de
producción, con los dos archivos de test corridos en la misma invocación de vitest):

| Test | Veredicto |
| --- | --- |
| `tests/components/descarga/RankingDescarga.test.tsx` (el viejo, tautológico) | **VERDE — 5 de 5 casos pasan**, incluido el de la línea 138 |
| `tests/unit/descarga/ranking-descarga-columnas.test.ts` (el nuevo) | **ROJO** — «declara sus columnas en el orden de la pantalla (R5)» |

Salida literal: `Test Files 1 failed | 1 passed (2)` · `Tests 1 failed | 5 passed (6)`.

Es decir: con las dos primeras columnas del archivo intercambiadas —el usuario descargaría la
hoja con el nombre del mensajero bajo la cabecera «Posición»—, **el test que parecía cubrirlo
no se enteraba**. Ahora sí.

**El viejo no se tocó.** Comprueba otra cosa (que el componente pase al `xlsx` las columnas
declaradas y no las de la tabla) y esa cosa sigue haciendo falta. Lo que faltaba era el
esperado escrito a mano, y ése es el archivo nuevo. La cabecera del archivo nuevo explica esta
relación para que nadie borre uno pensando que el otro lo cubre.

---

## 5. Dos mutaciones dirigidas de propina (`_ORDENES`)

La permuta genérica de #14 pone rojos dos casos, lo que no prueba que el caso NUEVO aporte
algo: el viejo de encabezados ya la cazaba. La 189 censó el agujero de `_ORDENES` como «solo
se dice qué claves NO están». Medirlo exigía dos mutaciones más finas:

| Mutación | El caso NUEVO | Los 4 casos que ya existían |
| --- | --- | --- |
| **A.** `clave: "estatus"` → `"estadoOrden"`, encabezado `"Estado"` INTACTO | **ROJO** | 2 rojos, 2 verdes |
| **B.** claves de `provincia` y `canton` **intercambiadas entre sí**, los DOS encabezados donde estaban | **ROJO** | **4 VERDES** |

La **B** es la que importa. Encabezados intactos y conjunto de claves intacto: el archivo
saldría con el **cantón bajo la cabecera «Provincia»** y la provincia bajo «Cantón», y ninguna
de las cuatro aserciones que ya existían podía verlo —la de encabezados porque no cambian, y
las dos que recorren `CLAVES` porque comparan **conjuntos ordenados alfabéticamente**
(`Object.keys(fila).sort()).toEqual([...CLAVES].sort())`), que es ciego al orden—.

La **A** matiza a la baja la nota de la 189: un *renombre* de clave sí lo cazaban ya dos casos
(por `expect(vacia[clave]).not.toBeUndefined()` y por la igualdad de conjuntos), aunque con un
mensaje de fallo que no menciona columnas. El agujero real era el **orden**, no el nombre.
Queda escrito para que nadie lea la nota de la 189 como más grande de lo que era.

Las dos mutaciones se restauraron con la misma comprobación de hash y `git status` limpio.

---

## 6. Encabezados sospechosos — vistos al escribir los esperados, y NO tocados

Escribir 15 esperados a mano obliga a leer 15 encabezados. Esto es lo que apareció. **Nada de
esto se ha arreglado**: cambiar un encabezado cambia el archivo que un usuario descarga, y eso
es decisión de producto, no de un rol que estaba escribiendo tests. Congelarlo con un test es
justo lo que hay que evitar, así que se anota aquí y se dirige a quien corresponda.

### 6.1 ⚠️ `_CUENTAS_POR_PAGAR` — «Devengado» y «Pagado» viajan sin el aviso que los hace legibles

Es el hallazgo de esta ficha, y es de la misma familia que el «Monto mensual» que encontró la
189: un encabezado que es cierto **en pantalla** y deja de serlo en cuanto sale de ella.

La cadena, verificada contra el código:

1. La feature 172 (T H.4) documentó la limitación N1: `agregarCuentaPorPagar` agrupa por `tipo`
   **sin excluir nada**, así que el `ajuste_devengo` de un pago revertido engorda lo
   **devengado** y la `liquidacion` anulada sigue dentro de lo **pagado**. Los dos importes
   quedan más altos de lo que se movió de verdad. La **resta** —«Cuenta por pagar»— sale exacta.
2. Por eso la pantalla lleva un aviso OBLIGATORIO justo encima de la tabla
   (`CuentasPorPagarTable.tsx:215-217`, `role="note"`), con el texto de
   `CUENTAS_AVISO_BRUTOS`, que nombra las tres columnas y dice cuál es la buena.
3. **El archivo descargable no lleva nada de eso.** `CuentasPorPagarTable.tsx:241-249` cablea
   `columnas: COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR` y punto: cinco cabeceras, sin título de
   aviso, sin nota, sin asterisco. Quien recibe la hoja por correo ve «Devengado ₡X» y
   «Pagado ₡Y» sin la frase que dice que ninguno de los dos es lo que parece.

**Impacto hoy: vivo, no latente** —a diferencia del «Monto mensual», que aún no puede
dispararse porque la UI no crea plantillas no mensuales—. Cualquier mensajero con un pago
anulado ya produce esas dos cifras infladas, y el archivo es el sitio donde más fácil se
reenvían fuera de contexto.

**No es un defecto del encabezado ni de este test**: R8 pide que el archivo use la palabra de
la pantalla, y la usa. Es una decisión pendiente sobre el archivo. Las salidas posibles, sin
recomendar ninguna: llevar el aviso a una fila/hoja de notas del `xlsx`, renombrar esas dos
columnas en el archivo, o no exportarlas. **Las tres cambian lo que el usuario descarga**, así
que van a producto. Este test fija hoy `["Mensajero","Devengado","Pagado","Cuenta por
pagar","Estado"]`: **el día que se decida, hay que actualizarlo a la vez**, y por eso queda
dicho aquí y no solo en la cabecera del test.

### 6.2 `_GESTIONES_DEVUELTAS` — «IVA flete dev.», la única abreviatura con punto de las 35

Auditados los 35 listados por programa (encabezados repetidos, claves repetidas, espacios
sobrantes, abreviaturas): **cero duplicados** de encabezado o de clave en cualquier constante,
y **un solo** encabezado abreviado, `"IVA flete dev."`.

- **Es fiel a la pantalla**, comprobado: `cierre-detalle-shared.tsx:912` pinta exactamente ese
  texto. R8/R24 cumplidos, y por eso el esperado lo fija tal cual.
- Pero **el mismo módulo escribe el mismo concepto entero** unas líneas antes: la tarjeta de
  desglose del ingreso (`cierre-detalle-shared.tsx:682`) dice `"IVA flete devolución"`. Dos
  textos para un dato, en un archivo, según dónde se mire.
- Y a diferencia de su hermano agrupado (`FLETE_DEV_CON_IVA_LABEL`, que sí vive en
  `cierre-labels.ts`), estos dos son **literales sueltos** en el módulo de columnas. Es la misma
  divergencia que la 189 anotó para `"Causa"` e `"Indemnización"` en incidentes: hoy coinciden,
  y el día que alguien traduzca o retoque uno, el otro se queda atrás en silencio.

**Impacto hoy: ninguno visible. Riesgo: cosmético + divergencia futura.** No tocado.

### 6.3 `_DIA_ENTREGADAS` — «Monto», que en la pantalla es claro y en la hoja no

El encabezado es `"Monto"` y la celda es `montoRecibido`. En pantalla no hay ambigüedad: la
tabla del mensajero no tiene ninguna otra columna de dinero cobrable. En el archivo, «Monto»
entre «Tienda» y «Método» no dice si es lo que **debía** cobrar o lo que **cobró** —y su
gemela de admin (`_GESTIONES_ENTREGADAS`) distingue las dos con «A cobrar» y «Recibido»—.
**No miente**: es la palabra de la pantalla (R8), y por eso queda fijada. Se anota como
candidato menor si alguien revisa los textos del cierre del mensajero.

### 6.4 Lo que se comprobó y NO es defecto

- **«Ganancia» en las seis `_DIA_*`** en vez de «Pago mensajero»: es deliberado y está
  documentado (`cierre-dia-descarga-columnas.ts:34-38` y `CierreDiaModule.tsx:156-157`). El
  archivo usa la palabra de la pantalla que lo produce.
- **`_DIA_INCIDENTES` sin ninguna columna de dinero**: correcto (158/R17/R18). El backend ni
  siquiera selecciona `indemnizacion` en esa consulta.
- **El orden de las cinco `_DIA_*` contra el de la pantalla**: contrastado columna a columna
  con `columnasPara()` (`CierreDiaModule.tsx:840-937`). Coinciden en las cinco; las únicas
  diferencias son las esperadas —el archivo no lleva la columna de acciones (un botón) y
  sustituye el visor de evidencia por «Tiene evidencia: Sí/No» (R22)—.
- **`_RANKING` con «Entregadas» y «Asignadas»** que no son rótulos de ninguna columna de la
  tabla: correcto y documentado. La pantalla pinta una sola celda «Entregadas / asignadas» con
  `5/5`, y el archivo la parte en dos números crudos porque `5/5` no se suma (R7).

---

## 7. Qué queda sin cubrir

1. **Nada impide que la constante nº 36 nazca sin aserción de orden.** Esta ficha deja el censo
   a cero, pero a mano. El repo ya tiene la guardia que obliga a decidir si una tabla nueva
   descarga o no (`tests/unit/descarga/cobertura-tablas.guardia.test.ts` contra
   `censo-tablas.ts`, feature 170 T0.5) — pero esa guardia vigila **tablas**, no **listados de
   columnas**: una `<DataTable>` con descarga la caza; un `COLUMNAS_DESCARGA_*` nuevo sin test
   de orden, no. **Es el hueco natural para una guardia hermana** y no se ha construido aquí
   porque el encargo eran los 15 casos y su verificación, no una capacidad nueva. Dos cosas que
   quien la escriba necesita saber, y que salieron medidas de esta ficha: (a) tiene que
   recorrer `app/` **y** `components/`, o se deja fuera `_PAGOS_REGISTRADOS` (§1a); (b) un
   detector puramente textual da **falsos positivos** cuando la aserción va sobre un parámetro
   de `describe.each` o contra una constante intermedia del test —le pasaría hoy con
   `_ANALITICA_OPERATIVA`— (§1b). Registrar la ficha es decisión del leader.
2. **`_ANALITICA_OPERATIVA` sigue asertando sus encabezados contra `ENCABEZADOS_CONTRATO`** y
   no contra un literal en línea. Es cobertura real y verificada; se anota solo para que el
   detector de la eventual guardia no la marque como agujero.
3. **La decisión de §6.1 (`_CUENTAS_POR_PAGAR`)**, que es de producto y no de este rol.
4. **No se corrió la suite completa** (regla del repo). Lo que corrió está en §8.
5. **Ninguna afirmación sobre el `xlsx` producido**: estos 15 casos fijan lo que las constantes
   **declaran**. Que el archivo binario salga con esas cabeceras en ese orden lo cubren, para
   los listados que los tienen, los tests de `tests/integration/descarga-*` y los de componente;
   para las 15 de esta ficha, ese eslabón sigue apoyado en el contrato común de
   `construirDescarga`, no en un test por listado. Se anota como límite de alcance, no como
   deuda nueva: es el mismo alcance que tenían los 12 de la 189.

---

## 8. Verificación ejecutada

| Comprobación | Resultado |
| --- | --- |
| `pnpm exec vitest run tests/unit/descarga/ tests/unit/components/ordenes-descarga-columnas.test.ts` | **24 archivos / 132 tests, verdes** |
| 15 mutaciones de control (una por constante) | **15 ROJO / 0 VERDE** (§3) |
| 2 mutaciones dirigidas a `_ORDENES` | ROJO las dos; la B con los 4 casos previos en VERDE (§5) |
| 2 mutaciones sobre la versión ANTERIOR del test del wallet | ROJO las dos (§1b) |
| Restauración de las 19 mutaciones | SHA-256 igual en todas · `git status --porcelain` vacío |
| Auditoría de los 35 listados (duplicados / abreviaturas) | 0 duplicados · 1 abreviatura (§6.2) |
| Censo antes/después | 14 sin aserción → **0** (§1) |
| `./init.sh --rapido` | ver §9 |

---

## 9. Gate rápido

`./init.sh --rapido` → **`== init OK ==`**, salida 0. Sin rojos, sin flakes, sin repeticiones.

| Etapa | Resultado |
| --- | --- |
| `pnpm typecheck` (`tsc --noEmit`) | verde, sin salida |
| `pnpm lint` | **0 errores**, 49 avisos — todos preexistentes y en archivos ajenos; **cero** en los 6 archivos de esta ficha (la salida no los nombra ni una vez) |
| `pnpm run test:cambiados` (`vitest run --changed origin/dev`) | **6 archivos / 33 tests, verdes** |
| `pnpm run test:guardias` (`vitest run guard`) | **72 archivos / 996 tests, verdes** |
| `down.sql` de migraciones · `.env` | verde (ajenos a esta ficha) |

Los **6 archivos** que seleccionó `--changed` son exactamente los 6 de §10, y los **33 tests**
son exactamente los suyos (5 + 6 + 1 + 1 + 15 + 5). Es la comprobación que importa aquí: el
grafo de vitest engancha los tests nuevos con los módulos que vigilan, así que el gate rápido
los va a correr cuando alguien edite una de las constantes. Un test de columnas que el grafo no
engancha solo corre en el gate completo, es decir, tarde.

**No hubo ningún rojo con timeout de 20 s** en test de componente, así que no hizo falta el
protocolo de repetición en aislado. El único test de componente involucrado
(`RankingDescarga.test.tsx`, 5 casos) solo corrió dentro del banco de mutaciones y pasó las
dos veces —una en verde bajo mutación (§4), que es el hallazgo, y otra con el árbol limpio—.

El gate **completo** (`./init.sh` sin flags) no lo corre este rol: va antes del PR y lo lanza
el leader.

---

## 10. Archivos

**Creados** (3, todos solo-tests):

- `tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts`
- `tests/unit/descarga/cuentas-por-pagar-descarga-columnas.test.ts`
- `tests/unit/descarga/ranking-descarga-columnas.test.ts`

**Modificados** (3, todos solo-tests):

- `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts`
- `tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts`
- `tests/unit/components/ordenes-descarga-columnas.test.ts`

**Producción: cero líneas tocadas** en `app/`, `components/` y `lib/`, verificado por SHA-256
tras cada una de las 19 mutaciones y por `git status --porcelain` al terminar.
