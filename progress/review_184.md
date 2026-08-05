# Review — feature 184 (deuda de la 170: los 12 listados descargables)

> Rama `feature/184-deuda-170-listados`, 56 commits sobre `origin/dev`. Revisión previa al PR.
> **Veredicto: RECHAZADO** — 2 bloqueantes. Ninguno es de trazabilidad ni de tests.

## 0. Qué se revisó y qué no

- **NO se rehízo la trazabilidad `R1..R34`.** Vive en `progress/impl_184-cierre.md`. Se auditó
  **por muestreo adversarial** (§1): 6 filas obligatorias + 2 extra. Las 8 se sostienen.
- **NO se corrió `./init.sh`** ni la suite (el gate es de H.4 y lo lleva el leader). Sí se
  corrieron las dos guardias nuevas: `adaptador-conjunto.guardia` + `criterio-unico.guardia`,
  **33 tests, 33 verdes, 668 ms**.
- Sí se revisó: código contra `requirements.md`/`design.md`, contra `docs/architecture.md` y
  `docs/conventions.md`, contra `CHECKPOINTS.md`, y **requisitos vivos de otras features**
  buscados por el TEXTO del contrato que cambia (§4).

## 1. Auditoría por muestreo de la trazabilidad (8 filas leídas en el cuerpo)

| Fila | Dónde | Se sostiene |
| --- | --- | --- |
| **R9** (tramo 1) | `tests/unit/services/cierre-dia-pasados-completo.test.ts:227` | **SÍ.** El espía en 0 lleva su anti-vacuidad **en el mismo caso**: ejecuta `listarCierreDia()` y exige `toHaveBeenCalledTimes(1)` con los 3 paths de evidencia. Un espía muerto no pasa |
| **R11** (tramo 1) | `recepcion-satelite-completo.test.ts:148` + `satelite-paginado-where.test.ts:433` | **SÍ.** El de servicio declara en su cabecera que usa dobles y no ve SQL, y sólo afirma que el filtro VIAJA al repo; el «EN LA BASE» lo sostiene el de repositorio, que inspecciona el `Prisma.Sql` emitido con regex del WHERE completo y el orden de los parámetros |
| **R17** (tramo 2) | `wallet-listados-descarga-action.test.ts:83` | **SÍ.** 6 claves coladas x 2 bordes, `validation_error` + espía del service en cero + contraprueba de que `{}` sí delega con UN solo argumento |
| **R21** (tramo 2) | `satelite-paginado-where.test.ts:487` | **SÍ.** Afirma el WHERE literal (zona ∧ deleted_at ∧ estados ∧ IN(ids)), que la zona es el parámetro 0 y que los ids van al final |
| **R24** (tramo 2) | `SateliteSeleccionOtrasPaginas.test.tsx:391` y `:450` | **SÍ.** Conteo exacto `toBe(llamadasAntes + 1)` en el caso que sí poda, y `toHaveBeenCalledTimes(1)` en el que no retira nada. Los dos con ancla positiva (el aviso baja 2→1) |
| **R32** (tramo 3) | `adaptador-conjunto.guardia.test.ts:149` | **SÍ, y verificado por fuera.** Grep independiente: 0 llamadas a `filasDelConjuntoCompleto` en `app/` y `components/` (única aparición: prosa en `descarga-resultado.ts:99`), 22 archivos de `app/` llaman al adaptador vivo. La guardia tiene 3 capas de anti-vacuidad + control positivo |
| R30 (extra) | `paginacion-transversal.test.tsx:1004` | **SÍ.** La lista vacía no la deja vacua: `toHaveLength(13)` sobre los `completo` es el ancla positiva, y la mitad negativa por listado sigue |
| R16 2ª mitad (extra) | `criterio-unico.guardia.test.ts` | **SÍ.** Auto-test del extractor en dos direcciones, control positivo sobre el árbol real (>10 `orderBy` literales fuera de los pares) y **4 mutaciones en memoria del código real** que exigen rojo |

