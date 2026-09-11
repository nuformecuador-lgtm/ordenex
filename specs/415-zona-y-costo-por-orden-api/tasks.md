# Feature 415 — tasks

> **Regla de «hecho» en esta ficha:** el criterio es **un aserto que se pone ROJO si el código está
> mal**, nunca un `grep` sobre un comentario. Cuando una task sólo se pueda comprobar leyendo, se
> dice explícitamente que su verificación es **humana** y quién la firma (el reviewer).
>
> **Tres trampas que en ESTA ficha muerden, y cómo se esquivan en cada task:**
>
> 1. **Aserción contra su propia fuente.** Comparar un importe contra la función que lo calcula está
>    siempre verde. **Todos los importes esperados se escriben A MANO**, con la aritmética hecha
>    aparte y anotada al lado. Ni un `expect(x).toBe(costoEstimadoDe(...))`.
> 2. **Los dobles no ven el SQL.** El `select` que trae la zona, el que trae el congelado y su
>    `where` viven en Prisma. Lo que un doble puede afirmar es **qué se le pidió a Prisma**; lo que
>    Postgres devuelve **sólo lo dice Postgres**. Por eso T7 es contra base real y no es opcional.
> 3. **Test verde sin datos.** El **28 %** sin costo congelado es el caso fácil de colar con un
>    escenario vacío. Todo test de integración de esta ficha **afirma primero que sembró** (longitud
>    > 0) antes de afirmar sobre el contenido, y ninguno lleva `if (!fks) return;`.
>
> **Regla de alcance:** ficha **aditiva y de sólo lectura**. Ninguna task puede crear una migración,
> una tabla, una columna, un índice, un endpoint, un parámetro de query ni un campo que no sea
> `zona`, `costoEstimado` o `costoReal`. Si una task parece pedirlo, está mal escrita: parar y
> preguntar.
>
> **Cero preguntas abiertas.** Las cinco están cerradas por el humano (design §3, D2–D6). Ninguna
> task puede reabrirlas por su cuenta; si una decisión no cuadra al implementar, se para y se
> pregunta.

Leyenda: `[P]` = paralelizable con las demás `[P]` de su bloque.

---

## T0 — Base MEDIDA antes de escribir código (BLOQUEA TODO)

### T0.1 — Los símbolos existen, en el archivo real

El índice del grafo **devuelve de más** y ya dio una línea rancia en esta zona al escribir el spec
(`ApiOrdenRow` reportado en `IOrdenRepository.ts:841`, real: 1046). Confirmar **abriendo el
archivo**, no el grafo, que siguen existiendo:

`API_ORDEN_SELECT`, `API_ORDEN_DETALLE_SELECT`, `ApiOrdenSelectRow`, `toApiOrdenRow`,
`listByOwner`, `findDetalleByOrdenIdForOwner` (`lib/repositories/OrdenRepository.ts`);
`ApiOrdenRow`, `ApiOrdenDetalleRow` (`lib/interfaces/repositories/IOrdenRepository.ts`);
`toListItemDTO`, `toDetalleDTO` (`lib/services/ApiOrdenLecturaService.ts`);
`ApiMensajeroDTO` (`lib/types/api-orden.ts`);
`derivarIngresoOrden`, `resolverFlete`, `montoFulfillmentDeTarifa` (`lib/utils/ingreso-ordenex.ts`);
`tarifaDe`, `DETALLE_SELECT` (`lib/utils/cierre-detalle.ts`);
`serializarMontoCotizacion` (`lib/utils/monto-cotizacion.ts`);
`resolveTarifas`, `TarifaVigente`, `TarifaVigenteResuelta`
(`lib/interfaces/repositories/ITarifaVigenteRepository.ts`); `clavePar`, `ParTarifa`
(`lib/utils/cascada-tarifa.ts`).

**Hecho cuando:** `progress/impl_415.md` abre con el SHA de `origin/dev` usado y **una línea por
símbolo** diciendo que existe y en qué archivo y línea. Verificación humana (la firma el
implementer, la revisa el reviewer).

### T0.2 — Reproducir la medición de cobertura y CONFIRMAR el mecanismo (cierra D5)

El humano ya midió contra producción el 2026-09-10: **1.182 de 1.652** órdenes vivas tienen fila en
`cierre_detail` (72 %), y **las 1.182 son de cierres `aprobado`**. Aquí no se vuelve a medir
producción: se **reproduce en local** y, sobre todo, se **confirma el mecanismo**, porque de él
depende que el filtro de R26 se pueda escribir como load-bearing y no como ruido.

1. Reproducir los dos conteos en local (fila en `cierre_detail`; fila de cierre `aprobado` **y** con
   `cierre_detail.tienda_id = orden.tienda_id`).
2. Contar órdenes con **≥2** filas elegibles ← cuántas veces `costoReal` podría moverse (D6).
3. **Confirmar en el archivo real** que `tx.cierreDetail.createMany` vive dentro de
   `CierreDiaRepository.crearCierre` —o sea, que la fila se escribe **al SOLICITAR**— y que no hay
   ningún otro sitio en `lib/` que la escriba.

