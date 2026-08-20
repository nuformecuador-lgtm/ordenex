# Feature 248 — Cotizador de envío por distrito · tasks.md

> Checklist de pasos discretos. `[P]` = paralelizable con las tareas de su mismo bloque.
> Cada task lleva **criterio de hecho**. El mapa `R<n> → test` está en §Trazabilidad (el reviewer
> rechaza si falta uno). **32 tareas.**
>
> **Gate humano: PASADO (2026-08-20).** Las seis preguntas del spec están firmadas y absorbidas en
> requirements/design; no hay puerta previa que esperar.
>
> **Gate técnico:** `./init.sh --rapido` al cerrar cada tanda; **`./init.sh` completo antes del PR,
> sin excepción** (toca contrato publicado, `middleware.ts` y el camino que crea órdenes).
>
> **Orden obligatorio:** el bloque **T1 va primero y se cierra solo**. Es el refactor del camino
> crítico; si no queda verde y sin tocar tests ajenos, el resto de la feature no arranca.

---

## T1 — Resolución geográfica compartida (D12 / firma 4) · CAMINO CRÍTICO

- [x] **T1.1** Crear `lib/utils/resolucion-geografica.ts` (util PURO, sin acceso a datos) con la
      extracción **literal** de `normalize`, `lookup` y `resolveGeo` de `BulkOrdenService.ts:42-178`,
      más `zonaDeDistrito(zonas)` con los tres estados (`unica` / `ninguna` / `ambigua`).
      *Hecho:* el módulo no importa Prisma ni ningún repositorio; los mensajes de `fieldErrors` son
      **carácter a carácter** los de hoy.
- [x] **T1.2** `BulkOrdenService` delega en el util: se borran las copias privadas y se conserva la
      firma y el resultado de `resolveGeo`.
      *Hecho:* `BulkOrdenService` no contiene ya lógica de matching por nombre.
- [x] **T1.3** `OrdenRepository.findDistritosByCantonIds` (`:1210-1218`) puebla `zonaId`/`esCentral`
      llamando a `zonaDeDistrito`, en lugar del ternario `zonas.length === 1`.
      *Hecho:* `DistritoRow` sale idéntico (0 y >1 zonas → `zonaId: null`, `esCentral: false`).
- [x] **T1.4** **NO REGRESIÓN (bloqueante, R36):** correr las suites existentes de carga masiva,
      carga por API, listado por API key y cierre **sin modificar ni un test**.
      *Hecho:* todas verdes con el archivo de test intacto. **Si hay que tocar un test, el refactor
      cambió comportamiento: se revierte T1.2/T1.3 y se rehace**; no se ajusta el test.

## T2 — Tipos y configuración (depende de T1)

- [x] **T2.1** `lib/types/cotizador.ts`: zod de entrada de ambas superficies (incluye `cantidad`
      1..1000 y `cobra_comision` opcional default `true`) + DTOs de salida. Todo importe es `string`.
      *Hecho:* `pnpm run typecheck` verde y el DTO público **no declara** ninguna clave monetaria.
- [x] **T2.2 [P]** `lib/config/cotizador.ts`: tope de `cantidad` (1000) por configuración, sin
      hardcode en el service (D16).
      *Hecho:* el service no contiene el literal del tope.

## T3 — Dominio de COBERTURA (depende de T2)

- [x] **T3.1** `ICoberturaDistritoRepository` + `CoberturaDistritoRepository`: catálogo delgado
      (provincias, cantones, distritos y **zonas crudas** del distrito). **No proyecta tarifas.**
      *Hecho:* no importa `TarifaVigentePorTiendaRepository` ni selecciona `tarifasTienda`.
- [x] **T3.2** `CoberturaService` (+ interfaz): resuelve el trío con el util de T1.1 y ramifica por
      los tres estados de `zonaDeDistrito` (R2/R3/R4).
      *Hecho:* el módulo **no importa** `ingreso-ordenex` ni nada de tarifas.
- [x] **T3.3 [P]** Catálogo geográfico **sin zonas** para la cascada pública, leído por el Server
      Component (D13).
      *Hecho:* la proyección no incluye `zona` ni `esCentral`.

## T4 — Superficie pública `/cotizador` (depende de T3)

