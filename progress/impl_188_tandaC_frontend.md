# 184 — la parte FRONTEND de la Tanda C (listado 1: «Cierres solicitados por el mensajero»)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: FRONTEND_DEV
>
> Alcance entregado: **C.2 y C.3**. Punto de partida: `progress/impl_184_tandaC_backend.md` (la
> Server Action ya estaba, verde y con 17 mutaciones). `lib/**`, `db/**` y los tests de backend
> **no se tocan**.
>
> **Veredicto en una línea: el listado más caro POR RED del inventario deja de pedir la
> relectura que firmaba en lote las evidencias del día contra Supabase Storage —firmas que el
> archivo no usaba— y `PENDIENTES_184` baja de nueve a OCHO; 8 mutaciones ejecutadas, las 8
> rojas.**

---

## 1. Qué se hizo

Un commit con **la pantalla y su línea del censo dentro** (`722bc801`), como exige
`tasks.md > Notas de ejecución`; la mutación **MC2** mide justamente la mitad que faltaría si no
fuera así (mover el censo sin mover la pantalla). Un segundo commit (`561d3cde`) endurece el caso
de R2 con lo que **MC4** dejó ver.

### C.2 — la pantalla

`app/(app)/cierre-dia/_components/CierreDiaModule.tsx` (`:601-620`):

| Antes (T I.2) | Ahora (T C.2) |
| --- | --- |
| `filasDelConjuntoCompleto(listarCierreDia().then(res => …cierresPasados), …)` | `filasDesdeResultado(listarCierresPasadosCompleto(), filaDescargaDiaCierrePasado)` |
| el archivo salía del listado **compuesto**: 4 lecturas, la tarifa por zona+vehículo y **`createSignedUrls` sobre las evidencias de TODAS las gestiones del día** | una lectura dedicada: una consulta, **cero firmas** |
| tope de 5000 evaluado en el **cliente** (`filasLocales` dentro del adaptador) | tope evaluado en el **servidor** (R6): por encima no viaja ni una fila |

El comentario que defendía la relectura **no se borró, se corrigió**: la frase que valía —el
archivo es el CONJUNTO del mensajero y ese acotamiento lo pone el servidor desde la sesión (R44)—
sigue siendo cierta; lo que cambia es de dónde sale ese conjunto.

**Por qué esto no se veía en el archivo, y por eso llevaba aquí desde la 170:** las ocho columnas
salen enteras del `CierrePasadoDTO`, que **no tiene campo de evidencia**. El xlsx es byte a byte
el mismo firmando y sin firmar. No hay ningún test sobre las filas que pueda distinguirlo — hace
falta contar llamadas, y de eso va §3 (MC3).

El import de `listarCierreDia` sale del módulo porque ya no queda ningún uso.

### C.3 — el censo, en el MISMO commit

`tests/components/paginacion/paginacion-transversal.test.tsx`: el listado 1 pasa a
`adaptador: "completo"` y sale de `PENDIENTES_184`. **Quedan ocho.**

**La excepción del Anexo IV se conserva tal cual.** Este módulo hospeda además las cuatro
secciones agrupadas por resultado, que usan `filasLocales` legítimamente (`:548-549`) y están
declaradas en `CONVIVEN_ANEXO_III_Y_IV`. No se tocó ni la excepción ni esas descargas; el caso
del censo que las cubre («el censo del Anexo IV son TRES, con motivo…») sigue verde.

### Efecto colateral, medido y anotado

Tras C.2, **`listarCierreDia()` tiene un solo consumidor de producción**:
`app/(app)/cierre-dia/page.tsx:28`, el Server Component que resuelve la pantalla. Es el tercer
caso del mismo patrón (`listarRecepcionSatelite()` tras la tanda A, `listarConsolidacion()` tras
la B) y **no se actúa sobre él**: reducir ese contrato es un cambio de superficie que ningún
requisito de esta feature necesita. Queda anotado para quien lo decida.

---

## 2. Archivos

**Producción (1)**

- `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` — el adaptador, los dos imports y el
  comentario que explica qué se dejó de pagar.