**Hecho cuando:** los números están en `progress/impl_415.md` con su consulta al lado, y el punto 3
está confirmado **citando archivo y línea**. **Si el punto 3 saliera al revés** —si la fila sólo
naciera al aprobar— hay que decirlo: cambiaría el comentario de D5, no el código. Verificación
humana.

### T0.3 [P] — El coste de consulta ANTES (línea base)

Con el espía `$on("query")` que ya usa `tests/integration/db/gestiones-detalle-api-405.test.ts`,
medir **hoy**, sobre `origin/dev`: cuántas consultas emite el detalle (debería ser 9) y cuántas el
listado con `limit=1` y con `limit=50`. Anotar también el tamaño del cuerpo con `limit=100`.

**Hecho cuando:** los números están en la bitácora. Sin esta línea base, el número de T7 no demuestra
nada. Verificación humana.

---

## T1 — Los tipos públicos (depende de T0; bloquea T2, T3, T4)

1. `lib/types/api-orden.ts`: **dos tipos nuevos**.
   - `ApiZonaDTO { id: string; nombre: string }`, con el comentario que dice: que es la zona **DE LA
     ORDEN** (destino del paquete) y no la del mensajero (R6); que `id` es `zona.id`, estable y
     nunca reasignado (R3); que `nombre` es texto **para mostrar**, del catálogo tal cual, y que
     **puede cambiar: no se agrupa por él** (R4); y **por qué NO se reutiliza `ApiMensajeroDTO`**
     aunque la forma coincida (design §13: dos conceptos distintos que hoy coinciden en estructura;
     fusionarlos haría que un cambio en uno arrastrara al otro en silencio).
   - `ApiOrdenCostoDTO` con EXACTAMENTE `{ flete, iva, comision, ivaComision, fulfillment }`, todos
     `string`, con el comentario que dice: escenario **ENTREGADA** (R15), cadenas money-safe de
     escala 2 (R12), `"0.00"` es un cero afirmado y nunca `null` (R13), y que **no lleva ningún
     campo sumado, ni con el nombre `total` ni con otro** (R11 / design §D4).
2. `ApiOrdenListItemDTO` gana `zona: ApiZonaDTO`, `costoEstimado: ApiOrdenCostoDTO | null` y
   `costoReal: ApiOrdenCostoDTO | null`, cada uno con su comentario. **Declarar la única diferencia
   con `mensajero`:** `zona` **nunca** es `null` porque `orden.zona_id` es NOT NULL.
   `ApiOrdenDetalleDTO` los hereda por el `extends`.
3. **Corregir la cabecera del archivo**: hoy enumera lo que el canal NO publica. Se le añade el
   bloque fechado `⏳ 2026-09-10 (feature 415)` que distingue **la zona del MENSAJERO** (sigue
   excluida) de **la zona de la ORDEN** (se publica). **No se borra la frase anterior.**

**Hecho cuando:** `pnpm run typecheck` pasa y existe `tests/unit/types/api-orden-415-dto.test.ts`
que afirma: que `zona` tiene EXACTAMENTE `["id","nombre"]` (R1) y una tercera clave **no compila**
(`@ts-expect-error`); que el costo tiene EXACTAMENTE
`["comision","flete","fulfillment","iva","ivaComision"]` (R10) y una sexta **no compila** (R11). El
punto 3 es verificación **humana** del reviewer: un comentario reescrito no prueba nada.

---

## T2 [P] — El módulo PURO de costo (depende de T1; bloquea T4)

`lib/utils/api-orden-costo.ts`, **sin Prisma Client, sin repositorios, sin reloj**. **Dos
envoltorios explícitos**, no un parámetro de modo — el hueco de tarifa significa cosas distintas en
cada uno y un booleano lo escondería:

```
costoEstimadoDe(tarifa: TarifaVigente | null, fulfillment: string, entradas) → ApiOrdenCostoDTO | null
costoRealDe(tarifa: TarifaVigente | null, fulfillment: string, entradas)     → ApiOrdenCostoDTO
```

- `costoEstimadoDe` con `tarifa === null` → **`null`** (R22 / D7): «no hay tarifa configurada», y un
  `"0.00"` sería la mentira sobre dinero que la 274 prohíbe en un borde de API.
- `costoRealDe` con `tarifa === null` → **cinco `"0.00"`** (R28 / D8): ese cierre liquidó cero, y el
  cero es **verdad**. Las dos mitades llevan el comentario que explica por qué no es una
  inconsistencia.
- **Cero fórmulas propias** (R16): llaman a `derivarIngresoOrden({ resultado: "entregada", ... })` y
  serializan con `serializarMontoCotizacion`. El `fulfillment` **no** sale de `derivarIngresoOrden`
  (está fuera de la fórmula de liquidación desde 2026-08-19) sino del monto que le pasan.
- Los conceptos **ausentes** del derivado (una orden con `cobraComision: false`) salen como
  `"0.00"`, nunca omitidos (R13).

**No hacer:** multiplicar, dividir o redondear aquí; aceptar `number` en ningún parámetro monetario;
emitir un sexto campo.

