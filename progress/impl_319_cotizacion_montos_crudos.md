# 319 — la cotización por API key sirve los importes crudos

**Fecha:** 2026-08-28 · **Rama:** `feature/319-cotizacion-montos-crudos` (desde `origin/dev`)
**Tipo:** enmienda al contrato público de la feature 255. **Cambio INCOMPATIBLE** para el
integrador.

## Qué cambia

`POST /api/ordenes/api-key/cotizacion` servía cada importe formateado —símbolo, miles agrupados,
coma decimal— y ahora lo sirve crudo, en string *money-safe* de escala 2:

| | antes | ahora |
| --- | --- | --- |
| `entregado.flete` | `"₡2.500,00"` | `"2500.00"` |
| `devuelto.total` | `"-₡1.578,00"` | `"-1578.00"` |

Afecta a los seis conceptos del escenario `entregado`, los cinco del `devuelto` y los mismos
dentro de `totales`. **Ningún nombre de campo cambia** y no se añade ni se quita ninguno: cambia
la forma del valor.

Lo que NO cambia: siguen siendo strings (nunca números JSON), siguen llevando exactamente dos
decimales, el cero sigue siendo explícito (`"0.00"`) y el negativo sigue marcándose con `-`
delante.

## Por qué

1. **El canal hablaba dos dialectos.** `POST /api/ordenes/api-key/carga` ya devolvía `costoEnvio`
   y `fulfillment` crudos. Un integrador que consumiera los dos endpoints necesitaba dos parsers
   para la misma moneda.
2. **El formateo anterior rompía en silencio.** Con miles en punto y decimal en coma, un
   `parseFloat("₡2.500,00")` mal saneado no falla: devuelve `2.5`. La forma cruda no tiene esa
   trampa.
3. **La presentación no debe gobernar un contrato de máquina.** El formato salía de
   `monedaConfig`, o sea de variables de entorno pensadas para las pantallas: mover
   `MONEDA_SEPARADOR_DECIMAL` cambiaba lo que veía un integrador.

## Qué pasa con la decisión A3 de la 255

A3 (R34, firmada el 2026-08-21) decía «solo la forma formateada, sin campo crudo en paralelo». Se
invierte **cuál** de las dos formas viaja; **no** se reabre lo que A3 protegía —una sola
representación por campo, nunca dos que se desincronizan—, que sigue vigente y sigue teniendo
test. En `tests/integration/cotizacion-api-key.test.ts` esa mitad se conserva con el sentido
invertido: antes se prohibía que apareciera un crudo, ahora se prohíbe que aparezca un formateado.

Requisitos tocados en `specs/255-cotizacion-api-key/`: R34, R35 y R36 reescritos (R36 queda
**invertida**: el serializador ya NO debe leer la configuración de moneda); **R37 extinguida**
(sin símbolo no hay nada delante de lo que colocar el signo); R39 acortada (desaparece la mitad
de agrupar miles). R38, R40, R41 y R42 intactos.

## Archivos

**Producción**
- `lib/utils/monto-cotizacion.ts` — reescrito. `formatMontoCotizacion` → `serializarMontoCotizacion`;
  se van `monedaConfig` y `agruparMiles`. Conserva la normalización del «menos cero» y el fallo
  ruidoso ante un decimal no finito.
- `lib/services/CotizacionOrdenService.ts` — renombrados import y helpers (`formatearEntregado` →
  `serializarEntregado`, etc.). Sin cambio de lógica.
- `lib/types/cotizacion.ts` — prosa del contrato.
- `app/api/ordenes/api-key/cotizacion/route.ts` — prosa (el borde sigue sin tocar ni un campo).
- `lib/api/openapi-spec.ts` — descripción, ejemplos y los diez `description` de propiedad, más un
  párrafo **CAMBIO INCOMPATIBLE** en la descripción del endpoint.

**Contrato publicado**
- `docs/api/api-key-openapi.yaml` — espejo textual, al día.
- `docs/api/CHANGELOG.md` — entrada fechada `2026-08-28 — ROMPEDOR`. Es el aviso al integrador:
  se copia y se manda, según la convención del propio archivo.
- `docs/api/ordenex-api-key.postman_collection.json` — descripción de la petición.

**Tests**
- `tests/unit/utils/monto-cotizacion.test.ts` — reescrito. Las 14 filas de la tabla de contrato
  con salida cruda; el describe de R36 queda **invertido** (el fuente NO lee `monedaConfig`, y
  cambiar la config no altera la salida); nuevo caso que ata la forma al `costoEnvio` de la carga.
- `tests/unit/guards/dinero-sin-centimos.guardia.test.ts` — diente 6. Sigue exigiendo los dos
  decimales; el regex deja de componerse desde `monedaConfig` y se suma `MONEY_SAFE_CRUDO`, que
  fija la forma entera (un `₡13.331.832,72` también cumpliría «acaba en dos decimales»).
- `tests/unit/services/cotizacion-orden-service.test.ts` — 82 importes esperados convertidos.
- `tests/integration/cotizacion-api-key.test.ts` — el regex `IMPORTE` pasa a llamarse
  `IMPORTE_FORMATEADO` y sobrevive como **detector de la regresión**.

**Specs**
- `specs/255-cotizacion-api-key/requirements.md` y `design.md` — enmendados en el sitio, con nota
  fechada. La tabla §6.1 histórica se conserva debajo de la vigente: las filas 6 y 11 solo se
  entienden sabiendo qué borde vigilaban.

## Verificación

`./init.sh --rapido` **se niega** en esta rama y manda al completo, correctamente: el diff toca
`lib/types/cotizacion.ts`, que es de los cimientos. Se corrió `./init.sh` completo.

## Sin ficha propia en `feature_list.json`

Es una enmienda a los requisitos de la 255, no una feature nueva: los requisitos viven donde ya
vivían, enmendados y fechados. Registrarla aparte habría duplicado la fuente de verdad de R34-R39
y, además, la cuota de `in_progress` por zona ya está en su tope (2). Si el humano prefiere ficha
propia, se abre y se apunta a este documento.