**Tests (3)**

- `tests/components/descarga/CierresDescarga.test.tsx` — **+4 casos (14 → 18)**, más el doble de
  la acción nueva.
- `tests/components/paginacion/paginacion-transversal.test.tsx` — C.3 (el `adaptador` y la línea
  de `PENDIENTES_184`).
- `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` — **peaje** (§4).

**Cero** cambios en `lib/**`, `db/**`, `components/**`, `feature_list.json` ni en la
configuración de `useSWR` de ninguna pantalla (**R33**: el objeto de opciones de `useSWR` de
`CierreDiaModule` no aparece en el diff).

---

## 3. Las 8 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, **se restaura solo el archivo mutado por su
ruta** (`git checkout -- "$archivo"`, nunca `-- .`), y el guion imprime qué archivos MÍOS quedan
sucios: salió `[]` las 8 veces. Guion:
`scratchpad/tandaC_front_mutar.py`. Se ejecutan sobre los tres archivos que esta tanda toca.

```
=== MC1 (C.2/R1) la pantalla vuelve a sacar el archivo del listado COMPUESTO
  × el archivo de los cierres del mensajero sale de su lectura DEDICADA, no del listado compuesto (R1/R8) 113ms
  × descargar los cierres del mensajero ya no dispara la relectura que FIRMA las evidencias (R9) 92ms
  × la pantalla NO recorta ni reordena el conjunto de cierres del mensajero que devolvió el servidor (R2) 96ms
  × un fallo de la lectura de los cierres del mensajero no produce archivo y el mensaje no lleva datos personales (R7) 1106ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 7ms
  Tests  5 failed | 27 passed (32)
  AssertionError: Cierres solicitados por el mensajero: su descarga no va al servidor por el conjunto (R52):
                  expected '"use client";…' to match /filasDesdeResultado\(/

=== MC2 (C.3/R30) el censo declara el listado 1 pendiente aunque su pantalla ya migro
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 5ms
  Tests  1 failed | 31 passed (32)
  AssertionError: Cierres solicitados por el mensajero: su descarga no va al servidor por el conjunto (R52):
                  expected '"use client";…' to match /filasDelConjuntoCompleto\(/

=== MC3 (C.2/R9) la pantalla relee ADEMAS el compuesto y TIRA el resultado: mismo archivo, firmas de vuelta
  × el archivo de los cierres del mensajero sale de su lectura DEDICADA… (R1/R8) 83ms
  × descargar los cierres del mensajero ya no dispara la relectura que FIRMA las evidencias (R9) 108ms
  Tests  2 failed | 30 passed (32)
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

=== MC4 (C.2/R2) la pantalla RECORTA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena el conjunto de cierres del mensajero que devolvió el servidor (R2) 100ms
  × la descarga sigue entregando el dataset completo, no la página (R52) 1177ms
  Tests  2 failed | 30 passed (32)
  AssertionError: el archivo trae la página, no el conjunto: expected […(24)] to have a length of 30 but got 25

=== MC5 (C.2/R2) la pantalla REORDENA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena el conjunto de cierres del mensajero que devolvió el servidor (R2) 130ms
  Tests  1 failed | 31 passed (32)
  AssertionError: expected [ '2026-07-19', '2026-07-12', …(1) ] to deeply equal [ '2026-07-12', '2026-07-19', …(1) ]

=== MC6 (C.2/R7) un fallo se degrada a la pagina visible en vez de no producir archivo
  × un fallo de la lectura de los cierres del mensajero no produce archivo y el mensaje no lleva datos personales (R7) 1119ms
  Tests  1 failed | 31 passed (32)
  AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times

=== MC7 (C.2/R4/R17) la descarga viaja con el recorte de pagina
  × el archivo de los cierres del mensajero sale de su lectura DEDICADA… (R1/R8) 118ms
  Tests  1 failed | 31 passed (32)
  AssertionError: expected [ { page: 1, pageSize: 25 } ] to deeply equal []

=== MC8 (C.2/R8) la pantalla ejecuta la lectura del conjunto AL MONTAR, sin que nadie pulse
  × el archivo de los cierres del mensajero sale de su lectura DEDICADA… (R1/R8) 38ms
  × la vista agrupada del mensajero entrega el grupo entero, y su contador lo dice 9ms
  Tests  2 failed | 30 passed (32)
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
=== fin  (los 8 lotes: «[restaurado] archivos mios sucios: []»)
```

