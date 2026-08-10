# 184 — Cierre: el mapa `R1..R34`, verificado caso a caso (T H.3)

> ## ⚠️ ESTA FEATURE SE RENUMERÓ: era la **184**, ahora es la **188**
>
> **Qué pasó (2026-08-05):** mientras esta rama estaba viva, otra sesión mergeó en `dev` una ficha
> **184 distinta** («analítica financiera: export de la serie»), además de una 185, una 186 y una
> 187. Al traer `dev`, los cuatro ids colisionaron. Por decisión humana se renumeró **todo lo de
> esta rama**: `184→188`, y las tres fichas que salieron de su cierre `185/186/187 → 189/190/191`.
>
> **Lo que NO se renumeró, y hay que saberlo al leer el repo:**
>
> - **Los 60 mensajes de commit** siguen diciendo «184». No se reescribieron a propósito:
>   `rebase`/`amend` sobre una rama ya pusheada está prohibido aquí desde que reescribió el commit
>   de otro agente.
> - **El código**: 111 archivos citan `Feature 184 — …` en comentarios, y la constante
>   **`PENDIENTES_184`** está usada **como ancla de texto** dentro de
>   `tests/unit/descarga/adaptador-conjunto.guardia.test.ts:313`. Renombrarla a medias pone la
>   guardia roja; renombrarla entera es una refactorización de 111 archivos sin ganancia funcional.
>   **Los nombres del código se quedan como están y significan esta feature.**
> - **La rama**: se llamó `feature/184-deuda-170-listados` hasta el 05-ago, y así quedó escrita en la
>   cabecera de las 17 bitácoras `impl_188_*`. Hoy es `feature/188-deuda-170-listados` (PR #298, ya
>   mergeado). No busques la vieja: no existe.
>
> Es decir: **«184» en un commit, un comentario, una cabecera de bitácora o `PENDIENTES_184` = esta
> feature, la 188.**



> Entregable de la tarea **H.3** de `specs/188-deuda-170-listados-completos/tasks.md`.
> **Qué es:** cada requisito con el archivo y el **nombre literal** del caso que lo mide, y un
> veredicto sobre si ese caso **se pondría rojo** ante la violación del requisito.
> **Qué NO es:** un recuento de `R<n>` en títulos de test. Ese recuento ya produjo aquí un falso
> «68/68» por cruce de espacios de nombres entre features, y `tasks.md` lo prohíbe explícitamente.

## 0. Cómo se produjo este mapa, y por qué no se copió del spec

La tanda H dejó H.3 sin hacer **y lo dijo**: `impl_188_tandaH.md §7.2` se titula «índice, **no**
verificación» y su fila R34 dice «pendiente de consolidar en H.3». Lo que esa tanda sí hizo fue
comprobar por script que **16 títulos citados existen literalmente** en el árbol — lo que descarta
la forma más barata de que el mapa mienta (nombres de caso muertos), pero **no** que cada caso
afirme lo que dice afirmar.

Este mapa se produjo leyendo **el cuerpo entero** de cada caso, en tres tramos disjuntos
(R1–R13, R14–R28, R29–R34), y contrastando cada dato contra el árbol con mediciones
independientes. Cada tramo ejecutó los archivos de su competencia; **la suite completa la corre
el gate**, no este documento.

**Tres filas del Anexo B de `requirements.md` apuntan a casos que NO existen donde dicen.** La
cobertura existe —en otro archivo—, así que ningún requisito queda descubierto por esto, pero es
la razón por la que este mapa **no puede copiarse del spec**:

| Fila del Anexo B | Lo que promete | Dónde está de verdad |
| --- | --- | --- |
| **R8** (`requirements.md:224`) | «montar la pantalla no llama a la acción del conjunto» en `paginacion-transversal.test.tsx` | Ahí **no está**. Son los 12 casos `(a) montar la pantalla NO ejecuta la lectura del conjunto` de los cuatro `*Descarga.test.tsx` |
| **R2** (`:218`) | una mitad estática, «ausencia de filtro/orden de cliente en el módulo» | Lo único estático es `not.toMatch(/filasLocales\(/)` (`paginacion-transversal.test.tsx:1034`), que prohíbe **proyectar la página**, no filtrar ni ordenar. La cobertura real son los 12 casos de conducta |
| **R12** (`:228`) | los casos del tope, del error y del vacío en `ControlDescargaTransversal.test.tsx` | Ese archivo **no los tiene**; viven en `DescargarDataset.test.tsx:182,202` y `descarga-resultado.test.ts:166` |

