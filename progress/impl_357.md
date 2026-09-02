# Ficha 357 — el alcance de la satélite pasa a ser SU BODEGA, no su zona (backend)

Rama `feature/357-alcance-satelite-por-bodega`. Sin commit: lo hace el leader.
Alcance de este trabajo: capa de datos, contrato de estados y tests. **No se tocó UI**
(componentes, páginas ni layouts); sí sus tests, que son de mi alcance y quedaban rojos.

---

## 1. Cómo se identifica QUÉ bodega — la pregunta que había que resolver primero

Se midió contra el esquema y contra la base local, no se supuso.

**No existe una entidad «bodega». La bodega satélite ES la zona.** La evidencia, toda del
código real (confirmada abriendo el archivo, no solo del grafo):

| dónde | qué dice |
|---|---|
| `db/schema.prisma` (`CierreBodega.zonaId`) | «zona satelite que cierra» — el cierre de bodega se ancla en `zona_id` |
| `usuario.zona_id` | es el alcance del `adminSatelite` (`findUsuarioZonaId`) |
| `DeshacerAsignacionService.ts:197` | `const esCentral = orden.zonaId === centralZonaId;` — el destino bodega-central vs. bodega-satélite se **deriva de `orden.zona_id`** |
| `OrdenRepository.rutearBodegaSateliteLote` | el ruteo no guarda destino: la satélite destino es la de `orden.zona_id` |
| `LiberacionReprogramadaRepository` / `DevolucionSlaRepository` | el cron elige `en_bodega_central` o `en_bodega_satelite` leyendo la zona de la orden |