### Qué mide cada una, y por qué hacen falta las dos mitades

**MC1 es la mutación que mide la tanda entera**: revierte la pantalla al estado del 2026-08-03 y
pone rojos **a la vez** los cuatro casos de conducta y el **censo** (la pantalla declara
`completo` pero llama al otro adaptador).

**MC2 es su espejo**: mover la línea del censo sin tocar la pantalla también es rojo. Sin esta
mitad, el censo podría decir que un listado está cerrado cuando no lo está.

**MC3 es LA mutación propia de esta tanda, y es la que el encargo pedía pensar.** El código
mutado llama a `listarCierreDia()` —el listado que firma— **y tira el resultado**: mismo archivo,
mismas filas, mismo orden, misma pantalla. Es indistinguible por el xlsx.

Lo que le toca al componente, sin duplicar lo del backend, es esto: el backend vigila con un
espía **que su servicio no firma** (`createSignedUrls` en `toHaveBeenCalledTimes(0)`, más su
anti-vacuidad con los tres paths exactos sobre `listarCierreDia`); lo que ningún test de servicio
puede ver es **si la pantalla sigue pidiendo el camino que sí firma**. Un servicio que no firma
no sirve de nada mientras el módulo llame al compuesto — y ése era exactamente el estado del que
salimos. La mitad de aquí es esa: `expect(listarCierreDia).not.toHaveBeenCalled()` **después** de
que la descarga se haya completado.

Y su **anti-vacuidad**, en dos pasos, porque «cero llamadas» pasa igual con un doble muerto o con
una descarga que nunca ocurrió:

1. la descarga SÍ ocurrió y produjo sus filas (`filas` con la longitud del conjunto);
2. el doble del compuesto **está vivo y trae evidencias FIRMADAS** — el test lo invoca al final y
   comprueba que devuelve `EVIDENCIA_FIRMADA`. No llamarlo es una decisión de la pantalla, no del
   arnés.

**MC4 y MC5 son las dos formas de romper R2, y el par justifica el endurecimiento del caso.**
En la primera pasada el doble devolvía tres filas y **MC4 (recortar) solo lo cazaba la guardia
vieja de R52**, que vive en otro archivo y habla de otro requisito; el caso nuevo pasaba verde.
Se cambió el doble a **treinta filas con la tabla pintando dos** (el `pageSize` del dominio es 25)
y ahora MC4 cae también aquí. **MC5 —reordenar por fecha— la guardia vieja NO la caza**: el
archivo sigue teniendo sus 60 filas. Solo el caso de R2 la mata. Ése es el defecto que Q-I2/Q-L3
ya dejaron escrito en este repo.

**MC8 (leer el conjunto al montar) cae en dos sitios**, y el segundo es informativo: rompe además
un caso de `paginacion-transversal` que renderiza esta pantalla y **no declara el export nuevo**
en su factoría. Es la confirmación de la forma del peaje descrita en §4.

**Ninguna mutación quedó verde**, así que no hubo código inalcanzable que retirar (la tanda A sí
tuvo una, `SIN_FILAS`).

---

## 4. El peaje de los `vi.mock` ajenos: **UN archivo**, y por qué solo uno

El backend dejó cinco candidatos. La corrección que trajo la tanda B —el fallo **no** es un error
de importación, es `expected "vi.fn()" to be called 1 times, but got 0 times` en el caso de
descarga, porque vite resuelve el named import en el punto de uso— implica que
`vitest related` no basta: hay que mirar **quién pulsa el control de descarga**. Medido así:

| Archivo | ¿Pulsa «Descargar Cierres solicitados»? | ¿Rompió? |
| --- | --- | --- |
| `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` | **sí**, desde la página 2 (su caso de R52) | **sí** → peaje pagado |
| `tests/components/descarga/CierresDescarga.test.tsx` | sí | es el archivo que esta tanda escribe |
| `tests/components/paginacion/paginacion-transversal.test.tsx` | **no** (renderiza el módulo para el caso del Anexo IV; su `MUESTRA` de conducta son otros tres listados) | **no** |
| `tests/components/CierreDiaModule.test.tsx` | no (ni una aparición de `Descargar`) | no |
| `tests/components/CierreDiaModuleIncidente.test.tsx` | no | no |
| `tests/components/CierreDiaPage.test.tsx` | no | no |

Los otros cuatro archivos que referencian `@/lib/actions/cierre-dia`
(`MisAsignacionesPage`, `RecoleccionPage`, `cierre-dia-action` de integración,
`notificacion-notificadores-reales`) no montan esta pantalla. Verificado corriendo los nueve:
**117 casos verdes**.

En `BajoRiesgoPaginacion` el arreglo es el de siempre: declarar el export nuevo en la factoría con
**su propio doble** (`completo.cierresPasadosCompleto`) y programarlo en el montaje. El doble del
listado compuesto **se conserva**: que el archivo ya no salga de él tiene que ser una decisión de
la pantalla, no una consecuencia de que el doble no responda.

**Nota para las tandas D–G:** `paginacion-transversal.test.tsx` es hoy el «tercer candidato que no
rompe» de esta tanda — renderiza `CierreDiaModule` pero no pulsa nada. **MC8 demuestra que está a
un caso de distancia de romperse**: en cuanto alguien le añada una descarga de esta pantalla,
habrá que declarar el export allí también.

---

## 5. El flake de jsdom

Los cuatro casos nuevos dependen del reloj de `waitFor` (**1.000 ms**, no el `testTimeout` de
20 s), así que se aplicaron los tres mecanismos:

- **Anclas positivas.** Los tres casos de éxito anclan a la **entrega del blob**
  (`waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1))`) y el de fallo —que por
  definición no produce archivo— al **toast**, una presencia. Ninguna espera es «que no haya X»:
  eso lo cumple también el estado transitorio de antes de empezar, y un ancla que el transitorio
  cumple no es un ancla. Las afirmaciones negativas (`not.toHaveBeenCalled`) van **después** del
  ancla, nunca dentro de ella.
- **Nada anclado a trabajo pesado real.** `exceljs` (`buildXlsxRows`) y `descargarBlob` siguen
  aislados en este archivo; el ancla es la entrega del blob, no la generación de la hoja. Las 30
  filas del caso de R2 tampoco cuestan nada real: no se renderizan (la tabla pinta la página del
  doble paginado) y el generador está mockeado.
- **Medido dos veces seguidas** (§6) y con los nueve archivos del dominio a la vez.

---

## 6. Puertas (medición real)

```
$ pnpm exec vitest run tests/components/descarga/CierresDescarga.test.tsx \
    tests/components/paginacion/{paginacion-transversal,BajoRiesgoPaginacion}.test.tsx
 Test Files  3 passed (3) · Tests  32 passed (32)      # dos pasadas, las dos verdes

$ pnpm exec vitest run <mis 3 + los 6 vecinos del dominio>
 Test Files  9 passed (9)
      Tests  117 passed (117)

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  6.69s

$ pnpm exec eslint <mis 4 archivos>
(sin salida: 0 errores, 0 warnings)

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)     # AJENAS y preexistentes; delta propio: CERO
```

**Rojos propios: cero.** La suite completa NO se corre aquí: el gate (`./init.sh`) lo corre el
LEADER.

### 6.1 Un rojo AJENO de typecheck, en curso mientras se escribía esto

```
$ pnpm run typecheck
tests/unit/repositories/historicos-paginados-where.test.ts(597,26): error TS2339:
  Property 'orderBy' does not exist on type '{ where: Record<string, unknown>; }'.
=== typecheck exit: 2 ===   (1 error, y solo ese)
```

