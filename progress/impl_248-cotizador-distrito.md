# Feature 248 — Cotizador de envío por distrito · bitácora de implementación

Rama: `feature/248-cotizador-distrito` (worktree `C:/w248`, nacida de `origin/dev` en 5deaa9a4).
Spec: `specs/248-cotizador-distrito/` — 40 requisitos EARS, 16 decisiones, 32 tareas.
Gate humano del spec: PASADO (2026-08-20), sin preguntas abiertas.

**Estado: 30 de 32 tareas cerradas (T1-T7 completos + T8.1).** Quedan T8.2 y T8.3, que son cierre y
bookkeeping: T8.2 (gate corrido, ver §1) y T8.3 (el PR, que hace el leader).
La bitácora se llama `impl_248-cotizador-distrito.md` y no `impl_248.md` como decía T8.1, por
petición explícita del encargo.

---

## 1. Baseline y resultado

| Medida | Baseline (dev, misma sesión) | Al cerrar | Delta |
| --- | --- | --- | --- |
| `pnpm run typecheck` | LIMPIO, cero errores | LIMPIO, cero errores | **0** |
| `pnpm run lint` | 0 errores, 97 warnings | 0 errores, 97 warnings | **0** |

`./init.sh` completo (no `--rapido`: se toca contrato publicado, `middleware.ts` y el camino que
crea órdenes). Salida real:

```
typecheck paso
97 problems (0 errors, 97 warnings)
lint paso
-> pnpm run test
 Test Files  5 failed | 1239 passed (1244)
      Tests  11 failed | 16159 passed | 26 skipped (16196)
```

**La corrida NO está degradada:** cero «unhandled errors» de workers y 1244 archivos, así que el
conteo de rojos es fiable (la trampa conocida es una corrida que omite archivos enteros y parece
casi verde).

### Los 11 rojos son ambientales y están probados como tales

Los 5 archivos rojos están **todos** en `tests/integration/db/`, que hablan con el Postgres local:

```
tests/integration/db/analitica-operativa-equivalencia.test.ts   (1)
tests/integration/db/analytics-daily-backfill.test.ts           (2)
tests/integration/db/analytics-daily-job.test.ts                (4)
tests/integration/db/confirmacion-fisica-migration.test.ts      (3)
tests/integration/db/novedades-predicado-sql-real.test.ts       (1)
```

Los 11 comparten una única causa raíz, y la dice el propio error:

```
P2007 / 22P02 InvalidInputValue
la sintaxis de entrada no es valida para el enum orden_historial_origen_tipo:
  «gestion_tienda_ayuda»      (6 casos)
  «solicitud_ayuda_tienda»    (1 caso)
AssertionError: la migracion no esta aplicada en esta base: expected [] to have a length of 1
```

Esos dos valores de enum los introducen **migraciones que ya están en el repo y en `dev`**, de las
features 235 y 237:

- `db/migrations/20260819150000_orden_historial_origen_ayuda_tienda/`
- `db/migrations/20260820120000_orden_historial_origen_gestion_tienda_ayuda/`

y **no están aplicadas al Postgres local de esta máquina**. Uno de los tests lo afirma literalmente
(«la migracion no esta aplicada en esta base»): es un enunciado sobre la BASE, no sobre el código.

La prueba de que no son de la 248: **esta feature no toca un solo archivo de `db/`**.
`git status --short -- db/` sale **vacío** — ni migración nueva ni una línea de `schema.prisma`.
Es exactamente lo que exige R39, y hay una guardia propia que lo mide (T7.4).

**Remedio, deliberadamente NO ejecutado:** aplicar esas dos migraciones al Postgres local dejaría el
gate en verde. No lo hice porque el `.env` de este worktree apunta a una base que puede ser la misma
que usa la OTRA SESIÓN viva en el checkout principal, y migrar por mi cuenta una base compartida es
justo el tipo de daño cruzado que este repo ya pagó una vez. Queda como decisión del leader.

**Veredicto del gate:** typecheck y lint en el baseline exacto; suite verde salvo 11 rojos
preexistentes de entorno, ninguno atribuible a la 248.

---

## 2. Lo que exigía el encargo, y cómo quedó

### T1.4 — no regresión bloqueante (R36)

**No se modificó ni un solo test preexistente.** El refactor de `resolveGeo` (el camino que CREA
órdenes) se verificó contra las suites intactas:

| Suite | Resultado |
| --- | --- |
| carga masiva + carga por API + listado por API key (7 archivos) | 191 tests, verdes |
| repositorio y consumidores de `findDistritosByCantonIds` (5 archivos) | 128 tests, verdes |
| cierre (22 archivos) | 424 tests, verdes |
| cierres/bodega (15 archivos) | 237 tests, verdes |