- [x] **T4.1** `app/cotizador/page.tsx` (Server Component público) + `CotizadorForm.tsx` (client) con
      la cascada provincia → cantón → distrito (R9).
      *Hecho:* la página renderiza sin sesión en local y la cascada acota cantones/distritos.
- [x] **T4.2** **Copy de compensación del riesgo aceptado (R11, D3):** texto visible que dice que ahí
      se consulta **cobertura** y que el **costeo** se obtiene por el canal con API key.
      *Hecho:* el texto está en el render inicial (no detrás de un click) y hay test que lo afirma.
- [x] **T4.3** `lib/actions/cobertura-publica.ts`: `'use server'`, **sin** `resolveActorFromSession`
      (con el comentario que explica que la ausencia es deliberada, patrón `rastreo-publico.ts:17-22`)
      y **sin rate limit** (D14, con su porqué escrito en el archivo); zod → service; nunca lanza.
      *Hecho:* toda salida es un resultado discriminado.
- [x] **T4.4** Añadir `/cotizador` a `PUBLIC_ROUTES` en `middleware.ts`.
      *Hecho:* la ruta responde 200 sin cookie; ninguna otra ruta cambia de comportamiento.

## T5 — Canal por API key (depende de T3; paralelizable con T4)

- [x] **T5.1 [P]** `CotizadorService` (+ interfaz): compone cobertura + tarifa +
      `derivarIngresoOrden("entregada")` / `("devuelta")` + `pagoTiendaOrdenex`.
      *Hecho:* **cero** fórmulas monetarias propias en el archivo.
- [x] **T5.2** Neto **negativo** del escenario DEVUELTA (R21/D6): se **niega** el derivado
      (`Prisma.Decimal(...).neg().toFixed(2)`), sin recalcular importes.
      *Hecho:* `"-1695.00"` para flete devolución 1500,00 + IVA 195,00, y **ninguna** llamada a
      `pagoTiendaOrdenex` en esta rama.
- [x] **T5.3** Multiplicación por N: unitario ya redondeado × N con
      `Prisma.Decimal.mul(...).toFixed(2)`, incluido el neto negativo (R26/D7).
      *Hecho:* test verde con un caso donde redondear al final daría otro número.
- [x] **T5.4** `app/api/ordenes/api-key/cotizar/route.ts`: `extraerBearer` + `buildAutenticar` +
      401/403 + zod 422, con `handleCotizarApi(req, deps)` exportado para inyección (patrón
      `app/api/ordenes/api-key/route.ts:48-86`).
      *Hecho:* el handler no contiene lógica de negocio ni queries.
- [x] **T5.5 [P]** Degradación sin tarifa vigente: `tarifaVigente: false` + conceptos `"0.00"` (R30).
      *Hecho:* no lanza, responde 200.
- [x] **T5.6 [P]** Bloque `supuesto` en la respuesta, con la cantidad interpolada (R28).
      *Hecho:* presente en toda respuesta con `escenarios`.
- [x] **T5.7** `cobra_comision` opcional con default `true` (R33/D15), propagado tal cual a
      `derivarIngresoOrden` y devuelto como eco en la respuesta.
      *Hecho:* con `false`, el escenario ENTREGADA **omite** `comisionCod` e `ivaComisionCod` (no los
      emite en `"0.00"`).

## T6 — Contrato publicado y listas firmadas (depende de T4.4 y T5.4)

- [x] **T6.1** Actualizar `LISTAS_ESPERADAS.PUBLIC_ROUTES` en
      `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts:54-61` con `/cotizador`, en su
      posición real y con el comentario que dice de qué feature viene (R38).
      *Hecho:* `pnpm run test:guardias` verde y la contraprueba del archivo sigue intacta.
- [x] **T6.2** Actualizar `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts:71-97`: 7 → 8
      paths, en TS y en el `.yaml`, mismo orden.
      *Hecho:* el test pasa **y** sigue cazando un path de más o de menos.