**Hecho cuando** (`tests/unit/utils/api-orden-costo.test.ts`), con **todos los importes esperados
escritos a mano** y la aritmética anotada en el test:
- «una tarifa GAM produce los cinco conceptos con los valores X» (R10/R12/R16) — literales a mano;
- «`esCentral: true` elige la columna GAM y `false` la estándar, y los importes difieren» (R20);
- «un distrito con pacto especial usa el monto pactado y no la columna» (R20);
- «`cobraComision: false` deja `comision` e `ivaComision` en `"0.00"`, no ausentes» (R13);
- «`costoEstimadoDe` sin tarifa devuelve `null`; `costoRealDe` sin tarifa devuelve cinco `"0.00"`»
  (R22/R28) — **los dos en el mismo bloque**, para que se lea la asimetría;
- «todo importe casa `/^-?\d+\.\d{2}$/`, sin símbolo ni miles» (R12);
- «el objeto no tiene ninguna clave que sume los cinco, con ningún nombre» (R11);
- una **contraprueba money-safe**: el caso `monto 16618.40 / comisión 3,50 % / IVA 13 %` da
  `657.25` y **no** `657.26` — el céntimo que la 204 midió y que aparece si alguien recalcula sobre
  `number` (R17).

---

## T3 — El repositorio proyecta zona, entradas vivas y congelado (depende de T1 y T0.2)

1. `lib/interfaces/repositories/IOrdenRepository.ts`: `ApiOrdenRow` gana `zona: ApiZonaDTO`
   (**publicable**) y `costeo: ApiOrdenCosteoRow` (**NO publicable**, con el comentario que lo dice
   y la lista de lo que lleva). Tipos nuevos `ApiOrdenCosteoRow` y `ApiOrdenCongeladoRow`.
   `ApiOrdenDetalleRow extends` → los hereda gratis.
2. `lib/repositories/OrdenRepository.ts`:
   - `API_ORDEN_SELECT` → **`apiOrdenSelect(ownerId)`**, y `API_ORDEN_DETALLE_SELECT` →
     `apiOrdenDetalleSelect(ownerId)` que sigue haciendo el spread. El comentario explica que la
     propiedad que la constante garantizaba —listado y detalle no pueden divergir— **se conserva**
     porque los dos pasan por la misma función (design §5.1).
   - Gana `zonaId`, `cobraComision`, `zona: { select: { id: true, nombre: true, esCentral: true } }`
     (`esCentral` va al `costeo`, **no se publica**), `distrito: { select: { zonaEspecial: true } }`
     y la relación `cierreDetalles` con
     `where: { tiendaId: ownerId, cierre: { estado: "aprobado" } }`,
     `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`, `take: 1` y **sólo** las columnas
     congeladas del design §4.
   - **El comentario del `where` del congelado lleva el número medido Y el mecanismo** (design §D5):
     que el filtro por `aprobado` hoy no recorta nada (1.182 de 1.182) **y** que la fila nace al
     SOLICITAR y es inmutable, que es lo que hace que el filtro haga falta igualmente. Sin esa
     segunda mitad, el siguiente lector lo borra por redundante.
   - `toApiOrdenRow` mapea `zona: { id, nombre }`, arma `costeo` con
     `esZonaEspecial: r.distrito?.zonaEspecial === true` (R21), `montoCobrar` como
     **`Decimal.toFixed(2)`** (R17 / D9) y reconstruye la tarifa congelada con **`tarifaDe`** de
     `lib/utils/cierre-detalle.ts` (no se reescribe).
   - **Comentario nuevo** junto a `zona`, distinguiendo la zona de la ORDEN de la del MENSAJERO
     (design §2).
3. **Enmendar** el literal congelado `SELECT_DETALLE_106` de
   `tests/unit/repositories/orden-repository.no-regresion-106.test.ts` con un bloque fechado
   2026-09-10 (415) que diga qué se añade y por qué, **siguiendo el precedente exacto que la 268, la
   404 y la 405 ya dejaron en ese archivo**. El literal **ES** el contrato: se enmienda, no se
   sustituye por una comparación contra la constante de producción.

**No hacer:** tocar el `where` del listado ni el del detalle; proyectar `tiendaId` de la orden,
`provincia`, `canton` ni ninguna columna más de `distrito`; derivar un solo importe aquí; publicar
`zona.esCentral`.

**Hecho cuando** (`tests/unit/repositories/orden-repository.api-lectura.test.ts`):
- el `toEqual` de la fila pública gana `zona` y `costeo` y **sigue siendo igualdad estructural**,
  no `toMatchObject` (R34);
- «el `select` de `cierreDetalles` lleva `tiendaId: ownerId` **y** `cierre.estado: "aprobado"` en su
  `where`, `take: 1` y un `orderBy` de DOS claves» (R26/R27/R33) — se afirma sobre **lo que se le
  pidió a Prisma**, y se deja escrito que eso no prueba el resultado (eso es T7);
- «`zona` sale con `id` y `nombre` del catálogo, sin transformar, y **sin** `esCentral`» (R1/R5);
- «un distrito con `zonaEspecial: null` y una orden **sin** distrito producen los dos
  `esZonaEspecial: false`» (R21);
