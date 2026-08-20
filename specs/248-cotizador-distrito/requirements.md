# Feature 248 — Cotizador de envío por distrito: cobertura, costos y total a recibir · requirements.md

Zone: `fullstack` · complexity: `high` · sdd: `true` · depends_on: `null` · branch: `feature/248-cotizador-distrito` (de `origin/dev` 5deaa9a4)

> Requisitos en notación EARS. Cada `R<n>` mapea a un test concreto en `tasks.md` (el reviewer
> rechaza si falta trazabilidad).
>
> **Estado del spec: GATE HUMANO PASADO (2026-08-20). NO QUEDAN PREGUNTAS ABIERTAS.**
>
> Las cuatro decisiones humanas de la ficha están firmadas: (a) dos superficies —pública sin login y
> canal por API key—; (b) la pública responde **solo cobertura**, los costos viven **únicamente** en
> el canal por API key; (c) el desglose incluye el escenario de **devolución** además del de entrega;
> (d) la respuesta del canal cierra con el **total por N órdenes**.
>
> Las **seis** que abrió la primera vuelta del spec están firmadas el **2026-08-20** y convertidas en
> requisitos; el registro está en §Decisiones del gate, al final de este archivo, y su desarrollo
> técnico en `design.md` (D3, D6, D12, D14, D15, D16).

---

## Contexto verificado (símbolos reales medidos en el árbol de `C:/w248`, no supuestos)

- **Cobertura = la N:M `zona_distrito`.** `db/schema.prisma:453-480`: `Distrito.zonas
  ZonaDistrito[]`, con el comentario explícito «única fuente de verdad; la columna escalar
  `zona_id` se eliminó en 20260713000000». **No existe `distrito.zona_id`.**
- **Un distrito puede tener 0, 1 o VARIAS zonas, y el repo ya tiene precedente firmado para el
  caso >1:** `OrdenRepository.findDistritosByCantonIds` (`lib/repositories/OrdenRepository.ts:1210-1218`)
  resuelve `zonaId = d.zonas.length === 1 ? d.zonas[0].zonaId : null` y `esCentral = false` cuando
  no hay exactamente una. Su comentario (líneas 1207-1209): «con >1 -> ambiguo/no derivable ->
  null (mismo trato seguro: no se inventa una zona)». **Esta feature adopta ese mismo trato**
  (R4/R16) y, al compartir la resolución (R35), lo convierte en **una única definición**.
- **La tarifa es POR TIENDA, no por zona.** `tarifas.tienda_id`; el resolver es
  `TarifaVigentePorTiendaRepository.resolveTarifaPorTienda`
  (`lib/repositories/TarifaVigentePorTiendaRepository.ts:67-77`): `where { tiendaId, deletedAt:
  null }`, `orderBy createdAt desc`, primera fila. **Un anónimo no tiene tienda → no hay tarifa que
  cotizar sin API key.** Esa es la razón dura de la decisión (b).
- **La zona solo elige la COLUMNA del flete**, nunca la fórmula: `zona.es_central`
  (`db/schema.prisma:413`) → `valorFleteGam` vs `valorFlete`, dentro de `derivarIngresoOrden`
  (`lib/utils/ingreso-ordenex.ts:66-93`).
- **La aritmética NO se reimplementa.** `lib/utils/ingreso-ordenex.ts` documenta con casos medidos
  (líneas 121-146) que una reimplementación en el navegador desviaba **un céntimo en 14 de 66
  órdenes reales** (montos 14 900,00 y 16 618,40 citados con su aritmética). El cotizador llama a
  `derivarIngresoOrden` (`:58`), `costosListadoOrden` (`:159`) y `pagoTiendaOrdenex` (`:252`).
- **El cierre acumula valores YA REDONDEADOS por gestión:** `agregarIngresosPorConcepto`
  (`lib/utils/ingreso-ordenex.ts:285-308`) suma los `Decimal` que `derivarIngresoOrden` ya redondeó
  a 2 decimales. De ahí la regla no negociable del total (R26).