Y una precisión sobre la misma fila R12: su "sin cambios" **no es literal**. `T H.2` editó
`ControlDescargaTransversal.test.tsx:608` para quitar `filasDelConjuntoCompleto` de la
alternancia. La edición **endurece** la aserción y no toca ningún texto de usuario, así que R12 no
queda roto por ella — pero el mapa no debe afirmar que nada se tocó.

---

## 1. El mapa

Veredictos: **CUBIERTO** = el caso se pondría rojo ante la violación · **DÉBIL** = existe pero no
fallaría, o cubre menos que el requisito · **NO CUBIERTO** = no existe o mide otra cosa.

### A. El contrato de la descarga (R1–R13)

| R | Archivo : línea | Nombre literal del caso | Veredicto |
| --- | --- | --- | --- |
| **R1** | `tests/components/paginacion/paginacion-transversal.test.tsx:1004` | «ninguno de los TRECE proyecta el array de la página: el archivo va al servidor» | CUBIERTO |
| R1 | `tests/components/descarga/SateliteDescarga.test.tsx:314` | «el archivo sale de la lectura DEDICADA al listado, no del listado compuesto ni de otra página (R1)» | CUBIERTO |
| R1 | `CierresDescarga.test.tsx:691,804,901,1050,1149,1256,1390` · `IncidentesDescarga.test.tsx:297,424` · `WalletPropsDescarga.test.tsx:497,636` | «…sale de su lectura DEDICADA, no del listado compuesto (R1/R8)» — **uno por listado, 12/12** | CUBIERTO |
| **R2** | `tests/components/descarga/SateliteDescarga.test.tsx:378` | «la pantalla NO vuelve a filtrar ni a ordenar lo que devolvió el servidor (R2)» | CUBIERTO |
| R2 | `CierresDescarga.test.tsx:752,851,960,1082,1196,1324,1443` · `IncidentesDescarga.test.tsx:357,461` · `WalletPropsDescarga.test.tsx:536,659` | «la pantalla NO recorta ni reordena … que devolvió el servidor (R2)» — **12/12** | CUBIERTO |
| **R3** | `tests/components/descarga/SateliteDescarga.test.tsx:344` | «descargar con filtros aplicados pide el conjunto con ESOS filtros (R3)» | CUBIERTO |
| R3 | los 11 casos R1/R8 citados arriba | `mock.calls[0]).toEqual([])` — para los 11 sin filtros, «los filtros vigentes» es el conjunto vacío y se afirma que no viaja ninguna clave | CUBIERTO |
| **R4** | `tests/unit/services/recepcion-satelite-completo.test.ts:110` y `:123` | «un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)» · «el alcance sale del ACTOR, no de la entrada (R4)» | CUBIERTO |
| R4 | `consolidacion-completo.test.ts:321,343` · `cierre-dia-pasados-completo.test.ts:271,286` · `cierres-admin-completo.test.ts:247,268` · `cierres-bodega-admin-completo.test.ts:231,252` · `incidentes-completo.test.ts:224,245` · `gasto-fijo-plantillas-completo.test.ts:122,144` · `saldos-tiendas-completo.test.ts:110,138` | los mismos dos casos por dominio — **8 archivos, 12 listados** | CUBIERTO |
| **R5** | `tests/unit/repositories/satelite-paginado-where.test.ts:366` | «el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)» | CUBIERTO |
| R5 | `historicos-paginados-where.test.ts:319,398,478,622,737,865` · `colas-paginadas-where.test.ts:338,379,472,537` | ídem — **11 de 12 sobre los argumentos reales de Prisma** | CUBIERTO |
| R5 | `tests/unit/services/saldos-tiendas-completo.test.ts:143` | «el conjunto del archivo sale ORDENADO como la pagina, no en el orden del planificador (R5)» | CUBIERTO |
| **R6** | `recepcion-satelite-completo.test.ts:195` · `consolidacion-completo.test.ts:443` · `cierre-dia-pasados-completo.test.ts:353` · `cierres-admin-completo.test.ts:450` · `cierres-bodega-admin-completo.test.ts:414` · `incidentes-completo.test.ts:491` · `gasto-fijo-plantillas-completo.test.ts:186` · `saldos-tiendas-completo.test.ts:194` | «con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)» | CUBIERTO |
| R6 | `saldos-tiendas-completo.test.ts:233` · `WalletPropsDescarga.test.tsx:455,607` | «pide como mucho el tope + 1 filas…» · «por encima del tope rechaza…» · «el tope de las plantillas también lo decide el servidor (R6)» | CUBIERTO |
| **R7** | `SateliteDescarga.test.tsx:409` · `CierresDescarga.test.tsx:776,877,997,1121,1230,1362,1477` · `IncidentesDescarga.test.tsx:397,497` · `WalletPropsDescarga.test.tsx:583,699` | «un fallo de la lectura … no produce archivo y el mensaje no lleva datos personales (R7)» — **12/12** | CUBIERTO |
| **R8** | `SateliteDescarga.test.tsx:331-334` y sus 11 gemelos | «(a) montar la pantalla NO ejecuta la lectura del conjunto» | CUBIERTO |
| R8 | `paginacion-transversal.test.tsx:879` y `:938` | «los TRECE pre-cargan su página: `useSWR` con `fallbackData`, en todos» · «…cada página cuesta UNA lectura» | CUBIERTO |
| **R9** | `tests/unit/services/cierre-dia-pasados-completo.test.ts:227` | «el conjunto de la descarga no firma ninguna URL de evidencia (R9)» | CUBIERTO |
| R9 | `tests/components/descarga/CierresDescarga.test.tsx:928` | «descargar los cierres del mensajero ya no dispara la relectura que FIRMA las evidencias (R9)» | CUBIERTO |
| **R10** | `tests/unit/services/consolidacion-completo.test.ts:265` | «el conjunto de la descarga no calcula agregados ni reparto de efectivo (R10)» | CUBIERTO |
| R10 | `CierresDescarga.test.tsx:721` y `:829` | «…no cuesta los agregados de dinero de la cabecera (R10)» · «…no cambia el contador ni los agregados (R10/R26)» | CUBIERTO |
| **R11** | `tests/unit/repositories/satelite-paginado-where.test.ts:433` | «el acotamiento del actor va en el where del conjunto, y los filtros solo lo estrechan (R4/R11)» | CUBIERTO |
| R11 | `tests/unit/services/recepcion-satelite-completo.test.ts:148` | «con un filtro de cantón el conjunto excluye las demás filas EN LA BASE (R11)» | CUBIERTO |
| **R12** (textos) | `tests/unit/components/descarga-resultado.test.ts:166` · `tests/components/DescargarDataset.test.tsx:182,202` | «el mensaje del tope y el sufijo de reintento son únicos y viven en el módulo común» · «muestra el mensaje accionable…» · «no descarga archivo y avisa cuando el dataset viene vacío» | CUBIERTO |
| **R12** (columnas y orden) | — | **no existe ningún caso** | **DÉBIL** — ver §2.1 |
| **R13** | `paginacion-transversal.test.tsx:1004` (bloque `:1023-1057`) | «ninguno de los TRECE proyecta el array de la página…» | CUBIERTO — **vacuo por diseño al cierre**, ver §3 |