**No es mío y está verificado, no supuesto:** la línea está dentro del bloque
`describe("el conjunto del HISTÓRICO de cierres del admin (feature 184, tanda D)")` que aparece en
el `git diff` **sin commitear** del otro agente, en un archivo que esta tanda no toca. El
typecheck con **todos** mis cambios de producción y censo dentro salió **exit 0** antes de que ese
diff apareciera, y desde entonces lo único mío que cambió es un `.test.tsx` que `tsc` compila en
el mismo programa y del que no reporta ni un error. **Se reporta, no se arregla.**

**Cerrado por su dueño mientras se escribía esto**: la medición final, ya con esa tanda
commiteada, es `typecheck errores: 0`.

---

## 7. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: los espacios de nombres de la 170 y
la 184 se cruzan en este archivo (`R52`, `R44`, `R43` son de la 170). Solo se listan los requisitos
que esta entrega toca; los del servidor están en `progress/impl_184_tandaC_backend.md §7`.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | `tests/components/descarga/CierresDescarga.test.tsx` + `paginacion-transversal.test.tsx` | «el archivo de los cierres del mensajero sale de su lectura DEDICADA, no del listado compuesto (R1/R8)» (la acción nueva con 1 llamada y `listarCierreDia` con **ninguna**) + la mitad estática «ninguno de los TRECE proyecta el array de la página» (el módulo declara `completo` y **debe** contener `filasDesdeResultado(`). Killer: **MC1** | ✔ **cierra aquí** para el listado 1 |
| R2 | `CierresDescarga.test.tsx` + el censo | «la pantalla NO recorta ni reordena el conjunto de cierres del mensajero que devolvió el servidor (R2)»: el doble devuelve **30** filas con la tabla pintando 2, y las tres primeras en un orden que ningún orden de cliente reproduce. La mitad estática es la negativa de T0.2: el módulo **no puede** contener `filasDelConjuntoCompleto(`. Killers: **MC4** (recorte) y **MC5** (reorden, que la guardia vieja de R52 NO caza) | ✔ |
| R3 | — | **no aplica a este listado, y es medible**: no tiene filtros (su schema de página solo llevaba `page`/`pageSize`). Lo afirmable es que **no viaja ninguna clave**, y eso sí se afirma: `expect(mock.calls[0]).toEqual([])`. Killer: **MC7** | ✔ como «no hay filtros que llevar» |
| R4 | `CierresDescarga.test.tsx` | el mismo `toEqual([])`: la entrada no lleva `mensajeroId` ni ninguna otra clave de alcance — y aquí eso no es higiene, es el único listado del Anexo A cuyo alcance es el propio usuario. El guard de rol y el `mensajero_id` del WHERE son del servicio (backend §7) | ✔ cliente |
| R6 | — | el tope lo evalúa el servidor y lo redacta `filasDesdeResultado`; sus casos viven en `cierre-dia-pasados-completo.test.ts` y `ControlDescargaTransversal.test.tsx`, verdes sin tocar | ✔ sin cambios |
| R7 | `CierresDescarga.test.tsx` | «un fallo de la lectura de los cierres del mensajero no produce archivo y el mensaje no lleva datos personales (R7)»: mensaje accionable, sin montos, sin identificadores y sin la URL firmada que esta pantalla es la única en tener a mano; no hay blob ni xlsx. Killer: **MC6** | ✔ **cierra aquí** |
| R8 | `CierresDescarga.test.tsx` | el caso de R1 afirma la acción del conjunto **sin llamar** hasta que se pulsa, y que la lectura de página sigue costando UNA (`listarCierresPasadosPaginado` con 1 llamada). Killer: **MC8** | ✔ **cierra aquí** |
| **R9** | `tests/unit/services/cierre-dia-pasados-completo.test.ts` (servidor) + `CierresDescarga.test.tsx` (cliente) | la mitad de cliente: **«descargar los cierres del mensajero ya no dispara la relectura que FIRMA las evidencias (R9)»** — cero llamadas al listado compuesto tras una descarga completada, con la anti-vacuidad en dos pasos de §3. Killers: **MC1**, **MC3** | ✔ **la mitad de cliente cierra aquí** |
| R12 | `CierresDescarga.test.tsx` + `ControlDescargaTransversal.test.tsx` | «cada tabla de cierres ofrece su control…», «el archivo trae las filas de SU tabla, en el orden de la pantalla» y «ninguna URL firmada ni ruta de almacenamiento llega al archivo», **sin cambios**: mismas columnas, mismo orden y mismos textos. `cierre-dia-descarga-columnas.ts` no se tocó | ✔ sin cambios |
| R13 | `paginacion-transversal.test.tsx` | el mismo caso del censo: los OCHO que siguen declarados `conjunto` **deben** contener `filasDelConjuntoCompleto(`. Y las cuatro secciones del Anexo IV de este mismo archivo siguen con `filasLocales` y su excepción declarada | ✔ |
| R29 | `paginacion-transversal.test.tsx` | los dos sentidos del censo, ya existentes (lo declarado existe; lo que existe está declarado), verdes tras mover el listado | ✔ |
| R30 | `paginacion-transversal.test.tsx` | `PENDIENTES_184` con **ocho** nombres, contrastado contra el árbol. Medido en los dos sentidos: **MC1** (pantalla sin censo) y **MC2** (censo sin pantalla) | ✔ |
| R33 | — | el objeto de opciones de `useSWR` de esta pantalla no se toca: ni `fallbackData` ni ninguna opción aparecen en el diff. Su caso vive en `paginacion-transversal.test.tsx` («los TRECE pre-cargan su página») y sigue verde | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Lo que NO se puede cubrir aquí, con su motivo:** R5, R14, R15, R16 y R17 son de repositorio o
borde (`lib/**`, fuera del alcance de FRONTEND_DEV) y están cerrados en
`impl_184_tandaC_backend.md`. **R10** es de la tanda B (los agregados de la consolidación) y
**R11** es del listado 10, cerrado en la tanda A. **R18–R28** son la poda de la selección
satélite, cerrada en la tanda A. **R31 y R32** son de la **tanda H**: la guardia nueva solo puede
correr cuando A–G estén dentro, y hoy quedan ocho listados.