- **`pagoTiendaOrdenex` NO descuenta el flete de devolución**, y lo dice en su docstring
  (`lib/utils/ingreso-ordenex.ts:239-251`): una devolución no recauda COD, así que no aporta al
  total general. Consecuencia directa de R21/R22: el neto negativo del escenario devuelta es un
  número **del cotizador**, no una línea del cierre.
- **El actor de una API key ES la tienda:** `BulkOrdenService.cargarViaApi`
  (`lib/services/BulkOrdenService.ts:367-369`) exige `actor.rol === "apiKey"` y hace `const tiendaId
  = actor.usuarioId`. El patrón de borde es `extraerBearer` + `buildAutenticar`
  (`lib/api/api-key-request.ts:18-31`) y las tres traducciones 401/403/422 de
  `app/api/ordenes/api-key/route.ts:52-69`.
- **La resolución geográfica por nombre vive PRIVADA dentro de `BulkOrdenService`**
  (`resolveGeo`, `:98-178`, con `normalize`/`lookup`, `:42-78`), en el camino que **crea órdenes**.
  Esta feature la **extrae y la comparte** (R35, D12): es el punto que más sube el riesgo del PR.
- **El canal por API key identifica la geografía por NOMBRE, no por uuid:** la carga recibe
  provincia/cantón/distrito como texto (`BulkOrdenService.ts:94-178`). Ningún contrato publicado
  expone uuids de distrito.
- **`middleware.ts:9-20`**: `PUBLIC_ROUTES` es la única vía para una página sin sesión (`/` se
  resuelve aparte, por coincidencia exacta, `middleware.ts:56-59`). **`SELF_AUTH_ROUTES`
  (`middleware.ts:32`) ya contiene el PREFIJO `/api/ordenes/api-key`**, así que un endpoint nuevo
  colgado de ahí **no obliga a tocar esa lista**.
- **Dos guardias congeladas se pondrán rojas y hay que actualizarlas en el MISMO PR:**
  1. `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts:49-82` compara las tres listas del
     middleware **posicionalmente** contra literales firmados (`LISTAS_ESPERADAS`).
  2. `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts:71-97` afirma
     `expect(clavesTs).toHaveLength(7)` y `toEqual(PATHS_ESPERADOS)` sobre el objeto TS **y** sobre
     el `.yaml`. Un octavo path la rompe.
- **Contrato publicado en tres artefactos:** `lib/api/openapi-spec.ts` (fuente de verdad),
  `docs/api/api-key-openapi.yaml` (espejo textual, líneas 1-8 del TS lo dicen) y
  `docs/api/ordenex-api-key.postman_collection.json`.
- **Deuda heredada, no introducida aquí:** el resolver de tarifa **no filtra `tarifas.status`**
  (`TarifaVigentePorTiendaRepository.ts:52-63`, decisión (g) de la feature 69, con test que exige
  que el `where` NO mencione `status`). Una tarifa `inactivo` no borrada **puede cotizarse**.
  Nótese además la asimetría ya existente: el listado de órdenes sí filtra `status: "activo"`
  (`OrdenRepository.ts:354-357`). Esta feature **no la arregla** (fuera de alcance) y **la declara**
  (R31).

---

## Alcance

**Dentro:** cobertura por distrito en la superficie pública `/cotizador`; cobertura + costos + total
por N órdenes en el canal por API key; **extracción y puesta en común de la resolución geográfica
por nombre** (hoy privada en `BulkOrdenService`); documentación del contrato; actualización de las
dos listas firmadas.

**El alcance CRECIÓ respecto de la primera vuelta del spec:** la firma 4 (2026-08-20) convierte una
duplicación acotada en un **refactor del camino que crea órdenes**. Eso sube el riesgo del PR; por
eso R36 y su tarea de no regresión son bloqueantes y el gate es **`./init.sh` completo**.

**Fuera, a propósito (con su porqué):**