- «`costeo.montoCobrar` es una CADENA de dos decimales, no el `number` publicado» (R17);
- «el `where` del listado y el del detalle no cambian» (R32) — los asertos ya existentes siguen
  verdes **sin tocarlos**;
- el literal congelado enmendado pasa (R35).

---

## T4 — El service resuelve la tarifa y compone los DTO (depende de T2 y T3)

1. `lib/services/ApiOrdenLecturaService.ts` gana una dependencia por constructor:
   `Pick<ITarifaVigenteRepository, "resolveTarifas">` (DI ligera, igual que `LecturaRepo`).
2. `listar`: tras `repo.listByOwner`, construir los pares **DISTINTOS** `(actor.usuarioId, zonaId)`
   de la página —en orden de primera aparición, como hace `CotizacionOrdenService.paresDistintos`—
   y resolverlos en **UNA** llamada (R24). Con la página vacía, **cero** llamadas.
3. `toListItemDTO` copia `zona` y compone `costoEstimado` / `costoReal` con el módulo de T2.
   `toDetalleDTO` sigue haciendo `...toListItemDTO(row)` y hereda los tres campos sin tocar nada
   propio.

**No hacer:** tocar los controllers; resolver una tarifa por ítem; recomponer un importe aquí;
publicar `costeo`.

**Hecho cuando** (`tests/unit/services/api-orden-lectura-service.test.ts` y `...por-orden-id.test.ts`):
- «el DTO del ítem lleva `zona`, `costoEstimado` y `costoReal`, y **exactamente 13 claves**»
  (R9/R34) — igualdad estructural con los importes **a mano**;
- «`zona` viaja con `{id, nombre}` y nunca es `null`» (R1/R2);
- «una página de 3 órdenes en 2 zonas hace **UNA** llamada a `resolveTarifas`, con los 2 pares
  distintos» (R24);
- «una página vacía **no** llama a `resolveTarifas`» (R24);
- «el par que se pide lleva el `usuarioId` del actor, nunca un `tiendaId` del input» (R32);
- «sin tarifa para el par → `costoEstimado: null`; con congelado sin tarifa → cinco `"0.00"`»
  (R22/R28);
- «`costoReal` es `null` cuando el repo no trajo congelado» (R26);
- «el `fulfillment` de `costoReal` sale del congelado y **difiere** del vigente cuando la tarifa
  cambió» (R29) — el caso medido: `692.00` congelado contra `696.00` vigente, **los dos a mano**;
- «el detalle conserva `evidencias[]` y `gestiones[]` y hereda los tres campos» (R34).

---

## T5 — Los DOS composition roots inyectan de verdad (depende de T4)

`app/api/ordenes/api-key/route.ts` (`buildLecturaService`) y
`app/api/ordenes/api-key/orden/[id]/route.ts` (`buildDetallePorOrdenId`) construyen el
`TarifaVigenteRepository` y **se lo pasan** al service.

**Por qué es una task propia:** en este repo ya se midió que un composition root puede **importar**
algo y no **pasarlo**, dejando el camino muerto con la suite en verde.

**Hecho cuando** (`tests/unit/api/ordenes-api-key-composicion-415.test.ts`, nuevo): «el service que
devuelve cada builder tiene resuelto un `resolveTarifas` y una llamada real produce
`costoEstimado`» — se afirma que **alguien lo PASA**, no que el módulo lo importe. Un `import` sin
uso no puede poner este test verde.

---

## T6 [P] — Los dos bordes HTTP, de punta a punta (depende de T5)

Casos nuevos en `tests/integration/api/ordenes-api-key-listado.route.test.ts` y
`tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts`:

- «cada ítem trae `zona`, `costoEstimado` y `costoReal`» / «el detalle también» (R1/R9);
- «`zona` nunca es `null` y siempre trae las dos claves» (R1/R2);
- «`?zona=GAM`, `?zona_id=…`, `?costoEstimado=…` y `?orden_by=costo` se ignoran: la respuesta y el
  `where` son idénticos a la llamada sin ellos» (R7/R18);
- «una orden de OTRO owner sigue sin aparecer, y su zona y su costo tampoco» (R32);
- «los diez campos publicados y `pagination` no cambian de forma; el orden de las filas entre
  páginas tampoco» (R34);
- «ninguna respuesta contiene `zonaId` suelto, `esCentral`, `tiendaId`, `tarifaId`, `cierreId`,
  `storagePath`, el nombre del bucket ni el texto libre de la gestión» (R5/R18/R35) — **ampliar el
  aserto de exclusión ya existente**, no escribir uno paralelo;
- «`zona.id` NO se acepta como entrada en ningún endpoint del canal» (R35) — se comprueba sobre el
  resolutor de `{id}`, que sólo casa por `num_guia` o `num_remision`;
- «401/403/404/422 conservan su código y su criterio» (R36).

**Hecho cuando:** los casos pasan y los tests de aislamiento ya existentes
(`ordenes-api-key-filtros-scope-ajeno.route.test.ts`,
`ordenes-api-key-tienda-destino-aislamiento.route.test.ts`) siguen verdes **sin tocarlos**.