**`orden_historial_estado` NO tiene columna de bodega ni de zona.** Su `actor_usuario_id`
daría una zona sólo en las entradas que ejecuta un `adminSatelite` (`recepcion_satelite`,
`recuperacion_manual`, parte de `deshacer_asignacion`/`incidente`). En las demás entradas a
`en_bodega_satelite` **el actor no sirve**: `liberacion_reprogramada` (#26) y
`liberacion_devuelta_sla` (#20) las hace el **cron** (`actor_usuario_id` NULL) y
`liberacion_sin_gestionar` (#18) un **admin sin zona**. Medido en la base local: de las 4 filas
de historial con destino satélite, las 2 de `recepcion_satelite` llevan actor con zona y las 2
de `ruteo_satelite` llevan un actor **sin zona**.

Conclusión, y es lo que se implementó: **el alcance tiene DOS mitades y ninguna sobra.**

- `orden.zona_id = <zona del actor>` dice **QUÉ** bodega. Es la frontera entre inquilinos y **no
  se tocó**: es lo que garantiza que el cambio no pueda ensanchar el alcance de nadie.
- el **historial** dice **SI ESTUVO** en una bodega satélite. Es la mitad que faltaba y la que
  cierra la cara (B).

---

## 2. El criterio, tal como quedó escrito

`lib/repositories/OrdenRepository.ts` → `condicionPasoPorBodegaSatelite()`, emitida **siempre**
por `condicionesSatelite()` (la comparten la página, el conjunto de la descarga y la vigencia):

```
o."zona_id" = $1
AND o."deleted_at" IS NULL
AND (
      os."value" IN ('en_ruta_bodega_satelite','en_bodega_satelite')
   OR EXISTS (SELECT 1 FROM "orden_historial_estado" h
              JOIN "order_status" hos ON hos."id" = h."estatus_destino_id"
              WHERE h."orden_id" = o."id"
                AND hos."value" IN ('en_ruta_bodega_satelite','en_bodega_satelite'))
    )
AND os."value" IN (<los 16 del contrato>)
```

**Por qué el primer disyunto (estado actual) no ensancha nada.** Medido: en la base local hay
**6 órdenes hoy en `en_bodega_satelite` SIN ninguna fila de historial** que las haya llevado ahí
(datos escritos por fuera del choke point). Sin ese disyunto, un paquete que está físicamente en
el estante desaparecería de la pantalla de quien lo tiene. Y no puede abrir nada: interseca con
`estatusValues`, que sale de `ESTADOS_BODEGA_SATELITE`, donde el único estado de custodia es
`en_bodega_satelite` — **que ya se mostraba antes de esta ficha**.

**Sin migración.** El `EXISTS` corre contra
`orden_historial_estado_orden_id_estatus_destino_id_idx` (`@@index([ordenId, estatusDestinoId])`,
feature 49/R24), verificado en `pg_indexes` de la base local. Es exactamente esta búsqueda.

**`findRecepcionSateliteByZona` NO se tocó**, a propósito: sirve a «Por recibir»
(`en_ruta_bodega_satelite`, que por definición son un ruteo a esa satélite) y a
`zonaNombre`/`sinZona`. Sus otros cuatro buckets ya no cruzan al cliente (170/T K.3 y 279/T2.1),
así que ahí no hay cara B viva. Aplicarle el `EXISTS` habría puesto en riesgo las 254 órdenes en
ruta de producción por un beneficio de cero.

---

## 3. El CONTRATO para el frontend

`lib/utils/estados-bodega-satelite.ts`. Tres exports, y el nombre viejo se conserva para no
arrastrar un renombrado por la UI:

| export | qué es |
|---|---|
| `ESTADOS_BODEGA_SATELITE` | **los 16 estados que el filtro debe ofrecer, en el orden en que la pantalla los presenta.** Alimenta el `z.enum` del borde y el `array_position` del `ORDER BY` |
| `ESTADOS_CUSTODIA_SATELITE` | los 2 estados que son EVIDENCIA de alcance (`en_ruta_bodega_satelite`, `en_bodega_satelite`). **No es la lista de la pantalla** |
| `ESTADOS_FUERA_DEL_LISTADO_SATELITE` | los 6 que quedan fuera, con su motivo. Es el único punto de reversión |

**Los 16, en orden:**

```
en_bodega_satelite · por_recoger · en_reparto · ayuda_tienda · entregada · reprogramada ·
rechazada · sin_gestionar · incidente · devolucion_por_confirmar · por_devolver ·
devolviendo_a_bodega_central · devuelta · por_devolver_a_tienda · devolviendo_a_tienda ·
devuelta_a_tienda
```

**Los 6 que NO se ofrecen:** `en_preparacion`, `por_recolectar_en_tienda`, `recolectando`,
`en_ruta_bodega_central`, `en_bodega_central` (custodia de la central: la orden dejó de ser
suya) y `en_ruta_bodega_satelite` (son las «Por recibir», con pantalla propia en
`/recepcion-satelite/por-recibir`; ofrecerlas aquí duplicaría filas en dos pantallas).

**No es una lista de deseos: es el cierre del grafo.** `alcanceDerivadoDelGrafo()` recalcula el
cierre transitivo de `TRANSICIONES` desde `ESTADOS_CUSTODIA_SATELITE` podando esos 6 como
**nodos** (una orden que vuelve a la central deja de ser de la satélite, y lo que le pase después
tampoco es suyo). El test compara el literal contra ese cálculo **en las dos direcciones**: ni
sobra un estado inalcanzable —el defecto de la 355, 22 ofrecidos y 17 dando cero— ni falta uno
alcanzable —el defecto de la cara A—.

Los cinco estados de siempre **conservan su orden relativo** (posiciones 1, 2, 11, 12, 13): la
pantalla gana filas, no reordena las que ya tenía.

### `en_reparto`: ENTRA, y por qué

El repo lo decidió dos veces en contra («el paquete está EN LA MOTO»), pero bajo la premisa
vieja: el listado era «lo que tengo físicamente en el estante». La ficha 357 cambia la premisa a
«el recorrido de mis órdenes, de principio a fin». Con la premisa nueva, si el listado enseña
`entregada` y `rechazada` pero esconde `en_reparto`, la orden **desaparece durante las horas que
pasa en la calle y reaparece al gestionarse**: es el mismo defecto de la cara A, sólo que más
corto. Y el cierre pendiente de esa orden es de la satélite.

**Reversible en un sitio:** mover el value de `ESTADOS_BODEGA_SATELITE` a
`ESTADOS_FUERA_DEL_LISTADO_SATELITE` (dos declaraciones contiguas, mismo archivo). El test
recalcula el cierre menos esa lista, así que no pueden quedar en desacuerdo en silencio.

### Otras dos decisiones REVERTIDAS (y esto es lo que más quiero que se lea)

- **`ayuda_tienda`** (feature 235/R37): entra, misma razón que `en_reparto`.
- **`devolucion_por_confirmar`** (feature 239/**P4, firmada por el humano** en contra de la
  recomendación del spec): entra **sólo en cuanto a VER**. Lo que P4 decidió —que el
  `adminSatelite` no puede RECUPERAR A BODEGA una devolución aún no anclada— **queda intacto**:
  no se añadió ninguna arista de `recuperacion_manual` al pre-estado, y el test lo sigue
  afirmando. Lo que cambia es que el tramo en que el paquete espera la aprobación del cierre
  (retraso medido entonces: p90 22,1 h, máx 48,2 h) deja de ser invisible.

---

## 4. Cara B: la evidencia de que se cerró

El test `la cara B se cierra…` corre, **en la misma transacción y sobre las mismas filas**, el
criterio VIEJO escrito a mano (zona ∧ los cinco estados) y el listado nuevo:

- **antes**: `expect(viejoCriterio).toContain(devueltaSinBodega)` — la devolución ajena SÍ entraba;
- **después**: `expect(vistos).not.toContain(devueltaSinBodega)` — ya no;
- **y no se perdió lo físico**: `expect(vistos).toContain(enBodegaSinHistorial)`.

Sin la primera mitad, «ya no se ve» no distinguiría «lo arreglé» de «nunca se vio».

---

## 5. Archivos

**Producción (4):**
- `lib/utils/estados-bodega-satelite.ts` — reescrito: contrato de 16, evidencia, poda y derivación.
- `lib/repositories/OrdenRepository.ts` — `condicionPasoPorBodegaSatelite()` + su uso en `condicionesSatelite()`.
- `lib/interfaces/repositories/IOrdenRepository.ts` — doc de `RecepcionSateliteFiltro` y de los tres métodos.
- `lib/services/RecepcionSateliteService.ts` — doc del cambio de criterio (sin cambio de comportamiento).

**Tests (11 modificados + 1 nuevo):**
- **nuevo** `tests/integration/db/satelite-alcance-por-bodega-real.test.ts` (6 casos, Postgres real).
- `tests/unit/utils/estados-bodega-satelite.test.ts` — reescrito al contrato nuevo.
- `tests/unit/repositories/satelite-paginado-where.test.ts` — el SQL emitido; +2 casos de la ficha.
- `tests/integration/db/satelite-bodega-alcance-real.test.ts` — la siembra escribe historial.
- `tests/fixtures/satelite-bodega-almacen.ts`, `tests/unit/services/recepcion-satelite-{paginado,completo}.test.ts` — el doble modela la mitad nueva; a-14/a-15 son las dos caras.
- `tests/unit/actions/recepcion-satelite-action.test.ts`, `tests/unit/components/satelite-filtro-estado.test.ts`, `tests/components/SateliteFiltroEstadoAlcance.test.tsx` — el ejemplo de «estado inalcanzable» pasa de `entregada` a `en_bodega_central`.
- `tests/unit/components/recibidas-columns.test.tsx`, `tests/unit/repositories/orden-repository.test.ts` — aserciones invertidas con su motivo (ver §8).

**Sin migración, sin cambios de RLS, sin Server Actions nuevas.**

---

## 6. Mapa requisito → test

La ficha no tiene `specs/` (`"sdd": false`). Se numeran las exigencias del encargo.

| # | exigencia | test |
|---|---|---|
| R1 | (a) una `entregada` que pasó por la bodega A, A **sí** la ve | `satelite-alcance-por-bodega-real` › «(a)(b)(c) las tres filas…» |
| R2 | (b) una `entregada` de la misma zona que no pasó por ninguna bodega, A **no** la ve | ídem |
| R3 | (c) una que pasó por la bodega **B**, A **no** la ve | ídem + «la bodega B ve lo suyo y sólo lo suyo» |
| R4 | el caso del reporte (`rechazada`, guía 66840050) vuelve a ser visible | ídem (`rechazadaPasoPorA`) |
| R5 | la cara B se cierra: las devoluciones ajenas dejan de verse, y se demuestra que hoy se veían | «la cara B se cierra…» |
| R6 | no se pierde lo que está físicamente en el estante | ídem (`enBodegaSinHistorial`) |
| R7 | las borradas (`deleted_at`) siguen fuera, **también del total** | «las borradas siguen fuera —tampoco en el TOTAL—…» |
| R8 | el contrato dice qué estados alcanza de verdad una satélite | `estados-bodega-satelite.test.ts` › «la lista literal y el cierre derivado… (las dos direcciones)» |
| R9 | el filtro interseca y nunca amplía | `estados-bodega-satelite.test.ts` › bloque «el filtro INTERSECA»; `satelite-alcance-por-bodega-real` › «pedir un estado de la central devuelve NADA» |
| R10 | el alcance no se puede apagar desde el filtro | `satelite-paginado-where.test.ts` › «el criterio «pasó por MI bodega» no se puede apagar desde el filtro» |
| R11 | la página, la descarga y la vigencia comparten el criterio | `satelite-paginado-where.test.ts` › «las tres consultas del dominio comparten el criterio» |
| R12 | «Por recibir» no se duplica en el listado | «las borradas siguen fuera… y las «Por recibir» no se cuelan» |
| R13 | `devolucion_por_confirmar` se lista sin ganar la palanca de P4 | `estados-bodega-satelite.test.ts` › «239/P4 REVERTIDA SÓLO EN CUANTO A VER» |

---

## 7. Mutaciones — 8 aplicadas, 8 muertas, 0 supervivientes

Cada una: aplicar → comprobar por huella (`git diff | git hash-object`) que el árbol **cambió** →
correr 4 archivos (41 tests) → revertir → comprobar que el árbol volvió **idéntico** al sano
(`b617fa74…`). El arnés aborta si la mutación no cambia nada o si la reversión no cuadra.

| # | mutación | resultado | primera línea que cayó |
|---|---|---|---|
| **M1** | **vuelta al criterio POR ZONA**: se retira `condicionPasoPorBodegaSatelite()` | 12 rojos | `satelite-alcance-por-bodega-real.test.ts:329` · `expect(vistos).not.toContain(entregadaSinBodega)` → *expected […(5)] to not include '461ca8b8…'* |
| **M2** | **se quita la comprobación de QUÉ bodega** (`o."zona_id" = …`) | 9 rojos | `satelite-alcance-por-bodega-real.test.ts:424` · `expect(paginaB.total).toBe(1)` → *expected 12 to be 1* |
| **M3** | la cláusula de alcance deja de ser hermana: `AND` → `OR` en `desdeSatelite` | 10 rojos | `satelite-alcance-por-bodega-real.test.ts:329` → *expected […(6)] to not include '583bbdf8…'* |
| **M4** | se cae el `EXISTS`: sólo cuenta el estado actual (se pierde la cara A) | 12 rojos | `satelite-alcance-por-bodega-real.test.ts:324` · `expect(vistos).toContain(entregadaPasoPorA)` → *expected [Array(1)] to include '0474cd0e…'* |
| **M5** | se cae el disyunto del estado actual: sólo cuenta el historial | 8 rojos | `satelite-alcance-por-bodega-real.test.ts:376` · `expect(vistos).toContain(enBodegaSinHistorial)` → *expected […(2)] to include '98836a2b…'* |
| **M6** | la EVIDENCIA se queda a medias: `en_bodega_satelite` sale de `ESTADOS_CUSTODIA_SATELITE` | 10 rojos | `satelite-alcance-por-bodega-real.test.ts:376` → *expected […(2)] to include 'd1aee0cf…'* |
| **M7** | reaparecen las borradas: se retira `o."deleted_at" IS NULL` | 3 rojos | `satelite-alcance-por-bodega-real.test.ts:402` · `expect(pagina.total).toBe(pagina.items.length)` → *expected 4 to be 3* |
| **M8** | el CONTRATO se ensancha con `en_bodega_central` | 8 rojos | `satelite-bodega-alcance-real.test.ts:370` → *expected Set{…(4)} to deeply equal Set{…(3)}* |

**M7 enseñó algo y por eso se reforzó el test.** En la primera pasada M7 sólo mataba las
aserciones de TEXTO del SQL: la hidratación (`hidratarSatelite`) repite `deletedAt: null` por su
cuenta, así que la borrada desaparecía igual de `items`… **pero seguía contada**, porque el total
sale del `COUNT(*) OVER ()` de la consulta que ordena. Se añadió
`expect(pagina.total).toBe(pagina.items.length)` y ahora M7 muere también por comportamiento
(`4` contra `3`). El 29 de agosto se borraron 29 órdenes en producción: ese total era la fuga.

---

## 8. Decisiones que revierten firmas anteriores (para el leader / el humano)

Tres aserciones existentes **afirmaban lo contrario** de lo que esta ficha decide. No se
borraron: se **invirtieron con su motivo escrito**, para que el hecho quede afirmado y no
desaparezca en silencio junto con la decisión que lo sostenía.

1. `tests/unit/utils/estados-bodega-satelite.test.ts` — «el pre-estado NO entra (239/P4)» →
   ahora entra, y al lado se sigue afirmando que **el grafo no le da `recuperacion_manual`**.
2. `tests/unit/repositories/orden-repository.test.ts:892` — «el listado de la bodega satélite
   tampoco la admite» (`ayuda_tienda`, 235/R17) → ahora la lista. Lo que R17 protege —que no se
   pueda ASIGNAR, RUTEAR ni RECOLECTAR— lo sostienen el `where` y el grafo, no la lista de una
   pantalla. **VER no es OPERAR.**
3. `tests/unit/components/recibidas-columns.test.tsx` — «`reprogramada` de verdad NO está entre
   los estados del listado». Ese caso decía literalmente «si algún día `reprogramada` entrara en
   la bodega, este caso se pone rojo y obliga a rehacer la decisión». **Ese día es hoy.**

---

## 9. Salidas reales

```
$ pnpm typecheck
> tsc --noEmit
TYPECHECK EXIT=0            (sin una sola línea de error)

$ pnpm lint
✖ 145 problems (0 errors, 145 warnings)
  (los 145 son `@typescript-eslint/no-unused-vars` heredados en tests: `_id`, `_tx`, `_input`…;
   ninguno en los archivos de esta ficha)

$ pnpm exec vitest run --changed=HEAD
 Test Files  314 passed (314)
      Tests  4398 passed | 17 skipped (4415)
   Duration  243.70s

$ pnpm exec vitest run tests/integration/db/satelite-alcance-por-bodega-real.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ pnpm exec vitest run tests/unit/guards/superficie-de-uso.guardia.test.ts
      Tests  1 failed | 17 passed (18)
  → "lib/actions/tarifas.ts:67 obtenerTarifa"   ← ROJO HEREDADO, el único tolerado
```

---

## 10. Lo dudoso — lo que NO pude medir y lo que queda abierto

1. **No pude medir contra producción.** Las herramientas MCP de Supabase **no están en mi
   conjunto de herramientas** en esta sesión (sólo `codebase-memory` + shell), y `DATABASE_URL`
   de prod es *sensitive*. Todo lo medido es contra `localhost:5432` (67 órdenes, 204 filas de
   historial, 4 con destino satélite) y contra el esquema. **Los números de la ficha (17
   invisibles, 16 devueltas ajenas, 252 entregadas) no los verifiqué yo**; los tomé como dados.
2. **La comprobación que le pediría a quien sí tenga prod, antes de desplegar:** ¿alguna de las
   17 órdenes invisibles llega a un cierre de satélite **sin** tener fila de historial con
   destino satélite? Pasaría si se asignó directamente desde la bodega central (el
   `cierre_dia.destino_zona_id` se deriva de `orden.zona_id`, no del paso por la bodega). Ésas
   **seguirían invisibles** con este criterio. La consulta:
   ```sql
   SELECT count(*) FROM orden o
   JOIN cierre_detail cd ON cd.orden_id = o.id
   JOIN cierre_dia c ON c.id = cd.cierre_id
   WHERE c.cierre_bodega_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM orden_historial_estado h
                     JOIN order_status hos ON hos.id = h.estatus_destino_id
                     WHERE h.orden_id = o.id
                       AND hos.value IN ('en_ruta_bodega_satelite','en_bodega_satelite'));
   ```
   Si sale > 0, hace falta una tercera fuente de evidencia (el cierre de bodega, que sí está
   anclado a `zona_id`) y eso es otra ficha.
3. **El único hueco teórico del criterio.** `CorregirDatosClienteService` **puede cambiar
   `orden.zona_id`** (lo deriva del distrito, 327/R5) en todos los estados salvo los cuatro de
   `ESTADOS_SIN_CORRECCION` (`entregada`, `devuelta_a_tienda`, `incidente`, `rechazada`). Una
   orden que pasó por la bodega **B** y luego se corrige a la zona **A** sería vista por A. Hoy
   ya pasa con los cinco estados viejos (`devuelta` está en la lista blanca desde siempre), así
   que **no es un hueco nuevo**, pero sí uno que ahora abarca más estados. No lo cerré porque
   cerrarlo exigiría un dato que el modelo no tiene: el historial no guarda a qué bodega se
   ruteó, y el actor no sirve en 4 de las 8 entradas a `en_bodega_satelite`. Lo dejo dicho.
4. **Deuda de UI que este cambio deja destapada** (para el agente de frontend):
   - `app/(app)/recepcion-satelite/_components/recibidas-columns.tsx` tiene un comentario que
     dice «este listado MEZCLA cinco estados y `reprogramada` NO es ninguno de ellos». **Ya no es
     cierto.** Si «Liberada el» debe montarse ahora es decisión de pantalla; el dato
     (`fechaReprogramacion`) ya viaja en la fila desde la 349.
   - El desplegable ofrece hoy el catálogo entero (355) y el borde rechaza lo que no está en el
     contrato. Con los 16 nuevos, el filtro debería ofrecer **exactamente** `ESTADOS_BODEGA_SATELITE`.
   - Los títulos y descripciones de `/recepcion-satelite/en-bodega` («Órdenes que ya están en tu
     bodega satélite») describen el alcance viejo.
5. **Coste en producción, no medido.** El `EXISTS` usa el índice correcto, pero el plan real
   sobre una tabla append-only grande no lo pude observar (la base local tiene 204 filas). No
   espero problema —es una búsqueda por `(orden_id, …)` acotada ya por zona y estado— pero no lo
   afirmo como medido.