### B. Dónde se prueba cada cosa (R14–R17)

Los métodos de repositorio **nuevos** de esta rama son **8 públicos + 1 privado**:
`CierresAdminRepository.{findHistoricoCompleto, findColaCompleta}`,
`CierresBodegaAdminRepository.{findHistoricoCompleto, findColaCompleta}`,
`IncidenteAdminRepository.{findHistoricoCompleto, findColaCompleta}`,
`OrdenRepository.{findRecepcionSateliteCompleta, findIdsVigentesEnBodega}` y el privado
`OrdenRepository.hidratarSatelite`. Los repositorios de `CierreBodega`, `CierreDia`,
`GastoFijoPlantilla` y `WalletTiendaMovimiento` **no** ganaron métodos (reusan los existentes),
así que R14 no les aplica.

| R | Archivo : línea | Nombre literal del caso | Veredicto |
| --- | --- | --- | --- |
| **R14** ×6 (admin) | `historicos-paginados-where.test.ts:478,622,737` · `colas-paginadas-where.test.ts:379,472,537` | «… el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)» | CUBIERTO — repo **real** con delegado Prisma falso, `where`/`orderBy` afirmados en valores absolutos |
| R14 · `findRecepcionSateliteCompleta` | `satelite-paginado-where.test.ts:433` | «el acotamiento del actor va en el where del conjunto, y los filtros solo lo estrechan (R4/R11)» | CUBIERTO — inspecciona el `Prisma.Sql` emitido |
| R14 · `findIdsVigentesEnBodega` | `satelite-paginado-where.test.ts:487` | «el where lleva la ZONA del actor además del IN de ids (R21)» | CUBIERTO |
| **R15** | `historicos-paginados-where.test.ts:527,646,782` | «los dos conjuntos … cuestan UNA consulta, sin recorte y sin conteo de página (R15)» (×3) | CUBIERTO — conteo exacto; `count` **no** llamado; `skip`/`take` `undefined` |
| R15 · satélite | `satelite-paginado-where.test.ts:393,411,511` | «el conjunto NO lleva LIMIT ni OFFSET, y tampoco el conteo de ventana (R15)» · «emite exactamente DOS consultas…» · «es UNA sola consulta de UNA sola columna, sin orden ni recorte (R15)» | CUBIERTO |
| **R16** (emisiones) | `historicos:478,622,737` · `colas:379,412,472,495,537,563` · `satelite:366` | «… las MISMAS condiciones y el MISMO orden (R16/R5)» — compara `argsPagina.where).toEqual(argsEntero.where)`, **no cada lado con su copia** | CUBIERTO |
| **R16** (declaración única) | `tests/unit/repositories/criterio-unico.guardia.test.ts` (nuevo, `c8c9ad85`) | «*&lt;par&gt;*: el conjunto y su hermano paginado leen la MISMA declaracion, y es unica» — **11 casos parametrizados, uno por par** — más «`alcanceWhere` de incidentes —la guardia de zona— sigue declarada UNA sola vez (tanda F)» | **CUBIERTO** — ver §2.2 |
| **R17** ×12 | `recepcion-satelite-action.test.ts:309,408` · `cierre-bodega-descarga-action.test.ts:80` · `cierre-bodega-admin-descarga-action.test.ts:66` · `cierre-dia-descarga-action.test.ts:44` · `cierres-admin-descarga-action.test.ts:69` · `incidentes-descarga-action.test.ts:75` · `wallet-listados-descarga-action.test.ts:83` | «una clave no declarada muere con validation_error sin tocar el service (R17)» | CUBIERTO — espía del service en cero; el schema es `.omit({page,pageSize}).strict()` real |