---

## T7 — Contra Postgres real: el SQL, el congelado y el COSTE (depende de T5) — **NO OPCIONAL**

`tests/integration/db/costo-y-zona-api-415.test.ts` (nuevo), con el mismo molde que
`gestiones-detalle-api-405.test.ts`: base real, espía `$on("query")`, siembra explícita.

**Esto existe porque los dobles no ven el SQL.** El `where` del congelado, el `take: 1`, el
`orderBy` y el filtro por estado del cierre **sólo los ejecuta Postgres**.

Casos, todos con siembra propia y **afirmando primero que sembró**:

1. «una orden con cierre **aprobado** trae `costoReal` con los importes X» (R25) — a mano;
2. «una orden con cierre **solicitado** trae `costoReal: null`» (R26) — **este caso es el que
   demuestra que el filtro de D5 hace algo**: hoy no existe en producción, y por eso se siembra;
3. «una orden con cierre **rechazado** trae `costoReal: null`, y su fila congelada sigue existiendo»
   (R26) — las dos mitades: el filtro funciona **y** la fila no se borró;
4. «una orden con **DOS** cierres aprobados trae el de la fila **más reciente**, y repetir la
   lectura devuelve lo mismo» (R27) — las dos filas con tarifas **distintas**, para que elegir mal
   dé un importe distinto;
5. «una orden **sin** ninguna fila congelada trae `costoReal: null`» (R26) — **es el 28 %**;
6. «una fila congelada de OTRA tienda no alimenta el `costoReal` del dueño actual» (R33);
7. «una fila congelada con `tarifa_id IS NULL` trae los cinco `"0.00"`» (R28);
8. «una fila congelada con `tarifa_fulfillment IS NULL` trae `fulfillment: "0.00"`» (R29);
9. «`zona` es el `{id, nombre}` VIVO del catálogo aunque el congelado diga otro» (R1, design §8);
10. **el coste**: el detalle emite EXACTAMENTE **N** consultas y son **estas**, por nombre de tabla
    (literal congelado, ampliando `CONSULTAS_DEL_DETALLE`); y el listado emite EXACTAMENTE **M**, y
    **M no cambia entre `limit=1` y `limit=50`** ni entre una página de 1 zona y otra de 3
    (R8/R24/R31).

**Hecho cuando:** los diez casos pasan; `N` y `M` están **medidos** y escritos en la bitácora junto a
la línea base de T0.3; y el fichero **no** contiene ningún `if (!algo) return;` — la ausencia de
datos debe hacer **fallar** el test, no reportarlo `passed`. **Revisar los `skipped` del gate**: sin
`DATABASE_URL` este archivo se salta entero y el gate sale «OK» igual.

---

## T8 [P] — La QUINTA superficie ante el hueco de tarifa (depende de T4)

`tests/integration/asimetria-sin-tarifa.test.ts` declara en su cabecera que ante **el mismo** hueco
—ningún `tarifas` aplica al par (tienda, zona)— las **cuatro** superficies responden distinto a
propósito. Esta ficha añade la quinta:

> · Lectura por API key (listado/detalle) → `costoEstimado: null`. **No bloquea**, y no puede: la
> orden existe y hay que devolverla. No es `"0.00"` porque eso sería la mentira sobre dinero que la
> 274 prohíbe en un borde de API.

1. Ampliar el bloque de cabecera con esa quinta línea y su porqué.
2. Añadir el caso, corriendo contra el **MISMO** `TABLA_TARIFAS` y el **MISMO** doble de
   `prisma.tarifa.findMany` que las otras cuatro, con el `TarifaVigenteRepository` **real**.
3. Añadir la **contraprueba**: con la fila que sí aplica, la quinta superficie devuelve los cinco
   conceptos — así se descarta que el `null` salga de un montaje roto.

**Hecho cuando:** las **cinco** superficies pasan en el mismo archivo, con la contraprueba, y la
cabecera describe las cinco.

---

## T9 [P] — Guardia: una sola forma y una lista blanca (depende de T4)

`tests/unit/guards/costo-orden-forma-unica.guardia.test.ts` (molde:
`mensajero-forma-unica.guardia.test.ts` y `gestiones-detalle-lista-blanca.guardia.test.ts`):

1. **ESTRUCTURA:** `ApiZonaDTO` y `ApiOrdenCostoDTO` se declaran **UNA sola vez** cada uno en todo
   `lib/`. El grafo de imports no puede detectar «cuántas declaraciones hay», que es por lo que vive
   en una guardia.
2. **LISTA BLANCA:** el conjunto EXACTO de claves del ítem publicado es de **trece**, el de `zona`
   de **dos** y el del objeto de costo de **cinco**. Una clave que se cuele por un spread cae aquí.
3. **COMPORTAMIENTO:** listado y detalle, sobre la MISMA orden, producen el MISMO fragmento
   serializado para los tres campos (R14).
4. **AUTO-PRUEBA del detector:** el mismo escaneo sobre un texto **mutado en memoria** debe
   encontrar la violación. Sin esto, un detector roto queda verde para siempre.