- **`tarifas.fulfillment`.** Existe en la tabla y viaja al snapshot del cierre
  (`ITarifaVigentePorTiendaRepository.ts:36-41`), pero **ninguna fórmula lo usa**: no está en
  `TARIFA_SELECT` ni en `toTarifaVigente` (`TarifaVigentePorTiendaRepository.ts:9-40`).
  Cotizarlo prometería un cobro que el cierre no aplica. Si se quiere cobrar, es otra ficha y
  **empieza por el cierre**, no por el cotizador (R32).
- **El filtro de `tarifas.status`.** Arreglarlo cambia dinero que se liquida hoy en el cierre;
  entra por la feature 70 del backlog, no de contrabando en un cotizador de solo lectura (R31).
- **Canastas heterogéneas** (N órdenes con montos COD distintos). La comisión COD es un % del
  monto, así que N montos distintos **no son una multiplicación** (R28).
- **Migraciones / cambios de esquema.** El cotizador solo LEE datos que ya existen (R39).

---

## Requisitos

### Bloque A — Superficie pública `/cotizador` (solo cobertura)

**R1.** MIENTRAS la petición no traiga cookie de sesión válida, el sistema DEBE servir la página
pública `/cotizador` sin redirigir a `/login`.

**R2.** CUANDO se consulte la cobertura de un distrito que tiene **exactamente una** fila en
`zona_distrito`, el sistema DEBE responder que el distrito **está cubierto** e indicar el **nombre**
de esa zona.

**R3.** SI el distrito resuelto no tiene ninguna fila en `zona_distrito`, ENTONCES el sistema DEBE
responder que **no hay cobertura** y NO DEBE nombrar ninguna zona.

**R4.** SI el distrito resuelto tiene **más de una** fila en `zona_distrito`, ENTONCES el sistema
DEBE responder un resultado **no determinado** (ni cubierto ni no cubierto), sin nombrar ninguna
zona, con el mismo criterio que aplica la creación de órdenes (R35).

**R5.** CUANDO la entrada de la consulta pública no resuelva a un distrito único (provincia,
cantón o distrito ausente, vacío o no encontrado), el sistema DEBE responder un error de validación
por campo y NO DEBE tocar la tabla `tarifas`.

**R6.** El sistema NO DEBE incluir **ningún importe** en ninguna respuesta de la superficie pública:
ni monto, ni porcentaje de tarifa, ni total, ni campo derivable de un importe. **El nombre de la
ruta (`/cotizador`) no afloja este requisito** (D3).

**R7.** El sistema NO DEBE exponer en la superficie pública el flag `es_central` de la zona, ni el
id de ninguna zona, tarifa o tienda: la respuesta pública se limita a cobertura y **nombre** de
zona.

**R8.** El sistema NO DEBE aceptar en la superficie pública ningún parámetro que identifique una
tienda (id, email, api key o equivalente); un parámetro así en la entrada DEBE ignorarse sin
ampliar la respuesta.

**R9.** MIENTRAS el usuario elige el destino en la superficie pública, el sistema DEBE ofrecer una
cascada provincia → cantón → distrito, donde los cantones ofrecidos pertenecen a la provincia
elegida y los distritos ofrecidos al cantón elegido.

**R10.** El sistema NO DEBE permitir derivar un importe desde la superficie pública **ni por
diferencia**: el módulo que atiende la consulta pública NO DEBE depender (ni directa ni
transitivamente) del resolver de tarifas ni de las funciones de aritmética de
`lib/utils/ingreso-ordenex.ts`.

**R11.** MIENTRAS se muestra la página `/cotizador`, el sistema DEBE declarar en su texto visible que
ahí se consulta **cobertura** y que el **costeo** se obtiene por el canal de integración con API key.
*(Compensación del riesgo aceptado en D3: el nombre de la ruta promete más de lo que la superficie
entrega.)*

### Bloque B — Canal por API key: autenticación y borde

**R12.** SI la petición al endpoint de cotización no trae `Authorization: Bearer <key>` válido,
ENTONCES el sistema DEBE responder **401** con el shape uniforme de error del manejador global.