### C. Poda de la selección en la bodega satélite (R18–R28)

| R | Archivo : línea | Nombre literal del caso | Veredicto |
| --- | --- | --- | --- |
| **R18** | `SateliteSeleccionOtrasPaginas.test.tsx:391` | «una orden marcada que SALE del listado deja de estar marcada tras la relectura (R18/R25)» | CUBIERTO — conjunto servidor **mutable**: sin poda el aviso seguiría diciendo 2 |
| R18 | `recepcion-satelite-vigencia.test.ts:68` | «una orden que salió del listado vuelve como NO vigente (R18)» | CUBIERTO |
| **R19** | `recepcion-satelite-vigencia.test.ts:41` | «la vigencia se decide sobre el CONJUNTO filtrado, no sobre la página visible (R19)» | CUBIERTO — `a-10` vive en la página 4 y vuelve vigente |
| R19 | `SatelitePaginacion.test.tsx:686` | «la comprobación de vigencia viaja con los filtros vigentes (R19)» | CUBIERTO |
| **R20** | `SateliteSeleccionOtrasPaginas.test.tsx:450` | «cambiar de página no desmarca nada, y cuesta exactamente UNA comprobación (R20/R24)» | CUBIERTO |
| **R21** | `recepcion-satelite-vigencia.test.ts:82` | «un id de OTRA zona vuelve como no vigente y no revela ningún dato de él (R21)» | CUBIERTO — `JSON.stringify` sin el id ajeno **y contraprueba** con `SAT_B` |
| R21 (SQL) | `satelite-paginado-where.test.ts:487` | «el where lleva la ZONA del actor además del IN de ids (R21)» | CUBIERTO |
| **R22** | `SateliteSeleccionOtrasPaginas.test.tsx:501` | «si la comprobación falla, la selección queda INTACTA (R22)» | CUBIERTO |
| **R23** | `SateliteSeleccionOtrasPaginas.test.tsx:478` | «sin marcas fuera de la página visible no se consulta la vigencia (R23/R28)» | CUBIERTO — negativo real, 4 escenarios |
| R23 | `recepcion-satelite-vigencia.test.ts:153` · `satelite-paginado-where.test.ts:564` | «sin ids no se consulta NADA (R23, también en el servidor)» · «sin ids no consulta (R23) y sin estados tampoco» | CUBIERTO |
| **R24** | `SateliteSeleccionOtrasPaginas.test.tsx:391` (línea 420) y `:450` | conteo exacto `toBe(llamadasAntes + 1)` en el caso que **sí** poda, y `toHaveBeenCalledTimes(1)` cuando no retira nada | CUBIERTO |
| **R25** | `SateliteSeleccionOtrasPaginas.test.tsx:391` y `:431` | «…(R18/R25)» · «el aviso desaparece cuando ya no queda ninguna marcada fuera (R25)» | CUBIERTO — 2→1, y `avisoTexto()` a `null`, no «0 órdenes» |
| **R26** (página, filtros, contadores) | `SatelitePaginacion.test.tsx:641` | «podar no cambia la página visible, ni los filtros, ni los contadores (R26)» | CUBIERTO |
| **R26** (acción de lote) | `SatelitePaginacion.test.tsx` (nuevo, `34be0184`) | «podar no retira la acción de lote de lo marcado en la página visible (R26)» | **CUBIERTO** — ver §2.3 |
| **R27** | `SateliteSeleccionOtrasPaginas.test.tsx:529` | «cambiar los filtros sigue limpiando la selección ENTERA (R27)» | CUBIERTO |
| **R28** | `SatelitePaginacion.test.tsx:711` | «ni la carga inicial ni la descarga consultan la vigencia (R28)» | CUBIERTO |
| R28 (coste servidor) | `recepcion-satelite-vigencia.test.ts:171` | «comprobar la vigencia no lee el listado ni cuenta intentos: UNA consulta acotada (R28)» | CUBIERTO — lista **cerrada** (`toEqual`), no `toContain` |