### Las seis firmas

1. **`/cotizador` responde SOLO COBERTURA.** Ni un importe, y no se puede derivar uno ni por
   diferencia: el grafo de imports de la superficie pública (cierre transitivo **medido: 20
   archivos**) no alcanza `ingreso-ordenex`, `TarifaVigentePorTienda` ni `prisma.tarifa`. Guardia
   con contraprueba **transitiva** (se ensucia una hoja del grafo con un especificador que no
   contiene ninguna palabra prohibida y la guardia cae a dos saltos).
2. **Costos y total solo en el canal por API key**, con la tienda tomada de `actor.usuarioId` y
   jamás del cuerpo ni de la query.
3. **Dos escenarios** en la misma respuesta: entregada y devuelta.
4. **Neto de DEVUELTA negativo**, menos (flete_devolucion + IVA), obtenido **negando** el derivado
   (`.neg()`), sin recalcular nada y **sin llamar a `pagoTiendaOrdenex` en esa rama** (afirmado con
   espía real). Queda comentado en el código y publicado en el contrato que es un número **del
   cotizador que no existe en el cierre** y que no debe cuadrarse contra ninguna línea de cierre.
5. **`cobra_comision`**: opcional, default `true` (el caso caro). Con `false`, el escenario
   entregada **omite** `comisionCod` e `ivaComisionCod` — no los emite en `"0.00"`, respetando que
   `derivarIngresoOrden` los deja ausentes.
6. **`cantidad`** 1..1000 (tope en `lib/config/cotizador.ts`, no hardcodeado), default 1. El total
   es el **unitario ya redondeado por N**. Caso medido en test: monto 16 618,40 da comisión 581,644
   que redondea a 581,64; por 3 da `"1744.92"`, con `not.toBe("1744.93")`, que es lo que daría
   redondear al final.

### Invariantes

- **La aritmética no se reimplementa.** `CotizadorService` llama a `derivarIngresoOrden`,
  `costosListadoOrden` y `pagoTiendaOrdenex`. Las únicas operaciones propias son tres helpers
  documentados construidos **sobre** el derivado ya redondeado: `negarImporte` (`.neg()`),
  `porCantidad` (`.mul(cantidad)`) y `sumarImportes` (`.plus`). Hay guardia estática que caza
  `.div`, division por 100, factores tipo 1.13, `parseFloat`, `Number(`, `Math.`,
  `toDecimalPlaces`, `ROUND_` y operadores aritméticos entre expresiones, con contraprueba de 8
  familias.
- **Money-safe:** todo importe es STRING de escala 2 desde `Prisma.Decimal` con ROUND_HALF_UP,
  incluido el negativo. Test que recorre las 20 hojas del subárbol `escenarios`. Negar cero da
  `"0.00"`, nunca `"-0.00"`.
- **Paridad con el cierre (R24):** 16 casos (4 montos por esCentral por cobraComision) más los dos
  casos MEDIDOS que documenta `ingreso-ordenex.ts` (14 900,00 da 521,50/67,80; 16 618,40 da
  581,64/75,61), dígito a dígito contra `agregarIngresosPorConcepto`.
- **Cobertura** sale de la N:M `zona_distrito`; no se inventó ninguna columna escalar.
- **`tarifas.status` NO se arregló** (deuda heredada de la 69) y **`tarifas.fulfillment` NO entró**.
  Ambas cosas quedan declaradas en el contrato publicado.

### Las dos guardias congeladas: re-firmadas, no «arregladas»

- `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` — `/cotizador` añadido en su **posición
  real** dentro de `LISTAS_ESPERADAS.PUBLIC_ROUTES`, con comentario que nombra la 248 / R38 / firma
  3 y marca la re-firma como deliberada. La contraprueba del archivo sigue intacta. **No se tocó
  `SELF_AUTH_ROUTES`**: ya contenía el prefijo `/api/ordenes/api-key`.
- `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` — de 7 a **8** paths, en TS y en el
  `.yaml`, mismo orden. La guardia **no se debilitó**: sigue con `toHaveLength` + `toEqual` (y ahora
  el caso del yaml también lleva `toHaveLength(8)`, que antes no tenía). Comprobado por mutación: un
  path fantasma la pone roja.

### Contrato publicado (tres artefactos)