**Conclusión del muestreo: el método de los tres verificadores se sostiene.** No hay motivo para
dudar del resto del mapa.

## 2. Checklist de CHECKPOINTS.md

- [x] `requirements.md` (34 EARS numerados), `design.md` (con 5 alternativas descartadas, §7).
- [ ] `tasks.md` todas `[x]` — **falta H.4** (gate final y PR). Es la tarea del leader.
- [x] Cada `R<n>` mapea a test concreto; `progress/impl_184-cierre.md` tiene el mapa.
- [x] typecheck / lint / test verdes (gate del leader: 950 archivos / 11.847 tests, 44 warnings
      ajenas y preexistentes).
- [~] E2E — no hay harness en el repo; checkpoint **inaplicable**, como en features previas.
- [x] Datos y seguridad: **cero migraciones**, cero tablas nuevas (RLS no aplica), cero secretos,
      cero webhooks. Verificado sobre el diff: `db/` no aparece.
- [x] Capas: repositorio sólo Prisma, servicio sin HTTP, guard de rol antes del repo en los 12,
      interfaces en `lib/interfaces/{services,repositories}/`. Sin desviaciones.
- [x] Permisos: alcance resuelto desde el actor, nunca desde la entrada; schemas `.strict()`
      derivados con `.omit({page,pageSize})`.
- [x] Multi-país: sin hardcode de país/moneda/cuenta en el código nuevo.
- [ ] `progress/history.md` sin entrada de la 184 — es H.4.
- [x] `progress/review_184.md` — este archivo.

## 3. Bloqueantes

### B1 — R29 de la **170** (feature `done`) queda derogado en **11 de los 12** listados nuevos

`specs/170-export-todas-las-tablas/requirements.md:158-159` dice, literal:

    R29 — El sistema DEBE aplicar el tope en el SERVIDOR y, cuando lo supere, NO DEBE
    materializar ni transportar más de N + 1 filas.

Su forma de test la fija la propia 170: `design.md:267-268` («Nunca se materializan más de
`N + 1` filas (R29)») y `tasks.md:731` → «nunca pide al repositorio más de N+1 filas», **un test
por servicio**. Existe para todos los servicios de descarga anteriores, p. ej.
`tests/unit/services/wallet-caja-descarga.test.ts:215`.

**El design de la 184 cita ese requisito y declara cerrarlo** (`design.md:90-92`: «lo que cambia
es DÓNDE se aplica, que es lo que R29 de la 170 pedía»). Lo entregado cierra sólo la mitad «en el
servidor». La mitad «no materializar más de N+1» se cumple en **1 de 12**:

- **Cumple:** `lib/services/WalletTiendaService.ts:204` (`pageSize: limite + 1`), con su caso
  `tests/unit/services/saldos-tiendas-completo.test.ts:241`.
- **No cumple** (piden el conjunto ENTERO y miran el tope después):
  `lib/services/CierreDiaService.ts:360` · `CierresAdminService.ts:259` y `:293` ·
  `CierresBodegaAdminService.ts:153` y `:180` · `IncidenteAdminService.ts:260` y `:294` ·
  `CierreBodegaService.ts:335` y `:370` · `GastoFijoPlantillaService.ts:103` ·
  `RecepcionSateliteService.ts:241`.

Los repositorios que los sostienen no llevan cota. Ejemplo:
`lib/repositories/CierresAdminRepository.ts::findHistoricoCompleto` es un `findMany` con `where`
+ `orderBy` + `select` y **sin `take`**.

**El caso peor es el listado 10:** `OrdenRepository.findRecepcionSateliteCompleta`
(`lib/repositories/OrdenRepository.ts:2273`) resuelve los ids **y los HIDRATA** con
`WITH_RECEPCION_SATELITE`; el tope se mira después, en `RecepcionSateliteService.ts:257`. Un
conjunto de 20.000 se materializa entero —con relaciones— para acabar devolviendo dos enteros.