---

## 8. Notas para quien siga

- **`listarCierreDia()` queda con un solo consumidor de producción** (`cierre-dia/page.tsx`).
  Igual que `listarRecepcionSatelite()` tras la A y `listarConsolidacion()` tras la B. No se
  actúa: es un cambio de contrato que ningún requisito de esta feature necesita. Van tres.
- **El peaje se busca por «quién pulsa el control», no por `vitest related`** (§4). En esta tanda
  eso redujo cinco candidatos a **uno**.
- **La mutación que hay que escribir en cada tanda es la del coste que se ahorra**, no la del
  archivo que se produce: MC3 aquí, M4/M11 en la B. El archivo sale idéntico en las dos.
- **Incidencia de proceso, con coste real y culpa propia.** El worktree se compartió con otro
  agente (la tanda D). Yo endurecí el caso de R2 y quise meterlo en mi commit con
  `git commit --amend`; entre mi `git add` y el `--amend`, **el otro agente commiteó**, así que
  amendé SU commit: `31c94bb2` pasó a `f20fac6a` con mi archivo dentro. Se recuperó con
  `git reset --soft 31c94bb2` —que **no toca el árbol de trabajo**, a diferencia de
  `checkout`/`restore`/`stash`— y el cambio propio se commiteó aparte (`561d3cde`); verificado con
  `git diff 31c94bb2 f20fac6a`, cuyo único contenido era mi archivo. **Regla que faltaba en la
  lista de higiene y que conviene añadir: en un worktree compartido, `git commit --amend` es tan
  destructivo como `git checkout -- .`, porque `HEAD` puede no ser tuyo.** Commits nuevos, nunca
  amend.
- El guion de mutaciones lleva el nombre de la tanda dentro (`tandaC_front_mutar.py`) y restaura
  **solo el archivo mutado por su ruta**; nunca `-- .`.