`lib/api/openapi-spec.ts` (fuente de verdad) + `docs/api/api-key-openapi.yaml` (espejo, verificado
**deep-equal** contra el objeto TS con js-yaml) + `docs/api/ordenex-api-key.postman_collection.json`
(carpeta «8 · Cotización de envío por distrito», 6 requests, Bearer heredado de la auth de la
colección; la carpeta de autenticación se renumeró a 9).

Los cinco avisos obligatorios quedaron escritos: R22 (neto de devuelta no existe en el cierre),
R28 (supuesto de homogeneidad), R31 (deuda de `status`), R32 (`fulfillment` no se cotiza) y R34
(`cobra_comision` con default `true`).

---

## 3. Archivos

### Creados (24)

Producción:
- `lib/utils/resolucion-geografica.ts` — util PURO compartido (D12/R35)
- `lib/types/cotizador.ts`, `lib/config/cotizador.ts`
- `lib/interfaces/repositories/ICoberturaDistritoRepository.ts`, `lib/repositories/CoberturaDistritoRepository.ts`
- `lib/interfaces/services/ICoberturaService.ts`, `lib/services/CoberturaService.ts`
- `lib/interfaces/services/ICotizadorService.ts`, `lib/services/CotizadorService.ts`
- `lib/actions/cobertura-publica.ts`
- `app/cotizador/page.tsx`, `app/cotizador/CotizadorForm.tsx`
- `app/api/ordenes/api-key/cotizar/route.ts`

Tests:
- `tests/unit/utils/resolucion-geografica.test.ts`
- `tests/unit/services/CoberturaService.test.ts`
- `tests/unit/services/CotizadorService.test.ts`
- `tests/unit/services/CotizadorService.paridad-cierre.test.ts`
- `tests/unit/services/CotizadorService.money-safe.test.ts`
- `tests/unit/actions/cobertura-publica.test.ts`
- `tests/unit/auth/middleware.cotizador-publico.test.ts`
- `tests/unit/components/CotizadorForm.test.tsx`
- `tests/integration/api/cotizar-api-key.test.ts`
- `tests/unit/api/openapi-248-cotizador.test.ts`

Guardias nuevas (4):
- `tests/unit/guards/cotizador-publico-sin-dinero.guardia.test.ts` (R6 + R10)
- `tests/unit/guards/cotizador-sin-aritmetica-propia.guardia.test.ts` (R23)
- `tests/unit/guards/zona-de-distrito-definicion-unica.guardia.test.ts` (R35)
- `tests/unit/guards/cotizador-sin-migracion.guardia.test.ts` (R39)

Ninguna mira `git diff` contra `origin/dev`: miden la propiedad, así que no caducan al mergear.
Las cuatro llevan control de no-vacuidad y contraprueba.

### Modificados (9)

- `lib/services/BulkOrdenService.ts` — delega en el util; ya no contiene matching por nombre
- `lib/repositories/OrdenRepository.ts` — `findDistritosByCantonIds` usa `zonaDeDistrito`
- `middleware.ts` — `/cotizador` en `PUBLIC_ROUTES` (nada más)
- `lib/api/openapi-spec.ts`, `docs/api/api-key-openapi.yaml`, `docs/api/ordenex-api-key.postman_collection.json`
- `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` y
  `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` (las dos re-firmas)
- `specs/248-cotizador-distrito/tasks.md` (bookkeeping de casillas)

**`db/` sin tocar.** Cero migraciones, cero cambios de esquema.

---

## 4. Mapa `R<n> -> test` (40 de 40)

