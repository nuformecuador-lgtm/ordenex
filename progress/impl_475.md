# impl 475 — Informe de tránsito por WhatsApp (BACKEND, F0–F5)

- Rama: `feature/475-informe-transito-whatsapp`, nacida de `origin/dev` = `d1a10083` (contiene la 474,
  PR #848; `git merge-base --is-ancestor d1a10083 HEAD` → OK). Durante el trabajo `dev` avanzó a
  `c62524ec` (#849, solo UI de la 474: botón «Nuevo envío»); no toca archivos de esta ficha.
- Sin migraciones, sin `db/schema.prisma`, sin `lib/types/` (design §0): el gate rápido aplica.
- Grafo `codebase-memory`: no usado; el contrato de la 474 se leyó directamente de los archivos
  (`tipos.ts`, `catalogo.ts`, `EjecucionEnvioService.ts`), que es lo que manda.

## Archivos

Nuevos
- `lib/whatsapp-envios/informes/transito/parametros.ts` — PURO y apto para cliente: `HITOS`, `HITO_EN_PALABRAS`,
  `CIERRE_LOGISTICO`, `ESTADOS_OFRECIDOS` (18, orden del panel), `PARTIDA_PLAZO`, `PARAMETROS_POR_DEFECTO`,
  `parametrosTransitoSchema`, `plazoEfectivo`, `umbralDeAlerta`, `estadosIncluidos`, `umbralDeParado`,
  `estadoPorDefecto`, `erroresDeParametrosTransito`, tipos `ParametrosTransito`, `ZonaInforme`, `PlazoZona`.
- `lib/whatsapp-envios/informes/transito/tipos.ts` — `CorteZona`, `ConsultaTransito`, `FilaTransito`, `ZonaPanel`,
  `PrevisualizarTransitoResult`.
- `lib/whatsapp-envios/informes/transito/calculo.ts` — `cortesPorZona`, `clasificar` → `ModeloInformeTransito`, `variables`.
- `lib/whatsapp-envios/informes/transito/pdf.ts` — `pdfInformeTransito`, `fechaLargaCR`, `nombreArchivoTransito`.
- `lib/whatsapp-envios/informes/transito/informe.ts` — `crearInformeTransito(deps?)`, `seleccionarTransito`, `MOTIVO_SIN_ALERTAS`.
- `lib/interfaces/repositories/IInformeTransitoRepository.ts`, `lib/repositories/InformeTransitoRepository.ts`.
- `lib/actions/informe-transito.ts` — `previsualizarInformeTransito`.
- Tests: `tests/unit/whatsapp-envios/informe-transito-{parametros,calculo,informe,repo-consultas,composicion}.test.ts`,
  `tests/unit/pdf/informe-transito-pdf.test.ts`, `tests/unit/actions/informe-transito-actions.test.ts`,
  `tests/integration/db/informe-transito-{seleccion,zonas,hitos,parados,catalogo-real}.test.ts` + siembra
  `tests/integration/db/_informe-transito-475.ts`.

Modificados (aditivos sobre la 474)
- `lib/whatsapp-envios/informes/tipos.ts` — `DescriptorParametro` gana `DescriptorPanel`
  (`{ campo, etiqueta, tipo: "panel", panel: PanelParametros, campos, ayuda? }`) y `PanelParametros = "transito"`.
  Genérico y documentado: la 476 suma `"picking"` a la unión.
- `lib/whatsapp-envios/informes/catalogo.ts` — registra `crearInformeTransito()` (deps de producción).
- `tests/unit/whatsapp-envios/catalogo-informes.test.ts` — el catálogo ahora tiene 3 informes; un descriptor
  `panel` se valida por sus `campos` (no por `campo`).

## Contrato para frontend_dev (F6)

- Descriptor que llega en `listarInformesWhatsapp()` para `transito`:
  `{ campo: "transito", etiqueta: "Parámetros del informe de tránsito", tipo: "panel", panel: "transito", campos: ["hito","zonas","estados"] }`
  y `{ campo: "enviarSiVacio", tipo: "booleano", ... }` (este lo pinta el renderizador genérico).
  `ParametrosInforme.tsx` debe pintar `<ParamsTransito>` para `d.tipo === "panel" && d.panel === "transito"` y
  pasarle los errores cuyas claves empiezan por `parametros.hito`, `parametros.zonas`, `parametros.estados`.
- Forma de los parámetros (`ParametrosTransito`, `lib/whatsapp-envios/informes/transito/parametros.ts`):
  `{ hito: "entrada_bodega_central"|"creacion"|"generacion_guia", zonas: {zonaId, plazoDias, avisoDias}[],
  estados: {estado, incluido, paradoSiMasDeDias: number|null}[], enviarSiVacio: boolean }` (strict).
- Para el panel (todo importable en cliente desde `parametros.ts`): `PARAMETROS_POR_DEFECTO`, `ESTADOS_OFRECIDOS`
  (orden de la lista), `HITOS`, `HITO_EN_PALABRAS`, `CIERRE_LOGISTICO`, `plazoEfectivo(zona, parametros)` (R35:
  rellena las zonas sin entrada con la partida de su tipo), `umbralDeAlerta(plazo)` («entra en alerta el día N»),
  `estadoPorDefecto`, `PLAZO_MIN/MAX`, `PARADO_MIN/MAX`. Nombre visible del estado: `nombreDeEstado`.
- Vista previa: `previsualizarInformeTransito(parametros: unknown)` → `PrevisualizarTransitoResult`
  (`lib/whatsapp-envios/informes/transito/tipos.ts`):
  - `{ status: "ok", zonas: {id,nombre,esCentral}[], totalEnAlerta, parados, sinHito }`
  - `{ status: "validation_error", fieldErrors: Record<"parametros.<ruta>", string[]>, zonas }` (sin conteo)
  - `{ status: "unauthenticated" }` | `{ status: "forbidden" }` (todo rol que no sea `maestro`).
  - Un fallo de lectura de la base se LANZA (la promesa rechaza): el panel debe mostrarlo como error.
  - **Lleva `@sin-superficie` temporal**: al importarla desde `ParamsTransito` hay que QUITAR la anotación
    (la guardia `superficie-de-uso` falla si sobrevive con superficie).
- Al guardar, el panel envía UNA entrada en `zonas` por cada zona mostrada (R35).

## Mapa R → test

| R | Test |
| --- | --- |
| R1 | unit `informe-transito-informe` («metadatos del catalogo») |
| R2 | unit `informe-transito-informe` («variables», «destinatario_nombre llega por el motor») |
| R3 | unit `informe-transito-parametros` (R3) |
| R4 | unit `informe-transito-parametros` (R4, 15 casos con la ruta del campo); unit `informe-transito-actions` (error por campo) |
| R5 | unit `informe-transito-parametros` (R5, literal completo) |
| R6 | unit `informe-transito-parametros` (R6); unit `informe-transito-calculo` («R6/R7») |
| R7 | unit `informe-transito-calculo` («R6/R7») |
| R8 | int `informe-transito-zonas` («R8») |
| R9 | int `informe-transito-seleccion`; int `informe-transito-zonas` |
| R10 | int `informe-transito-seleccion` (la consulta pide `entregado`/`devuelta_a_tienda`) |
| R11 | int `informe-transito-hitos` («R11», reingreso y otros destinos) |
| R12 | int `informe-transito-hitos` («R12») |
| R13 | int `informe-transito-hitos` («R13», G1–G4) |
| R14 | int `informe-transito-hitos` («R14», «R13» sinHito); unit `informe-transito-pdf` (R29 línea sin hito); unit `informe-transito-actions` (`sinHito`) |
| R15 | unit `informe-transito-calculo` («R15», 8..12/10) |
| R16 | unit `informe-transito-calculo` («R16»); int `informe-transito-parados` |
| R17 | unit `informe-transito-calculo` («R17», 05:59/06:00 UTC y barrido hora a hora); int `informe-transito-zonas` (frontera) |
| R18 | unit `informe-transito-informe` («R18») |
| R19 | unit `informe-transito-informe` («R19»); unit `informe-transito-pdf` («R19») |
| R20 | unit `informe-transito-calculo` («R20»); unit `informe-transito-informe` («R20»); int `informe-transito-catalogo-real` |
| R21 | unit `informe-transito-informe` («R21») |
| R22 | unit `informe-transito-informe` («R22», las 3 operaciones + causa) |
| R23–R32 | unit `informe-transito-pdf` (un `describe` por R) |
| R33 | unit `informe-transito-informe` («R33», 23:30 CR) |
| R34–R37 | frontend (F6), components `ParamsTransito` — NO es de este backend |
| R38 | unit `informe-transito-actions` (conteo y error por campo); el pintado, F6 |
| R39 | unit `informe-transito-actions` (solo maestro, repo sin escrituras, misma selección que `generar`) |
| R40 | unit `informe-transito-repo-consultas` (1 y 500 órdenes → 3 llamadas); unit `informe-transito-composicion` (3 `$queryRaw`); int `informe-transito-seleccion` (solo vuelven las de alerta) |

## Mutaciones

Procedimiento: verde sin mutar → `sed` → `grep`/`git diff --stat` confirma el cambio → test → `git checkout --` →
`git status` limpio → verde de nuevo.

| # | Mutación | Test | Resultado |
| --- | --- | --- | --- |
| M11 | `vencido = dias >= plazo` | unit `informe-transito-calculo` | MEDIDA: muerta (1 rojo, «10/10 por vencer…») |
| M12 | `parado = diasEnEstado >= umbral` | unit `informe-transito-calculo` | MEDIDA: muerta (2 rojos) |
| M13 | catálogo registra `crearInformeTransito({repo: stub vacío})` | unit `informe-transito-composicion` | MEDIDA: muerta (1 rojo). Falta la versión int (`informe-transito-catalogo-real`) → leader |
| M14 | `generar` envuelve la selección en `catch { return vacío }` | unit `informe-transito-informe` | MEDIDA: muerta (4 rojos) |
| extra | quitar `devolviendo_a_bodega_central` de `ESTADOS_OFRECIDOS` | unit `informe-transito-parametros` | MEDIDA: muerta (2 rojos) |
| M1 | quitar `o."deleted_at" IS NULL` (`candidatas`, `InformeTransitoRepository.ts`) | int `informe-transito-seleccion` | **PENDIENTE (leader, necesita base)** |
| M2 | quitar `s."value" IN (...)` | int `informe-transito-seleccion` | **PENDIENTE** |
| M3 | quitar `NOT IN ('entregado','devuelta_a_tienda')` | int `informe-transito-seleccion` (consulta los pide) | **PENDIENTE** |
| M4 | un solo corte para todas las zonas (p. ej. `hito."at" < (SELECT MAX("corte") FROM "cortes")`) | int `informe-transito-zonas` | **PENDIENTE** |
| M5 | `hito."at" <= z."corte"` | int `informe-transito-zonas` (frontera) | **PENDIENTE** |
| M6 | `MAX` en el fragmento `entrada_bodega_central` | int `informe-transito-hitos` (reingreso) | **PENDIENTE** |
| M7 | quitar `AND sd."value" = 'en_bodega_central'` | int `informe-transito-hitos` | **PENDIENTE** |
| M8 | quitar `OR (h."estatus_origen_id" IS NULL AND sd."value" = 'por_recolectar_en_tienda')` | int `informe-transito-hitos` (G2) | **PENDIENTE** |
| M9 | `ORDER BY h."created_at" ASC, h."id" ASC` en `ult` | int `informe-transito-parados` | **PENDIENTE** |
| M10 | `contarSinHito` con un `cand` sin `s."value" IN (...)` | int `informe-transito-hitos` («R14») | **PENDIENTE** |

## Verificación (salida real)

- `tsc --noEmit -p tsconfig.json` → `TSC_EXIT=0`, 0 líneas de salida.
- `eslint` sobre los archivos de la ficha → `LINT_EXIT=0`, sin avisos.
- `vitest related --run` sobre los 10 archivos fuente de la ficha →
  `Test Files 199 passed | 8 skipped (207)` · `Tests 2637 passed | 16 skipped (2653)`. Los 8 saltados son
  `integration/db` (5 de esta ficha + 3 de la 474) **por falta de `DATABASE_URL`** en el worktree.
- Guardias (`vitest run guard`): tras los arreglos, `censo-order-status-rename` y `superficie-de-uso` verdes;
  queda roja `dependencias-declaradas-presentes` («faltan 58 de las 58»): es AMBIENTAL (el worktree no tiene
  `node_modules` propio; se ejecuta con los binarios del checkout principal). No la causa esta ficha.
- Integración contra Postgres: **NO EJECUTADA** (sin base en el entorno). Para el leader, con la base local
  compartida (ya tiene las migraciones de la 474; esta ficha no migra):
  `pnpm exec vitest run tests/integration/db/informe-transito-seleccion.test.ts tests/integration/db/informe-transito-zonas.test.ts tests/integration/db/informe-transito-hitos.test.ts tests/integration/db/informe-transito-parados.test.ts tests/integration/db/informe-transito-catalogo-real.test.ts`
  — comprobar que los 11 tests salen `passed` y NO `skipped`; después M1–M10 y M13-int con el procedimiento de arriba.
- PDF: verificado por texto extraído (`/ToUnicode`), no visualmente (en este entorno no hay `pdftoppm`). La
  comparación con las maquetas queda para T6.3.

## Desvíos del spec

1. **`ESTADOS_OFRECIDOS`**: mismo orden que design §3 (los tres no incluidos por defecto al final, como la maqueta).
2. **`FilaTransito.montoCobrar` es `string | null`** (`monto_cobrar::text`), no `Prisma.Decimal`: el DTO no arrastra
   Prisma y la suma va con `sumarMontos` (`Prisma.Decimal` dentro, sin `number`).
3. **`contarSinHito` se restringe a las zonas de `cortes`** (design: «sin cortes ni zona»). En producción `cortes` lleva
   TODAS las zonas, así que el resultado es el mismo; permite aislar los tests de integración en la base compartida.
4. **`zonaId` se valida como texto de 1–64**, no `uuid()`: una zona inexistente ya se ignora (R7) y un validador de
   UUID estricto rechazaría ids válidos de la base que no cumplan RFC 9562.
5. **`ResultadoInforme` NO gana rama `{tipo:"error"}`**: el spec no la pide (R22 = propagar la excepción) y el motor de
   la 474 ya trata una excepción de `generar` como fallo del job.
6. **Descriptor `panel`**: `campo` es solo identificador; los campos editados van en `campos`. Se adaptó la
   comprobación genérica de `catalogo-informes.test.ts` (474) para validar `campos` en vez de `campo`.
7. **PDF**: la fuente embebida es una sola (Regular): no hay negrita; el énfasis va por tamaño y color. El pie lleva
   la fecha como `05/10/2026 05:00` (la maqueta: `5 oct 2026 05:00`). El segundo total dice «Por vencer» (R23), no
   «En alerta» como la maqueta. Un carácter fuera de la cobertura de la fuente sale como «?» (no desaparece).
8. **Composition root (M13)**: además del test de integración del design, hay uno unitario
   (`informe-transito-composicion`) que redirige `getPrismaClient` a un espía; mide M13 sin base. El de integración
   redirige `getPrismaClient` a la transacción del test (revertida) y mide por diferencia antes/después.
9. **`@sin-superficie` temporal** en `previsualizarInformeTransito` hasta F6 (ver contrato).
10. T0.2 (base propia clonada) y T5.5 (gate `--rapido` con log) no se hicieron: por instrucción del leader, sin clones
    de base ni `init.sh`; el gate ampliado lo corre el leader al integrar.

## Veredicto

Backend F1–F5 hecho y commiteado; unit verdes con 4 mutaciones medidas (+1 extra); integración escrita y saltada por
falta de base: M1–M10 y M13-int quedan para el leader.

---

# FRONTEND (F6) — panel `ParamsTransito` (R34–R37 y el pintado de R38)

- Rama `fe-475` (empujada como `fe/475`), nacida de `origin/feature/475-informe-transito-whatsapp` + merge de
  `origin/dev`; `git merge-base --is-ancestor c28429f6 HEAD` → OK.
- Grafo `codebase-memory`: no usado; el contrato se leyó de esta bitácora y de los archivos (`parametros.ts`,
  `tipos.ts`, `lib/actions/informe-transito.ts`, `ParametrosInforme.tsx`).
- Herramientas con los binarios del checkout principal (el worktree no tiene `node_modules` propio).

## Archivos

Nuevos
- `app/(app)/configuracion/envios-whatsapp/_components/ParamsTransito.tsx` — el panel.
- `app/(app)/configuracion/envios-whatsapp/_components/transito-textos.ts` — textos y mensajes propios por campo
  (puro, sin React).
- `tests/components/ParamsTransito.test.tsx` — 21 tests (action doblada).

Modificados
- `app/(app)/configuracion/envios-whatsapp/_components/ParametrosInforme.tsx` — rama `tipo: "panel"` → `PanelDeInforme`
  (`transito` → `ParamsTransito`) con TODOS los valores y solo los errores `parametros.<campo>[.…]` de sus `campos`;
  con panel, no se repite el título genérico encima.
- `lib/actions/informe-transito.ts` — quitado el `@sin-superficie` (la importa el panel).
- `tests/unit/guards/estado-con-info.guardia.test.ts` — excepción `control-con-hermano` para `ParamsTransito.tsx`:
  el nombre del estado es la etiqueta de su casilla y lleva `InfoEstado` como hermano (guardia 456).

## Cómo funciona

- Al montar llama UNA vez a `previsualizarInformeTransito(valores)` (zonas reales + primer conteo). Si faltan
  entradas de zona, rellena `zonas` con una por cada zona mostrada (`plazoEfectivo`, partida de su tipo) y el conteo
  recibido se ata a los valores ya rellenos (no se vuelve a preguntar).
- Validación viva en el cliente con `parametrosTransitoSchema`: con valores inválidos, errores por campo y NINGÚN
  conteo, y no se llama al servidor. Con válidos, a los 400 ms sin cambios, nueva llamada; cada respuesta se ata a la
  clave de los valores con que se pidió (una respuesta tardía de valores viejos no se pinta).
- Errores: mensajes PROPIOS por campo en español claro (`mensajeDeCampo`, p. ej. «Pon un número entero de días entre
  0 y 9: el aviso tiene que ser menor que el plazo.»), junto al campo, con `aria-invalid` y `aria-describedby`. Los
  del servidor al guardar se muestran hasta que se toca el panel. Una ruta desconocida usa el mensaje del servidor sin
  su prefijo de clave. No se toca ningún traductor global de zod.
- Fallo de la vista previa (promesa rechazada) → «No se pudo calcular…» sin conteo; fallo de la carga de zonas →
  aviso + «Reintentar». `forbidden`/`unauthenticated` → «Solo un maestro puede ver…».

## Mapa R → test (components `ParamsTransito`)

| R | Test |
| --- | --- |
| R34 | «pinta TODAS las zonas reales…» (10/2 → día 8, 20/5 → día 15), «recalcula el día N», «tres opciones de hito», «los 18 estados ofrecidos… cierre logístico», «no usa la sigla SLA» |
| R35 | «sin entradas, rellena cada zona con la partida de su tipo», «una zona con plazo propio lo conserva» (30/7 → día 23), «al editar una zona se manda una entrada por CADA zona» |
| R36 | «restablece hito, plazos de todas las zonas, estados incluidos y umbrales» (valores enviados Y pantalla) |
| R37 | «los no incluidos de partida dicen «no entra» y su número está deshabilitado», «desmarcar un estado…» |
| R38 (pintado) | «hoy entrarían N paquetes (M parados)» + sin hito, singular, «vuelve a preguntar con los parámetros nuevos», «aviso >= plazo: error junto al campo… sin conteo y sin preguntar», «ningún estado incluido», «umbral fuera de rango», «error del servidor al guardar junto a su campo», «si la vista previa falla», «si no se pueden cargar las zonas» |
| design §8.1 | «pinta ParamsTransito… y le pasa SOLO los errores de sus campos» (vía `ParametrosInforme`) |

Valores esperados LITERALES (la partida está escrita a mano en el test, no importada de `PARAMETROS_POR_DEFECTO`).

## Mutaciones (medidas; commit → `sed` → `git diff --stat` → test → `git checkout --` → árbol limpio)

| # | Mutación | Resultado |
| --- | --- | --- |
| F1 | `entradaDe`: toda zona sin entrada recibe 10/2 (la «partida de la GAM» del texto viejo de la maqueta) | MEDIDA: muerta (5 rojos: R34, R35×3, R38) |
| F2 | número del umbral siempre habilitado (`disabled={false}`) | MEDIDA: muerta (2 rojos, R37) |
| F3 | sin la puerta de validación local (pregunta y pinta conteo con valores inválidos) | MEDIDA: muerta (2 rojos, R38) |

Medidas antes de añadir `InfoEstado` (cambio que no toca esas líneas); tras él, los 21 verdes de nuevo.

## Verificación (salida real)

- `tsc --noEmit -p tsconfig.json` → `TSC_EXIT=0`.
- `eslint` sobre los 6 archivos tocados → `LINT_EXIT=0`, sin avisos.
- `vitest related --run` sobre los archivos tocados → `Test Files 5 passed (5)` · `Tests 74 passed (74)`
  (`progress/related_475_frontend.log`).
- Guardias (`vitest run guard`) → `271 passed | 1 failed | 2 skipped`; el único rojo es
  `dependencias-declaradas-presentes` («faltan 58 de las 58»), AMBIENTAL (sin `node_modules` en el worktree), igual
  que en el backend (`progress/guardias_475_frontend.log`).
- T6.3 (ver la app contra la maqueta, «Probar ahora», PDF del historial): **NO HECHO** — sin base ni dev server en
  este worktree; queda para el leader. T6.4 (`./init.sh --rapido`) tampoco: por instrucción, solo related + tsc + lint.

## Diferencias con la maqueta

1. Texto de las zonas: «Una zona nueva aparece aquí con los valores de partida de su tipo (10 y 2 días en la GAM,
   20 y 5 fuera de ella)» en vez de «con los valores de la GAM» (pregunta abierta 1 / design §8.2).
2. 18 estados, no 14: añade `devolucion_a_origen_por_rechazo`, `devolviendo_a_bodega_central`,
   `por_devolver_a_tienda`, `devolviendo_a_tienda` (pregunta abierta 2). Nombres del catálogo (`nombreDeEstado`).
3. Cada estado lleva el botón de información (ⓘ) de la 456 junto a su nombre (guardia `estado-con-info`).
4. Un estado no incluido muestra su número DESHABILITADO y «no entra» a su lado (la maqueta solo pinta «no entra»):
   T6.2 pide «número deshabilitado».
5. Bajo el conteo, si hay paquetes sin el momento de inicio: «K paquetes en esos estados aún no han pasado por ese
   momento: no entran.» (R38; la maqueta no lo pinta).
6. Zonas como lista en rejilla, no `<table>`: en ≥ 640 px se ve como la tabla (cabecera de 4 columnas); a 390 px
   cada zona es un bloque (nombre arriba; plazo y aviso lado a lado con su etiqueta; «Entra en alerta el día N»
   debajo). Cada número tiene `<Label>` propio con la zona («Plazo máximo de GAM»). No verificado en navegador.
7. Con panel, el título genérico «Parámetros del informe «Informe de tránsito»» de la 474 no se pinta: el panel trae
   el de la maqueta. «Enviar aunque no haya nada que informar» lo sigue pintando el renderizador genérico, debajo.
8. Botón «Plegar» funcional (alterna con «Desplegar», `aria-expanded`).

## Veredicto (frontend)

F6 implementado: R34–R37 y el pintado de R38 con 21 tests de componente y 3 mutaciones medidas; falta T6.3 (ver la
app) y el gate `--rapido`, que corre el leader.