**No es teórico:** el propio código dice que estos conjuntos crecen sin tope. Docstring de
`IncidenteAdminService.listarPendientesIncidentesCompleto`: «arrastraba todo el historico del
alcance —que crece sin tope con los dias—».

Por qué es bloqueante y no menor:

1. es un requisito **vivo** de una feature `done`, con forma de test establecida y aplicada 8
   veces antes en este mismo repo;
2. el design de la 184 **afirma cerrarlo**, y lo cierra a medias en 11 de 12 superficies nuevas;
3. **la excepción no está declarada en ninguna parte**, y el precedente de la casa sí la declara
   cuando toca: `lib/services/WalletMensajeroService.ts:225-229` explica por escrito por qué
   `listarCuentasPorPagarCompleto` no puede cortar en base y qué mitad de R29 sigue gobernando;
4. la vía existe y ya se usó en esta misma rama: pedirle al hermano paginado
   `{page: 1, pageSize: N + 1}`, que además devuelve el `total` del conjunto. Es exactamente lo
   que hizo el listado 12.

**Lo que NO es:** no es una regresión respecto a `dev`. Antes, ese mismo conjunto se materializaba
**y además se transportaba al navegador**. La 184 mejora el estado; lo que no hace es cerrar R29,
que es lo que dice cerrar.

**Qué falta para cumplirlo:** o el cap `N+1` en los 11, con su caso «nunca pide al repositorio más
de N+1 filas» por servicio (la forma que manda la 170), o la excepción **declarada junto al código
y medida** —volumen real por listado— con su ficha propia. Cualquiera de las dos vale; el
silencio, no.

### B2 — La feature no entrega **Q-K6 rama B**, que su propio registro declara dentro del alcance

`feature_list.json`, entrada 184:

- `description`: «… **Absorbe Q-K6 (rama B)** y el punto 4 del backlog.»
- `status_note`: «PUERTA CERRADA 2026-08-04. **Q-K6 = RAMA B (listarRecepcionSatelite deja de
  devolver los cinco grupos) y va DENTRO de esta feature**…»

El commit que registra la feature (`342ddecb`, «spec de la deuda 170 … y puerta cerrada») lo
repite en su propio mensaje. Es la puerta humana, cerrada y escrita.

**Contra el árbol, no se hizo:**

- `lib/actions/recepcion-satelite.ts:134` — `listarRecepcionSatelite` sigue devolviendo los cinco
  grupos.
- `lib/services/RecepcionSateliteService.ts::listar()` sigue leyendo **seis estados de la zona
  entera** más un `contarIntentosEnLote` sobre todas esas filas, **en cada render** de
  `/recepcion-satelite` (`app/(app)/recepcion-satelite/page.tsx:30`), para que la página use sólo
  `porRecibir`, `zonaNombre` y `sinZona`. Los otros cinco grupos se construyen y se tiran.
- Tras la tanda A ese método tiene **un solo consumidor** —la condición que la propia spec fijaba
  para desbloquear la rama B— y aun así no se ejecutó.

La contradicción está **dentro del mismo commit**: `requirements.md:47` dice «Q-K6: no se decide
aquí» y su Q1 fija como default «fuera de esta feature»; `tasks.md` no tiene ninguna tarea para
ello; y las bitácoras la dan por fuera (`impl_184_tandaH.md:533`). O sea: la decisión humana se
registró en el JSON y nunca bajó ni al spec ni a las tasks.

**Qué falta:** una de dos, y la decide el humano/leader, no el implementer:

- (a) implementarla — el trabajo está acotado en `requirements.md` Q1 rama B: el contrato del
  service, el Server Component y los dobles de esos cinco campos; o
- (b) corregir `description` y `status_note` de la 184 **antes del PR**, porque hoy el registro
  afirma sobre lo entregado algo que el árbol desmiente, y así es como el backlog se desincroniza.