**Además, revisar —no tocar a ciegas— `mensajero-forma-unica.guardia.test.ts`:** vigila que
`ApiMensajeroDTO` se declare una sola vez. `ApiZonaDTO` es un tipo **distinto** con la **misma
forma**; si ese detector contara por forma y no por nombre, caería en falso. Si cae, se acota con su
motivo escrito al lado (design §12).

**Hecho cuando:** los cuatro bloques pasan, el cuarto falla si se rompe el detector a propósito, y
la guardia de la 404 sigue verde con su alcance intacto o acotado con motivo.

---

## T10 — Contrato publicado: OpenAPI + espejo `.yaml` (depende de T4)

1. `lib/api/openapi-spec.ts`:
   - **Schema nuevo `Zona`**: `{ id, nombre }`, las dos en `required`, `additionalProperties:
     false`. Su `description` dice que es la zona **de la orden** (destino del paquete) —no la del
     mensajero—, y lleva **la misma instrucción y el mismo tono que ya usa `mensajero`**: agrupá por
     `id`, **nunca** por `nombre`, que es texto para mostrar y puede corregirse (R38). Dice también
     que no se puede filtrar ni ordenar por él (R7).
   - **Schema nuevo `OrdenCosto`**: cinco propiedades `string`, las cinco en `required`,
     `additionalProperties: false`. Su `description` dice: escenario **ENTREGADA** (R15), dialecto
     money-safe crudo de escala 2 (R12), `"0.00"` es un cero afirmado, y **no hay ningún campo
     sumado, ni `total` ni equivalente** (R11).
   - `OrdenListItem` gana `zona` (`$ref`, **no nullable**), `costoEstimado` y `costoReal` (`$ref` al
     schema nuevo **o `null`**) en `properties` **y en `required`** (R9/R37).
   - La `description` de `costoEstimado` lleva, con todas las letras, **«mientras `costoReal` sea
     `null`, este importe puede cambiar: se calcula con la tarifa de hoy»** (R23), y qué significa
     su `null` (no hay tarifa configurada para tu tienda en esa zona; **no** es gratis).
   - La `description` de `costoReal` dice: qué significa su `null`; que es la tarifa **congelada** al
     cerrar; **con las palabras de R15**, que es «lo que se congeló al cerrar» y **no** «la línea que
     entró en tu wallet»; y el único caso en que puede moverse (segundo cierre aprobado, D6).
   - La `description` de `OrdenListItem.mensajero` gana la cláusula que distingue **la zona del
     mensajero** (sigue excluida) del campo `zona` de la orden (R39). **La palabra no se retira de
     la lista de exclusión.**
   - `OrdenDetalle` no se toca (hereda por `allOf`).
2. `docs/api/api-key-openapi.yaml`: el mismo cambio, palabra por palabra.

**Hecho cuando** (`tests/unit/api/openapi-415-zona-y-costo.test.ts`, nuevo):
- «`OrdenListItem` declara las tres propiedades y las tres están en `required`» (R37);
- «`Zona` declara exactamente dos propiedades, las dos requeridas, `additionalProperties: false`, y
  tiene la MISMA forma que el schema `Mensajero`» — comparación clave a clave y tipo a tipo, igual
  que la 405 hizo con `Mensajero` (R38);
- «`OrdenCosto` declara exactamente cinco propiedades, todas requeridas, `additionalProperties:
  false`, y **ninguna suma los cinco**» (R10/R11);
- «`zona` **no** admite `null` y `costoEstimado`/`costoReal` **sí**» (R2/R9);
- «las diez propiedades anteriores del ítem conservan nombre, tipo y `required`» (R34);
- «ninguna `description` publicada afirma que el canal no publica ninguna zona» (R39);
- «la `description` de `costoEstimado` contiene la advertencia de que puede cambiar» (R23);
- «la `description` de `costoReal` contiene la frase de que no es la línea de la wallet» (R15).

La equivalencia `.ts` ↔ `.yaml` es **verificación humana del reviewer** (no hay comparador
automático entre los dos artefactos): se revisa el diff lado a lado.

---

## T11 [P] — El manual deja de mentir en el otro sentido (depende de T10)

`docs/api/manual-metricas-por-mensajero.md`:

1. **Reescribir** el bloque «Corrección del 2026-09-10» —que hoy dice «hoy no publicamos la zona por
   ningún endpoint»— por uno fechado que diga: aquella instrucción era falsa **cuando se escribió**,
   y **desde esta fecha es cierta**; el ítem publica `zona`. **No se borra el rastro** de que hubo
   una corrección (R40).
2. Actualizar la tabla «qué gana cada superficie» y el ejemplo del ítem del listado.
3. Extender la regla nº 1 («agrupá por `id`, nunca por `nombre`») para que cubra **las dos**
   entidades con nombre del payload, con una sola frase para las dos (R38).
4. Caso de uso nuevo: **«Margen por paquete y por zona»**, con los dos campos, cuándo cada uno es
   `null`, la advertencia de que el estimado se mueve y la del escenario de entrega.