- [x] **T6.3** `lib/api/openapi-spec.ts`: path + schemas nuevos. Documenta el default de
      `cobra_comision` (R34), el supuesto de homogeneidad (R28), la deuda de `tarifas.status` (R31),
      que `fulfillment` **no** se cotiza (R32) y que **el neto negativo de DEVUELTA no existe en el
      cierre** (R22).
      *Hecho:* el spec JSON de `/api/docs/openapi` renderiza en Swagger UI sin error.
- [x] **T6.4** `docs/api/api-key-openapi.yaml`: espejo textual exacto de T6.3.
      *Hecho:* los guards de paridad TS↔yaml pasan.
- [x] **T6.5 [P]** `docs/api/ordenex-api-key.postman_collection.json`: request nuevo con Bearer y
      cuerpo de ejemplo (incluye `cantidad` y `cobra_comision`).
      *Hecho:* la colección importa sin error y el request devuelve 200 contra local.

## T7 — Guardias propias (depende de T4 y T5)

- [x] **T7.1** Guardia de **aislamiento del público** (R10): el grafo de imports de la Server Action
      pública, `CoberturaService`, `CoberturaDistritoRepository` y `app/cotizador/**` no alcanza
      `ingreso-ordenex`, `TarifaVigentePorTienda` ni `prisma.tarifa`. Con contraprueba.
      *Hecho:* la guardia se pone roja si se inyecta un import de tarifa en memoria.
- [x] **T7.2 [P]** Guardia de **claves del DTO público** contra literal firmado (R6) + contraprueba.
- [x] **T7.3 [P]** Guardia de **una sola definición de la zona del distrito** (R35): el ternario
      `zonas.length === 1` (y equivalentes) no aparece fuera de `lib/utils/resolucion-geografica.ts`.
      *Hecho:* con control de no-vacuidad (el censo encuentra el módulo compartido).
- [x] **T7.4 [P]** Guardia de **sin migración / sin esquema** (R39), con control de no-vacuidad.

## T8 — Cierre

- [x] **T8.1** `progress/impl_248.md` con el mapa `R<n> → test` **completo** (40 filas) y la salida
      real de los tests.
- [ ] **T8.2** `./init.sh` completo en verde, con el baseline de `dev` medido en la misma sesión
      (los baselines caducan con cualquier PR ajeno).
- [ ] **T8.3** PR con `feature_list.json` actualizado (`status`, `spec_approved_at`) y el riesgo del
      refactor de T1 nombrado en la descripción del PR.

---

## Trazabilidad `R<n> → test`

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
| R10 | `tests/unit/guards/cotizador-publico-sin-dinero.guardia.test.ts` :: «el grafo de imports del público no alcanza ingreso-ordenex ni el resolver de tarifas» + contraprueba |
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
| R32 | `tests/unit/api/openapi-248-cotizador.test.ts` :: «ni la respuesta ni ningún schema publicado mencionan fulfillment» |
| R33 | `tests/unit/services/CotizadorService.test.ts` :: «cobra_comision ausente vale true; con false el escenario entregada omite comisión e IVA de comisión» |
| R34 | `tests/unit/api/openapi-248-cotizador.test.ts` :: «cobra_comision se publica con default true en el TS y en el yaml» |
| R35 | `tests/unit/guards/zona-de-distrito-definicion-unica.guardia.test.ts` :: «la regla de la zona del distrito solo vive en el util compartido» + `tests/unit/utils/resolucion-geografica.test.ts` :: «zonaDeDistrito devuelve unica/ninguna/ambigua» |
| R36 | `tests/unit/services/BulkOrdenService*.test.ts` + `tests/integration/api/carga-api-key.test.ts` + suites de cierre y de listado por API key :: **verdes sin modificar ningún archivo de test** (T1.4) |
| R37 | `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` :: «ocho paths, mismo orden en TS y en el yaml» + `tests/unit/api/openapi-248-cotizador.test.ts` :: «la colección postman incluye el request de cotización» |
| R38 | `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` :: «PUBLIC_ROUTES es EXACTAMENTE la lista firmada» (actualizada en T6.1) |
| R39 | `tests/unit/guards/cotizador-sin-migracion.guardia.test.ts` :: «ninguna migración ni objeto de esquema corresponde a la feature» |
| R40 | `tests/unit/actions/cobertura-publica.test.ts` :: «no aplica límite de intentos: N consultas seguidas desde la misma IP responden igual» |