## 4. Requisitos vivos de otras features: qué se buscó y qué salió

Búsqueda **por el texto del contrato que cambia**, no por los archivos que se tocan (la regla
ganada con R16 de la 127). Sobre `specs/**` completo:

| Texto buscado | Dónde apareció | Resultado |
| --- | --- | --- |
| `filasDelConjuntoCompleto` (adaptador retirado) | `specs/170/tasks.md:533,670,674` | **Sin derogación.** En la 170 es un MECANISMO de R52, no un requisito. R52 lo cumple ahora `filasDesdeResultado` en los 13, afirmado por el censo |
| `filasDesdeResultado` · `filasLocales` · `obtenerFilas` | specs 151, 170, 171, 172 | Sin derogación: los contratos `DescargaFilasResult` y `ListarCompletoResult` no cambian |
| **tope en el servidor · `N + 1` · «materializar»** | `specs/170/requirements.md:158`, `design.md:267`, `tasks.md:731` | **DEROGADO → B1** |
| «no aumentar el número de consultas» (R32/R54 de la 170) | `specs/170/requirements.md:168,248` | Tensión declarada dentro de la 184 (R28 acota la exención a carga inicial y descarga). Ver menor 6 |
| Selección en listados paginados (R47/R48 de la 170) | `specs/170/requirements.md:230-235` | **Sin derogación.** La selección efectiva sigue acotada a la página visible; la poda sólo retira lo que salió del conjunto, y H.3 añadió el caso de la acción de lote |
| Filtros de cliente → servidor (R45 de la 170) | `specs/170/requirements.md:220` | **Reforzado.** Se retira `filtrarOrdenesSatelite`, la última declaración de cliente. El cambio de semántica (normalizada → exacta) ya lo declaró la 170 y su equivalencia la sigue midiendo `tests/unit/services/recepcion-satelite-paginado.test.ts` |
| Acciones-fuente por nombre: `listarRecepcionSatelite`, `listarCierresBodegaAdmin`, `listarPlantillasAction`, `listarSaldosTiendasAction`, `listarIncidentes`, `listarConsolidacion`, `listarCierreDia`, `listarCierresAdmin` | specs 33, 34, 37, 38, 39, 40, 43, 45, 56, 67, 102, 109, 111, 158, 170, 171 | **Sin derogación:** ninguna acción se borró. Tres quedaron sin consumidor de producción y se conservan con motivo escrito (menor 4) |
| URLs firmadas de evidencia dentro del archivo | `app/(app)/incidentes/_components/incidentes-descarga-columnas.ts:9-11` | **Sin derogación, y va en la dirección segura.** El archivo de incidentes nunca tuvo columna de evidencia («un xlsx reenviado por correo con ellas dentro es acceso a las fotos sin sesión»); `SIN_URLS_FIRMADAS` reduce superficie |
| Mappers de dinero (43/R16, 172/R28, 183) | código + specs | **Sin derogación.** Los 12 usan el MISMO mapper que su página; wallet-tienda extrajo `toSaldoResumen` para que sea literalmente el mismo, y cierres-admin conserva `conPendiente` |

**Sí se encontró uno derogado: R29 de la 170 (B1).** El resto de lo buscado se sostiene.

## 5. Menores

1. **`.claude/settings.json` viaja en el PR y no es de esta feature.** Commit `72167549`: añade
   `permissions.allow: ["Bash(vercel env add:*)"]`. Es configuración del agente, ajena a la 184;
   debería ir por su propia vía y no colarse en el PR de una feature.
2. **La poda no maneja el rechazo de la promesa.** En `SateliteOrdenesListado.tsx`, el efecto de
   poda hace `void comprobar(fuera).then(...)` sin `.catch`. Si la Server Action **rechaza** (red,
   500), hay unhandled rejection; R22 se cumple por accidente, porque no hay `setState`. Los tests
   sólo cubren la respuesta `{status: "forbidden"}`
   (`SateliteSeleccionOtrasPaginas.test.tsx:512`), nunca un `mockRejectedValue`.
   `docs/conventions.md`: «Nada de catch vacíos. Un error o se maneja o se propaga con contexto.»