5. La sección «Qué NO se publica de un mensajero» conserva la palabra «zona» y gana la aclaración de
   que se refiere a la **suya**.

**Hecho cuando:** verificación **humana** del reviewer sobre el diff. **No se acepta ningún criterio
de `grep`** sobre estos textos.

---

## T12 — Aviso a integradores: UNA entrada de CHANGELOG (BLOQUEA LA RELEASE, no el código)

`docs/api/CHANGELOG.md`, entrada fechada **antes de la release**, con la convención del propio
archivo (el texto **es** el aviso: se copia y se manda). **UNA sola entrada para las dos partes**
(R40). Debe decir, como mínimo:

- es **aditiva**: nada de lo que hoy funciona deja de funcionar; el webhook y la cotización **no
  cambian en absoluto**;
- `zona`: que es `{ id, nombre }` —**la misma forma que `mensajero`, y con la misma regla: agrupá
  por `id`, nunca por `nombre`**—, que es la zona **del envío** y no la del mensajero, que **nunca
  es `null`** (a diferencia de `mensajero`), la lista de los ocho valores actuales, y que no se
  puede filtrar por ella;
- `costoEstimado` y `costoReal`: la forma, los cinco conceptos, el dialecto money-safe, y **por qué
  son dos** — con el ejemplo medido del fulfillment (692,00 → 696,00 en 1 de cada 6 detalles);
- **la frase que no puede faltar:** mientras `costoReal` sea `null`, `costoEstimado` puede moverse;
  cuando `costoReal` llega, es lo que se congeló al cerrar;
- **la segunda frase que no puede faltar:** `costoReal` es **lo que se congeló al cerrar**, no la
  línea que entró en tu wallet; los dos campos son el escenario de **ENTREGA**, y un rechazo cobra
  el flete de devolución, que está en la cotización (R15);
- qué significa cada `null`, y que `costoEstimado: null` **no** significa envío gratis;
- que **no hay campo de total**: los cinco conceptos se suman del lado del integrador;
- el aviso a clientes con **validación estricta de esquema** (`additionalProperties: false`) —
  **ya pasó con `mensajero`**, así que se repite con el mismo tono.

**Hecho cuando:** la entrada está escrita, **commiteada** y la bitácora de la ficha enlaza a ella.
Verificación humana. **No bloquea el código; bloquea la release.**

---

## T13 — Gate (depende de todo lo anterior)

El diff toca **nombres de dinero** (`tarifa`, `cierre`, `comision`, `flete`) en `lib/`, así que
**`--rapido` se niega solo** y manda al completo: eso es un `fail`, no un aviso. Correr `./init.sh`
**completo**, con el log escrito a archivo y `INIT_EXIT=$?` **dentro** del log.

**Hecho cuando:** typecheck, lint, la suite entera y **todas** las guardias en verde contra el
baseline; `INIT_EXIT=0` visible **dentro** del log; y **ningún `skipped` inesperado** en los
archivos que esta ficha toca — en particular **T7 tiene que haber EJECUTADO** (sin `DATABASE_URL` se
salta entero y el gate sale «OK» igual). **Nunca en paralelo con un subagente que esté mutando el
árbol.**

---

## Mapa de trazabilidad `R<n> → test`