**R13.** SI la key existe pero su usuario dedicado no está `activo`, ENTONCES el sistema DEBE
responder **403**.

**R14.** SI el cuerpo de la petición no valida contra el schema del borde, ENTONCES el sistema DEBE
responder **422** con `fieldErrors`, **antes** de consultar cobertura o tarifa.

**R15.** CUANDO la key autentica, el sistema DEBE resolver la tienda de la cotización como
`actor.usuarioId` y NO DEBE leer ningún identificador de tienda del cuerpo o de la query.

**R16.** SI el distrito de la petición no resuelve **exactamente una** zona (0 o >1), ENTONCES el
sistema DEBE responder **200** con el bloque de cobertura correspondiente (R3/R4) y **sin bloque de
costos**, sin elegir una zona arbitraria.

**R17.** El sistema NO DEBE registrar la API key (ni su hash) en logs, respuestas de error o
telemetría.

### Bloque C — Canal por API key: costos, escenarios y total

**R18.** CUANDO la cotización resuelve zona y tarifa vigente, el sistema DEBE devolver el escenario
**ENTREGADA** con estos cuatro conceptos por separado: flete, IVA del flete, comisión COD e IVA de
la comisión COD.

**R19.** El escenario ENTREGADA DEBE incluir el **neto de la tienda**, calculado como el monto COD
menos (flete + IVA del flete) menos (comisión COD + IVA de la comisión COD).

**R20.** El sistema DEBE devolver, en la **misma respuesta**, el escenario **DEVUELTA** con el flete
de devolución y su IVA, **sin** comisión COD, sin IVA de comisión y **sin** monto COD a recibir.

**R21.** El escenario DEVUELTA DEBE incluir un neto **negativo** igual a `-(flete de devolución +
IVA del flete de devolución)`, obtenido **negando** los importes que ya devolvió
`derivarIngresoOrden({ resultado: "devuelta" })`, sin recalcular ninguno.

**R22.** El sistema DEBE declarar en el contrato publicado que el neto del escenario DEVUELTA es un
número **del cotizador** que **no existe en el cierre**, y que no debe cuadrarse contra ninguna línea
de cierre.

**R23.** El sistema DEBE derivar todos los conceptos de ambos escenarios llamando a
`derivarIngresoOrden` de `lib/utils/ingreso-ordenex.ts` (con `resultado: "entregada"` y con
`resultado: "devuelta"`), y NO DEBE contener aritmética monetaria propia que reproduzca esas
fórmulas.

**R24.** Para una misma tarifa, `esCentral`, `montoCobrar` y `cobraComision`, los conceptos que
devuelve el cotizador DEBEN ser **idénticos, dígito a dígito**, a los que el cierre acumula para esa
gestión vía `agregarIngresosPorConcepto`.

**R25.** El sistema DEBE aceptar una **cantidad de órdenes** entera; ausente, DEBE valer **1**.

**R26.** CUANDO la cantidad es N, el sistema DEBE devolver el **total** de cada concepto y de cada
neto como el valor **unitario ya redondeado a 2 decimales multiplicado por N**, y NO DEBE redondear
al final de la multiplicación de valores sin redondear.

**R27.** SI la cantidad no es un entero del rango **1..1000**, ENTONCES el sistema DEBE responder
**422** sin cotizar; los valores 1 y 1000 DEBEN aceptarse.

**R28.** El sistema DEBE declarar en la respuesta y en el contrato publicado el **supuesto** de la
cotización múltiple: las N órdenes comparten **distrito y monto COD**.

**R29.** El sistema DEBE expresar todo importe como **cadena con escala 2** derivada de
`Prisma.Decimal` con `ROUND_HALF_UP`, y NO DEBE usar `number`, `parseFloat` ni aritmética de punto
flotante para ningún importe. Aplica también al neto negativo de R21 (p. ej. `"-1695.00"`).

**R30.** SI la tienda de la key no tiene tarifa vigente, ENTONCES el sistema DEBE responder 200 con
todos los conceptos en `"0.00"` **y** una marca explícita de que **no hay tarifa vigente**, para que
un cero no se lea como «gratis».