| R | Test (archivo :: caso) |
| --- | --- |
| R1 | `tests/unit/auth/middleware.cotizador-publico.test.ts` :: «sirve /cotizador sin cookie de sesión, sin redirigir a /login» |
| R2 | `tests/unit/services/CoberturaService.test.ts` :: «distrito con UNA zona responde cubierto con el nombre de la zona» |
| R3 | `tests/unit/services/CoberturaService.test.ts` :: «distrito sin filas en zona_distrito responde sin cobertura y sin zona» |
| R4 | `tests/unit/services/CoberturaService.test.ts` :: «distrito con DOS zonas responde no determinado y no nombra ninguna» |
| R5 | `tests/unit/actions/cobertura-publica.test.ts` :: «entrada no resoluble devuelve validation_error por campo sin consultar tarifas» |
| R6 | `tests/unit/guards/cotizador-publico-sin-dinero.guardia.test.ts` :: «las claves del DTO público son EXACTAMENTE las firmadas» + contraprueba |
| R7 | `tests/unit/services/CoberturaService.test.ts` :: «la salida pública no expone esCentral ni ids de zona/tarifa/tienda» |
| R8 | `tests/unit/actions/cobertura-publica.test.ts` :: «un tiendaId en la entrada se ignora y no amplía la respuesta» |
| R9 | `tests/unit/components/CotizadorForm.test.tsx` :: «la cascada acota cantones a la provincia y distritos al cantón» |
| R10 | `tests/unit/guards/cotizador-publico-sin-dinero.guardia.test.ts` :: «el grafo de imports del público no alcanza ingreso-ordenex ni el resolver de tarifas» + contraprueba transitiva |
| R11 | `tests/unit/components/CotizadorForm.test.tsx` :: «la página declara que ahí se consulta cobertura y que el costeo vive en el canal por API key» |
| R12 | `tests/integration/api/cotizar-api-key.test.ts` :: «devuelve 401 cuando falta el Bearer o la key no existe» |
| R13 | `tests/integration/api/cotizar-api-key.test.ts` :: «devuelve 403 cuando el usuario dedicado de la key no está activo» |
| R14 | `tests/integration/api/cotizar-api-key.test.ts` :: «devuelve 422 con fieldErrors antes de consultar cobertura o tarifa» |
| R15 | `tests/unit/services/CotizadorService.test.ts` :: «la tarifa se resuelve por actor.usuarioId y un tiendaId del cuerpo se ignora» |
| R16 | `tests/integration/api/cotizar-api-key.test.ts` :: «distrito con 0 o >1 zonas responde 200 con cobertura y costos null, sin tocar tarifas» |
| R17 | `tests/integration/api/cotizar-api-key.test.ts` :: «ni la key ni su hash aparecen en logs ni en el cuerpo de error» |
| R18 | `tests/unit/services/CotizadorService.test.ts` :: «el escenario entregada devuelve flete, IVA del flete, comisión COD e IVA de la comisión por separado» |
| R19 | `tests/unit/services/CotizadorService.test.ts` :: «el neto de entregada es el monto COD menos los dos bloques facturados» |
| R20 | `tests/unit/services/CotizadorService.test.ts` :: «el escenario devuelta trae flete de devolución y su IVA, sin comisión ni COD» |
| R21 | `tests/unit/services/CotizadorService.test.ts` :: «el neto de devuelta es el negativo del flete de devolución más su IVA, sin recalcular importes ni llamar a pagoTiendaOrdenex» |
| R22 | `tests/unit/api/openapi-248-cotizador.test.ts` :: «el contrato advierte que el neto de devuelta no existe en el cierre» |
| R23 | `tests/unit/guards/cotizador-sin-aritmetica-propia.guardia.test.ts` :: «CotizadorService no contiene fórmulas monetarias propias y llama a derivarIngresoOrden» |
| R24 | `tests/unit/services/CotizadorService.paridad-cierre.test.ts` :: «para la misma entrada los conceptos coinciden dígito a dígito con agregarIngresosPorConcepto» |
| R25 | `tests/unit/services/CotizadorService.test.ts` :: «cantidad ausente vale 1» |
| R26 | `tests/unit/services/CotizadorService.test.ts` :: «el total es el unitario YA REDONDEADO por N (caso medido donde redondear al final daría otro número), incluido el neto negativo» |
| R27 | `tests/integration/api/cotizar-api-key.test.ts` :: «acepta 1 y 1000, y devuelve 422 con 0, 1001, negativa o decimal, sin cotizar» |
| R28 | `tests/unit/services/CotizadorService.test.ts` :: «la respuesta declara el supuesto de distrito y monto COD compartidos» |
| R29 | `tests/unit/services/CotizadorService.money-safe.test.ts` :: «todo importe es string de escala 2 con ROUND_HALF_UP, incluido el negativo, y ningún number cruza la salida» |
| R30 | `tests/unit/services/CotizadorService.test.ts` :: «sin tarifa vigente responde 0.00 en todos los conceptos y tarifaVigente false» |
| R31 | `tests/unit/services/CotizadorService.test.ts` :: «usa el resolver por tienda sin añadir filtro de status» + `tests/unit/api/openapi-248-cotizador.test.ts` :: «el contrato declara la deuda de status» |
| R32 | `tests/unit/api/openapi-248-cotizador.test.ts` :: «ni la respuesta ni ningun schema publicado mencionan fulfillment» |
| R33 | `tests/unit/services/CotizadorService.test.ts` :: «cobra_comision ausente vale true; con false el escenario entregada omite comisión e IVA de comisión» |
| R34 | `tests/unit/api/openapi-248-cotizador.test.ts` :: «cobra_comision se publica con default true en el TS y en el yaml» |
| R35 | `tests/unit/guards/zona-de-distrito-definicion-unica.guardia.test.ts` :: «la regla de la zona del distrito solo vive en el util compartido» + `tests/unit/utils/resolucion-geografica.test.ts` :: «zonaDeDistrito devuelve unica/ninguna/ambigua» |
| R36 | Suites existentes de carga masiva, carga por API, listado por API key y cierre :: **verdes SIN modificar ningún archivo de test** (T1.4; 191 + 128 + 424 + 237 tests) |
| R37 | `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` :: «ocho paths, mismo orden en TS y en el yaml» + `tests/unit/api/openapi-248-cotizador.test.ts` :: «la coleccion postman incluye el request de cotizacion» |
| R38 | `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` :: «PUBLIC_ROUTES es EXACTAMENTE la lista firmada» (re-firmada en T6.1) |
| R39 | `tests/unit/guards/cotizador-sin-migracion.guardia.test.ts` :: «ninguna migración ni objeto de esquema corresponde a la feature» |
| R40 | `tests/unit/actions/cobertura-publica.test.ts` :: «no aplica límite de intentos: N consultas seguidas desde la misma IP responden igual» |