### D. Censos, guardias y trazabilidad (R29–R34)

| R | Archivo : línea | Nombre literal del caso | Veredicto |
| --- | --- | --- | --- |
| **R29** | `paginacion-transversal.test.tsx:908` | «el censo y el árbol no se despegan: 13 controles declarados, 13 listados» | CUBIERTO |
| **R30** | `paginacion-transversal.test.tsx:1004` (aserciones `:1051-1057`) | «ninguno de los TRECE proyecta el array de la página: el archivo va al servidor» | CUBIERTO |
| **R31** | `tests/unit/descarga/adaptador-conjunto.guardia.test.ts:355` | «los dos censos de adaptador no tienen casos deshabilitados ni pendientes» | CUBIERTO |
| **R32** | `tests/unit/descarga/adaptador-conjunto.guardia.test.ts:149` | «no queda ninguna llamada al adaptador de relectura bajo app/» | CUBIERTO |
| **R33** | `paginacion-transversal.test.tsx:879` y `:938` | «los TRECE pre-cargan su página: `useSWR` con `fallbackData`, en todos» | CUBIERTO — **y no violado, medido contra el diff** (§4) |
| **R34** | este archivo | el mapa completo, verificado caso a caso | CUBIERTO por este documento |

---

## 2. Lo que H.3 encontró abierto, y qué se hizo con cada cosa

### 2.1 R12 — «las columnas y el orden de columnas de cada archivo»: DÉBIL, **a ficha propia**

**El hueco es real.** Ningún test se pone rojo si alguien reordena o quita una columna de los
archivos de los 12 listados. Lo que hay es `toContain` de un encabezado suelto
(`SateliteDescarga.test.tsx:267`, `CierresDescarga.test.tsx:629`) y aserciones sobre
`filas[i].campo`, que son **insensibles al orden** de `columnas`. Los
`tests/unit/descarga/*-descarga-columnas.test.ts` que sí fijan `map(c => c.clave)).toEqual([...])`
existen para api-keys, usuarios, pagos-registrados, desglose-tienda y wallet-caja/mensajero/tienda
— **ninguno de los 12**. (Ojo al homónimo: `plantillas-descarga-columnas.test.ts` cubre
`COLUMNAS_DESCARGA_PLANTILLAS`, las plantillas de **mensaje** de `configuracion/plantillas`, **no**
«Plantillas de gasto fijo» del Anexo A.)

**Por qué no entra en esta feature, decidido por el humano el 2026-08-05:** esta rama **no puede
haberlo roto**. Medido sobre el diff: `git diff origin/dev...HEAD` no toca **ni una** de las 34
constantes `COLUMNAS_DESCARGA_*` —la única coincidencia en todo el diff es un comentario en
prosa—, y ninguno de los archivos `*-descarga-columnas.ts` aparece entre los modificados. La
feature cambió de dónde salen las **filas**, no las **columnas**, y las filas sí están medidas
(R2, 12/12).

> **Esta es la distinción que hay que respetar:** el requisito se cumple —verificado por
> medición del diff, que para «conservar sin cambios» es evidencia más fuerte que un test—, pero
> **no queda atornillado hacia el futuro**. Es deuda preexistente que esta feature hereda y
> documenta, no una cobertura que se declare existente sin serlo.