**R31.** El sistema DEBE resolver la tarifa con `TarifaVigentePorTiendaRepository`, **sin** añadir
ningún filtro sobre `tarifas.status`, y DEBE declarar esa deuda heredada en el contrato publicado
(una tarifa `inactivo` no borrada puede cotizarse).

**R32.** El sistema NO DEBE incluir `tarifas.fulfillment` en ninguna respuesta ni en ningún schema
del contrato publicado.

**R33.** El sistema DEBE aceptar un parámetro opcional `cobra_comision` (booleano) que, **ausente,
vale `true`**, y DEBE propagarlo tal cual a `derivarIngresoOrden`; CUANDO valga `false`, el escenario
ENTREGADA NO DEBE incluir comisión COD ni su IVA.

**R34.** El sistema DEBE publicar `cobra_comision` —con su default `true`— en
`lib/api/openapi-spec.ts` y en su espejo `docs/api/api-key-openapi.yaml`.

### Bloque D — Resolución geográfica compartida, contrato, rutas y no-regresión

**R35.** El sistema DEBE resolver el trío (provincia, cantón, distrito) y la zona del distrito con
**un único módulo compartido** por la creación de órdenes y por el cotizador; ese módulo DEBE dar
**una sola respuesta** para un distrito con varias zonas (no derivable), y NO DEBE quedar una
segunda implementación de esa regla en ningún repositorio ni servicio.

**R36.** El sistema NO DEBE alterar el comportamiento observable de la carga masiva, de la carga por
API, del listado por API key ni del cierre: **la extracción de la resolución geográfica DEBE ser de
comportamiento idéntico**, y los tests existentes de esas vías DEBEN pasar **sin modificarse**.

**R37.** El sistema DEBE publicar el endpoint de cotización en `lib/api/openapi-spec.ts`, en su
espejo `docs/api/api-key-openapi.yaml` y en `docs/api/ordenex-api-key.postman_collection.json`, con
los mismos paths y el mismo orden en los dos primeros.

**R38.** CUANDO se añada `/cotizador` a `PUBLIC_ROUTES`, el sistema DEBE mantener verde la guardia de
listas firmadas del middleware, actualizando su literal esperado **en el mismo PR**.

**R39.** El sistema NO DEBE añadir ninguna migración ni modificar `db/schema.prisma`: el cotizador
solo lee datos existentes.

**R40.** El sistema NO DEBE aplicar límite de intentos en la superficie pública. *(Firma 6: no hay
PII, no hay enumeración útil —el catálogo geográfico ya es público— y no hay secreto que adivinar.
Se escribe como requisito para que no se lea como un olvido frente al precedente de la feature 229.)*

---

## Decisiones del gate (2026-08-20)

Las seis preguntas que abrió la primera vuelta del spec, con su firma humana. **Ninguna queda
abierta.**

| # | Pregunta | Firma | Dónde vive |
| --- | --- | --- | --- |
| 1 | Neto del escenario DEVUELTA | **Negativo**: `-(flete devolución + IVA)`. NO `null`. Número propio del cotizador, sin línea equivalente en el cierre | R21, R22, D6 |
| 2 | `cobraComision` como parámetro | **Sí**: opcional, default `true` (el caso caro), publicado en el contrato | R33, R34, D15 |
| 3 | Ruta pública | **`/cotizador`**, con riesgo aceptado sobre el nombre y compensación obligatoria en el copy | R1, R6, R11, D3 |
| 4 | Resolución geográfica | **Se extrae de `BulkOrdenService` y se comparte**; no se duplica. Sube el riesgo del PR | R35, R36, D12 |
| 5 | Tope de `cantidad` | **1..1000** | R27, D16 |
| 6 | Rate limit público | **No se pone**, con el porqué escrito | R40, D14 |

## Preguntas abiertas

**Ninguna.** Las seis se firmaron el 2026-08-20 y están arriba, convertidas en requisitos.