| R | Descripción corta | Test (archivo / caso) |
|---|---|---|
| R1 | `zona` = objeto con exactamente `id` y `nombre` | T1 `api-orden-415-dto.test.ts` + T4 "zona viaja con {id,nombre}" + T7/9 |
| R2 | `zona` siempre presente, nunca `null` | T6 "zona nunca es null y trae las dos claves" + T10 "`zona` no admite null" |
| R3 | `zona.id` estable, nunca reasignado | T7/9 "es el `{id,nombre}` VIVO del catálogo" + T10 (description) |
| R4 | `zona.nombre` del catálogo, texto para mostrar | T3 "zona sale sin transformar" + T10 (description) |
| R5 | Sin atributos derivados de la zona | T3 "sin `esCentral`" + T6 aserto de exclusión + T9 lista blanca |
| R6 | Es la zona de la ORDEN, no la del mensajero | T1.3 / T3 / T10 (verificación humana del reviewer sobre los cuatro textos) |
| R7 | No filtra ni ordena por zona | T6 "`?zona=` y `?zona_id=` se ignoran: mismo where y misma respuesta" |
| R8 | Zona sin consulta por ítem | T7/10 "M no cambia entre limit=1 y limit=50" |
| R9 | Las dos claves de costo, siempre presentes | T4 "el DTO tiene exactamente 13 claves" + T10 "las tres en `required`" |
| R10 | Objeto de costo = 5 claves exactas | T1 + T2 "los cinco conceptos con los valores X" + T10 |
| R11 | Ningún campo sumado, con ningún nombre | T1 (`@ts-expect-error` de la sexta) + T2 "no hay clave que sume" + T10 |
| R12 | Importes como cadena money-safe escala 2 | T2 "todo importe casa `/^-?\d+\.\d{2}$/`" |
| R13 | Concepto que no aplica = `"0.00"`, nunca `null` | T2 "`cobraComision: false` deja comisión en 0.00, no ausente" |
| R14 | Misma forma en los dos campos | T9 "listado y detalle producen el mismo fragmento" |
| R15 | Escenario ENTREGADA, y se dice con esas palabras | T2 (deriva con `resultado: "entregada"`) + T10 "la description contiene la frase de la wallet" |
| R16 | Una sola fórmula, la que ya liquida | T2 "los cinco conceptos con los valores X" (literales a mano) |
| R17 | Nada de coma flotante en el cálculo | T2 contraprueba `657.25` vs `657.26` + T3 "`costeo.montoCobrar` es cadena" |
| R18 | No filtra por costo ni publica procedencia interna | T6 "`?costoEstimado=` se ignora" + aserto de exclusión (`tarifaId`, `cierreId`) |
| R19 | Estimado = tarifa vigente por la cascada única | T4 "una llamada a `resolveTarifas` con los pares distintos" |
| R20 | Entradas VIVAS de la orden | T2 "esCentral elige columna" + "pacto especial manda" |
| R21 | Sin distrito / `null` ⇒ no especial | T3 "distrito `null` y orden sin distrito dan `false`" |
| R22 | Sin tarifa ⇒ `costoEstimado: null` | T2 (bloque de la asimetría) + T4 + **T8** (la quinta superficie, con contraprueba) |
| R23 | El estimado puede moverse, y el contrato lo dice | T10 "la description contiene la advertencia" |
| R24 | Una consulta de tarifas por página | T4 "3 órdenes / 2 zonas ⇒ 1 llamada; página vacía ⇒ 0" + T7/10 |
| R25 | Real = tarifa y entradas CONGELADAS | T7/1 "cierre aprobado trae los importes X" |
| R26 | Sólo cierre `aprobado`, filtro EXPLÍCITO | T7/2 (solicitado), T7/3 (rechazado + la fila sigue ahí), T7/5 (sin fila) + T3 (el `where` pedido) |
| R27 | Con varias filas, gana la MÁS RECIENTE, determinista | T7/4 "dos cierres aprobados con tarifas distintas: gana la más reciente, y repite" |
| R28 | Congelado sin tarifa ⇒ cinco `"0.00"` | T7/7 + T2 (bloque de la asimetría, junto a R22) |
| R29 | `fulfillment` del congelado; sin congelar ⇒ `"0.00"` | T7/8 + T4 "692.00 congelado contra 696.00 vigente" |
| R30 | Sólo lectura, nunca escribe dinero | La guardia `cierre-detail-inmutable` existente sigue verde + T13 |
| R31 | Congelado sin consulta por ítem | T7/10 "M no depende del número de ítems ni de cierres" |
| R32 | Sólo órdenes propias; ajena = 404 | T6 "una orden de otro owner sigue sin aparecer" + T4 "el par lleva el actor" |
| R33 | El congelado se acota por su `tienda_id` CONGELADO | T7/6 "una fila de OTRA tienda no alimenta el costoReal" + T3 (el `where` pedido) |
| R34 | Los diez campos + paginación + evidencias + gestiones intactos | T3 `toEqual` estructural + T4 "el detalle conserva evidencias y gestiones" + T6 + T10 |
| R35 | Ningún id interno nuevo salvo `zona.id`, que no se acepta como entrada | T3 literal `SELECT_DETALLE_106` enmendado + T6 aserto de exclusión + T6 "`zona.id` no resuelve `{id}`" |
| R36 | Códigos de estado sin cambios | T6 "401/403/404/422 conservan código y criterio" |
| R37 | El contrato declara los tres campos | T10 `openapi-415-zona-y-costo.test.ts` |
| R38 | Agrupá por `id`: misma forma y misma regla que `mensajero` | T10 "`Zona` tiene la MISMA forma que `Mensajero`, clave a clave" + T11 (regla nº 1 del manual, humana) |
| R39 | La «zona» excluida es la del mensajero | T10 "ninguna description afirma que no se publica ninguna zona" |
| R40 | UNA entrada de CHANGELOG + manual reescrito, con el aviso de esquema estricto | T12 y T11 (verificación humana; T12 bloquea la release) |

---

## Orden de ejecución y paralelismo

```
T0.1 ──┬── T0.2 ───┐
       └── T0.3 [P]│
                   │
T1 ────┬── T2 [P] ─┴──┐
       └── T3 ────────┴── T4 ──┬── T5 ──┬── T6 [P]
                               │        └── T7   (base real; NO opcional)
                               ├── T8 [P]
                               ├── T9 [P]
                               └── T10 ── T11 [P]

T12 (en cualquier momento tras T10; bloquea la RELEASE, no el código)
T13 (al final, `./init.sh` COMPLETO, y NUNCA en paralelo con un subagente que mute el árbol)
```

**T0.2 bloquea T3** a propósito, aunque la cobertura ya esté medida y no recorte nada: lo que T0.2
tiene que dejar confirmado es **el mecanismo** —que la fila nace al SOLICITAR y es inmutable—,
porque es lo que hay que escribir junto al `where` para que nadie borre el filtro por redundante.