**Ficha propia, con el trabajo ya acotado:** un caso por constante (o uno tabla-dirigido) en
`tests/unit/descarga/`, del tipo `expect(COLUMNAS_DESCARGA_X.map(c => c.clave)).toEqual([...])` y
lo mismo con `encabezado`. El molde exacto ya existe:
`tests/unit/descarga/api-keys-descarga-columnas.test.ts:24-31`. Las 12 constantes son
`..._CIERRES_HISTORICO`, `..._CIERRES_PENDIENTES`, `..._BODEGA_SOLICITADOS`, `..._BODEGA_RESUELTOS`,
`..._BODEGA_PENDIENTES`, `..._CONSOLIDABLES`, `..._DIA_CIERRES_PASADOS`,
`..._INCIDENTES_PENDIENTES`, `..._INCIDENTES_HISTORICO`, `..._SATELITE`, `..._GASTOS_FIJOS` y
`..._SALDOS_TIENDAS`.

### 2.2 R16 — «no dos declaraciones separadas del mismo criterio»: **cerrado en H.3**

Era el más caro de los tres, porque es **la propiedad que da nombre al hallazgo de esta feature**:
el criterio duplicado apareció en las SIETE tandas, con el `orderBy` escrito dos o tres veces en
cada par, y en la tanda F apareció la versión cara —`alcanceWhere`, la guardia que decide si un
`adminSatelite` ve el dinero de otra zona, **declarada TRES veces**—.

**El hueco medido:** los diez casos de igualdad de emisiones prueban la *consecuencia* de
compartir la declaración, no el hecho de compartirla. Si alguien deshiciera `ORDEN_CONSOLIDABLES`
(`CierreBodegaRepository.ts:120`), `ORDEN_CIERRES_BODEGA` (`:135`), `ORDEN_CIERRES_MENSAJERO`
(`CierreDiaRepository.ts:245`) u `ORDEN_PLANTILLAS` (`GastoFijoPlantillaRepository.ts:55`) y
reescribiera el literal **idéntico** en cada método, **los diez siguen verdes**. Sin guardia, la
propiedad que la feature declara haber arreglado no impide su propio regreso.

**Lo que se escribió:** `tests/unit/repositories/criterio-unico.guardia.test.ts` (commit `c8c9ad85`),
**22 casos** — 11 parametrizados, uno por par conjunto/paginado, más los dos de `alcanceWhere`, los
tres del detector, el control positivo y los cuatro de mutación. La selecciona `vitest run guard`
por patrón, sin lista.

**El contraste que justifica su existencia**, y es el dato que hay que retener:

| Mutación real en disco | La guardia | Los tests de emisión |
| --- | --- | --- |
| **A** — deshacer `ORDEN_CIERRES_MENSAJERO` y repetir el literal idéntico en los dos métodos | **ROJA** (3 failed / 19) | **129 en VERDE** |
| **B** — deshacer `ORDEN_PLANTILLAS` (las tres copias) | **ROJA**, 8 violaciones nombradas | — |
| **C** — `alcanceWhere` de incidentes reescrita a mano en el `count` de zona | **ROJA** (`expected 2 to be 1`) | — |
| **D** — una segunda constante del mismo valor, sólo para la página | **ROJA** | **75 en VERDE** |

Las cuatro sobre repositorios reales, restauradas con **SHA-256 verificado** y
`git status --porcelain lib/repositories/` vacío tras cada una.

**Por qué la forma de aserción no es la obvia, y conviene saberlo antes de tocarla:** contar
literales de orden por archivo (opción (a) del encargo) era **inutilizable**. En
`CierreBodegaRepository.ts` conviven `ORDEN_CONSOLIDABLES` y `ORDEN_CIERRES_BODEGA`, **ambas
`{ solicitadoAt: "desc" }`**: son dos listados sobre dos tablas distintas, o sea dos criterios que
**coinciden de valor sin ser una repetición** → falso rojo. Y al ser por archivo, tampoco vería la
copia que viviera en otro. La guardia usa como espina dorsal la opción (b) —que el par referencie
la misma constante por nombre— con el conteo de literales acotado al par. Justificación completa
en `progress/impl_188_H3_R16.md`.

### 2.3 R26 — «ni la acción de lote que se ofrece sobre lo seleccionado»: **cerrado en H.3**

`SatelitePaginacion.test.tsx:641` cubría página, filtros y contadores, pero en ese escenario la
página 2 no tiene nada marcado, así que **no había botón de lote que observar**. La evidencia era
indirecta: que la marca visible sobrevive a la poda (`SateliteSeleccionOtrasPaginas.test.tsx:426-428`)
y que el botón es función de esa selección (`SatelitePaginacion.test.tsx:489,538`).