**Sin huecos: los 40 requisitos tienen test.**

---

## 5. Notas de diseño que el reviewer querrá ver

1. **`resolveGeo` colapsa «0 zonas» y «>1 zona» en el mismo `fieldError`**, porque nació en el camino
   que crea órdenes, donde `orden.zona_id` es NOT NULL. Eso es justo lo que R3 vs R4 tiene que
   distinguir. En vez de duplicar el matching por nombre (que R35 prohíbe), `CoberturaService`
   reparte las dos preguntas entre los **dos símbolos del mismo util compartido**: `resolveGeo`
   contesta «a qué distrito apunta este trío» y `zonaDeDistrito` contesta «qué zona lo cubre».
   Una definición, dos lecturas. Está documentado en el archivo.
2. **La separación dominio / DTO público** vive en `lib/types/cotizador.ts` (`ResultadoCobertura` +
   `aCoberturaPublica`), no en el service, para que la guardia de claves firmadas lea el DTO desde un
   módulo sin dependencias. La guardia comprueba además las claves **emitidas en ejecución**: el
   chequeo de propiedades excedentes de TypeScript solo mira literales, así que un spread
   ensancharía la respuesta sin poner rojo el typecheck.
3. **Punto de roce declarado:** `lib/types/cotizador.ts` está en el cierre transitivo de la
   superficie pública y a la vez alberga los DTOs monetarios del canal por API key. Hoy es inocuo
   (son tipos; el archivo solo importa `zod` y `lib/config/cotizador`) y la guardia lo cubre: si ese
   archivo llegara a importar el resolver de tarifas o `ingreso-ordenex`, se pone roja de inmediato.
4. **`@sin-superficie` retirada** de `consultarCoberturaPublica` al montar `CotizadorForm.tsx`, como
   exige `superficie-de-uso.guardia.test.ts` (precedente: `consultarRastreoPublico`). Se sustituyó
   por prosa que **no contiene el token literal**, porque el detector lo habría vuelto a leer como
   anotación viva.
5. **`/cotizador` verificado sirviéndose de verdad:** `next dev` en el worktree, `curl` sin cookie
   devolvió **200** (no 307 a `/login`), con las 7 provincias y 84 bloques de distritos en el payload
   y **cero** apariciones de `esCentral` o `zonaId` en el HTML.

## 6. Lo que quedó fuera, a propósito

- **`tarifas.status`** no se arregla (feature 70 del backlog): arreglarlo cambia dinero que se
  liquida hoy en el cierre.
- **`tarifas.fulfillment`** no entra: ninguna fórmula lo usa, cotizarlo prometería un cobro que el
  cierre no aplica.
- **Canastas heterogéneas** (N órdenes con montos COD distintos): la comisión COD es un % del monto,
  así que N montos distintos no son una multiplicación. Ficha aparte.
- **Migraciones**: ninguna. El cotizador solo lee.
- **Validador OpenAPI 3.1**: no hay ninguno instalado en el repo, así que «renderiza en Swagger UI
  sin error» se respalda con parseo + `$ref` resueltos + espejo deep-equal, no con un validador de
  esquema. Salvedad honesta, no un hueco de la feature.
- **`pnpm exec next build`**: no se corrió. Ningún gate del repo lo corre, y `pnpm build` encadena
  `migrate deploy` contra una base real. La frontera RSC de la superficie pública sí quedó cubierta
  por el `next dev` + `curl` del punto 5.