3. **R12, mitad de «columnas y orden de columnas»: sin test.** Ya declarado DÉBIL por la propia
   bitácora (`impl_184-cierre.md §2.1`), con la medición del diff que demuestra que esta rama no
   pudo romperlo y con la ficha propia acotada. Se acepta como deuda declarada; queda sin dueño.
4. **Tres Server Actions exportadas con cero consumidores de producción**
   (`listarCierresBodegaAdmin`, `listarPlantillasAction`, `listarSaldosTiendasAction`). Se
   conservan con el motivo escrito junto al código (commit `fa60b0ce`) y la guardia de R32 impide
   que vuelvan a la capa de pantallas. Siguen siendo endpoints POST invocables, con su guard de
   rol intacto. Aceptable y declarado; conviene que el PR lo diga.
5. **Rastro contradictorio en `app/(app)/cierres-admin/page.tsx:92-101`:** el comentario dice que
   `listarCierresBodegaAdmin` es «candidata a retirada de la tanda H», y la tanda H decidió
   **conservarla**. El comentario quedó en el estado anterior a esa decisión.
6. **R32/R54 de la 170 frente a la consulta de vigencia.** La poda añade una consulta por
   relectura cuando hay marcas fuera de la página visible. Está declarada y acotada dentro de la
   184 (R28, design §4.2) y medida por tests, pero **ninguna bitácora la contrasta contra R32/R54
   de la 170**, que hablan de «no aumentar el número de consultas … mientras el usuario no pulse
   el control de descarga» y «por render». Debería quedar escrito en el PR.
7. **Dos huecos de la guardia de R31**, uno ya declarado y otro no:
   (a) `adaptador-conjunto.guardia.test.ts:377` cuenta `\bit\s*\(` en TODO el archivo, no los
   casos censales — declarado en `impl_184-cierre.md §5`;
   (b) **no declarado:** `MARCAS_DESACTIVACION` se evalúa **línea a línea** (`:361-365`), así que
   un `it` y su `.skip(` partidos en dos líneas lo evaden, aunque la regex sí los casaría sobre el
   texto entero.
8. **Checkpoints pendientes de H.4:** `progress/history.md` sin entrada de la 184 y `tasks.md` H.4
   sin marcar. Es trabajo del leader, no del implementer.

## 6. Lo que está bien y conviene no perder

- Los tres helpers del satélite (`condicionesSatelite` / `desdeSatelite` / `ordenBodegaSatelite`)
  hacen que las TRES consultas del dominio no puedan divergir. Es la propiedad que da nombre a la
  feature y está probada donde vive: sobre el `Prisma.Sql` emitido, no sobre dobles.
- `criterio-unico.guardia.test.ts` prueba la mitad de R16 que los diez casos de emisión **no
  podían ver**, con auto-test del extractor, control positivo sobre el árbol real y 4 mutaciones
  en memoria del código real. Es la guardia mejor construida que ha entrado por esta vía.
- Las bitácoras declaran sus propias debilidades (R12 DÉBIL, R13 vacuo por diseño, el detector de
  la guardia reverificado tras el susto de la tanda H). Eso es lo que hizo posible revisar por
  muestreo en vez de rehacerlo todo.

## 7. Veredicto

**RECHAZADO.** No por trazabilidad, ni por tests, ni por capas: por **B1** (R29 de la 170
derogado en 11 de 12 superficies nuevas, sin declararlo, en un design que afirma cerrarlo) y
**B2** (el registro de la feature declara dentro de alcance una rama B que no se entregó).

B2 puede cerrarse con una corrección de registro por el humano/leader. B1 exige o el cap `N+1`
con sus casos, o la excepción declarada y medida. Ninguno de los dos se arregla en este review.