**Lo que se escribió** (commit `34be0184`): el caso «podar no retira la acción de lote de lo
marcado en la página visible (R26)», hermano del de `:641`. Con dos marcas fuera de la vista y una
en la página visible, deja la comprobación de vigencia **en vuelo** y mide el botón antes y
después de la poda: ofrecido y habilitado en los dos momentos, la barra sigue diciendo «1
seleccionada(s) en esta página», y al pulsarlo `enviarACentral` recibe exactamente
`[{ ordenId: "o-41" }]`. El **ancla positiva** es que el aviso baja de 2 a 1.

**La mutación demuestra que el hueco era real, no teórico:** al hacer que la poda se pase de larga
y borre también la marca de la página visible (`SateliteOrdenesListado.tsx:290`), **el caso nuevo
falla y el de `:641` sigue verde**. Dos mutaciones más —poda en no-op y poda desactivada— tumban
el ancla, confirmando que la aserción del botón no puede pasar sin que la poda haya ocurrido.
Producción restaurada y verificada por hash.

---

## 3. R13 es **vacuo por diseño** al cierre, y conviene que quede escrito

`PENDIENTES_184` (`paginacion-transversal.test.tsx:370-398`) está **vacía**, y eso **coincide con
el árbol**: verificado de forma independiente, 0 llamadas al adaptador de relectura en los 288
archivos de `app/`, y 13/13 listados declaran `completo`. O sea: hoy R13 se cumple **vacuamente**,
porque ya no queda ningún listado sin migrar — que es exactamente el objetivo de la feature.

No se marca DÉBIL porque la maquinaria sigue viva y **sí puede fallar** ante una regresión: el
bucle `:1025-1031` exige, contra el archivo real, que un listado declarado `conjunto` use el
adaptador de relectura y que uno declarado `completo` no lo use. Lo que ya no puede darse es el
**antecedente** del requisito.

---

## 4. Dos comprobaciones que se hicieron contra el árbol, no contra las bitácoras

**R33 no está violado, y se midió sobre el diff, no sobre el test.** `git diff origin/dev...HEAD`
no contiene **ni una** línea `+`/`-` de código con `useSWR(`, `revalidateOn*`, `fallbackData`,
`refreshInterval`, `dedupingInterval` ni `keepPreviousData`; las únicas coincidencias del diff
entero son prosa en `progress/*.md` y un comentario de test. Fuera de `app/` y `components/`,
`useSWR` sólo vive en `hooks/useNotificaciones.ts`, que la rama no toca.

**La guardia de R31/R32 tiene el detector SANO** — y esto importa porque el susto de la tanda H
fue precisamente **una guardia que pasaba verde con su detector roto**: encontraba cero llamadas
porque no encontraba nada, y habría sido un adorno permanente. Reverificado de forma independiente:

| Comprobación | Medida |
| --- | --- |
| Archivos que el detector recorre bajo `app/` | **288** (184 `.tsx` + 104 `.ts`) — coincide exactamente con un `find` independiente |
| Con `components/` | **369** — ídem |
| Umbral del test (`toBeGreaterThan(100)`) | a **2.9×** del valor real: plausible y con margen, no cosmético |
| Control positivo (`:190`) | el mismo escaneo ve **22** archivos que llaman al adaptador vivo. **El detector no está mudo** |
| Anti-vacuidad | **tres capas**: regex contra texto sintético (`:98`), recorrido del árbol (`:133`), control positivo (`:190`), más lo mismo para la regex de `.skip` (`:325`) |
| «Cero llamadas», con grep independiente | `filasDelConjuntoCompleto` → **0** en `app/`. Única aparición en `components/`: `descarga-resultado.ts:99`, dentro de un comentario y sin `(` detrás |
| Los dos censos del caso de `.skip` | `paginacion-transversal.test.tsx` y `WalletPropsDescarga.test.tsx` — los que `tasks.md` T0.1/T0.2 nombran. **0** marcas `.skip/.todo/.only`; 9 y 12 `it(` contra pisos 9 y 12 |

---

## 5. Dos menores que se declaran y NO se arreglan aquí

Ninguno bloquea; los dos quedan escritos para que no se pierdan.

**R29 — el ancla del censo es la constante, no `<Pagination`.** La dirección «lo que existe está
declarado» se comprueba sobre `export const PAGINACION_*_LABEL`: hay **13** archivos con la
constante frente a **26** que renderizan `<Pagination`. Los otros 13 los cubre un censo distinto y
más ancho (`tests/unit/descarga/censo-tablas.ts`, 33 rutas, vía `cobertura-tablas.guardia.test.ts`),
así que el agujero real es **estrecho**: un listado nuevo de clase Anexo III que paginara sin
exportar su constante **y** sin registrarse en `censo-tablas.ts` sería invisible para este caso. Si
se cierra algún día, el caso es «todo archivo de `app/` que monte `<Pagination` está en uno de los
dos censos», con la lista de excepciones declarada.

**R31 — el conteo `casos` es global al archivo.** `:377` cuenta `\bit\s*\(` en todo el archivo, no
los casos del censo; un cambio que borrase el caso censal y añadiera otro `it(` cualquiera
mantendría el piso. Mitigado por las anclas y por la mitad negativa de `:385`, y el escenario es
rebuscado. Endurecerlo sería afirmar la presencia de los **nombres** de los casos censales, no su
número.

---

## 5.1 El defecto de orden de «Saldos de tiendas»: qué quedó arreglado y qué no

El cierre de la jornada anterior lo dejó escrito como «defecto de producción destapado, NO
arreglado». Verificado hoy contra el código, el estado exacto es **más preciso que eso**, y
conviene que el PR no lo cuente ni de más ni de menos:

| | Estado |
| --- | --- |
| **El archivo** de «Saldos de tiendas» (listado 12) | ✅ **arreglado.** Sale del mismo método del que sale la página (`listarSaldosTiendasPaginado`), donde vive la única declaración del orden. Medido por `tests/unit/services/saldos-tiendas-completo.test.ts:143`, «el conjunto del archivo sale ORDENADO como la pagina, no en el orden del planificador (R5)», con el fixture llegando desordenado a propósito |
| **`listarSaldosTodasTiendas()`** | ⚠️ **sigue sin `orderBy`** — confirmado por grep sobre `lib/repositories/WalletTiendaMovimientoRepository.ts:162` |
| Sus consumidores vivos | **uno**: `WalletTiendaService.listarSaldosTiendas()` (`:171-177`), que sirve la **tabla en pantalla**, no ningún archivo. La tabla ordena por nombre, así que el desorden no se manifiesta ahí |

O sea: **el defecto ya no sostiene ningún archivo**, que era donde dolía —dos descargas seguidas
podían diferir—. Lo que queda vivo es el método sin orden y su capacidad de volver a morder: el
riesgo residual es que un futuro consumidor lo use para construir un archivo y **herede el
defecto**, que es exactamente lo que el inventario de la deuda anotó que había que hacer y esta
feature decidió **no** hacer (el motivo está escrito junto al código, `WalletTiendaService.ts:187-197`).

**No se arregla aquí, a propósito:** añadirle el orden al método cambiaría el contrato de una
lectura que hoy sirve una pantalla que ya ordena por su cuenta, sin cerrar ningún requisito de
esta feature.

---

## 5.2 El gate completo (salida real, exigida por H.3)

```
$ ./init.sh
✓ typecheck paso
✖ 44 problems (0 errors, 44 warnings)        # AJENAS y preexistentes; delta propio: CERO
✓ lint paso
-> pnpm run test

 Test Files  950 passed (950)
      Tests  11847 passed (11847)
   Duration  248.89s

✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

**El delta cuadra con lo que H.3 añadió, y por eso es comprobable:** el cierre de la tanda H medía
**949 archivos / 11.824 tests**. Ahora son **950 / 11.847** ⇒ **+1 archivo** (la guardia de R16) y
**+23 tests** (los 22 de esa guardia + el caso de R26). Ni una regresión.

Las **44 warnings** de lint son el mismo número que midieron `chore_deuda_170.md §6` (2026-08-03),
las siete tandas y la tanda H sobre el árbol limpio: son ajenas y preexistentes.

---

## 6. Alcance de lo que este documento afirma

- Cada veredicto sale de **leer el cuerpo del caso**, no su título. `tasks.md` H.3 lo exige y este
  repo tiene el precedente del falso «68/68».
- Los tres tramos **ejecutaron** los archivos de su competencia: R14–R28 corrió 7 archivos
  (133 tests, verde) y R29–R34 corrió la guardia de adaptador (11/11, 751 ms). Los seis archivos
  de acciones de R17 y los dos censos se juzgaron **por lectura y medición estática**, no por
  ejecución.
- **La suite completa no se corre aquí.** El gate `./init.sh` es de H.4 y lo corre el leader,
  antes del PR, sin excepción.
