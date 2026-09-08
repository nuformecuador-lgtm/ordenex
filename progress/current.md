# Estado — cierre de sesión del 2026-09-08

## 20 fichas cerradas, en seis releases

`376 · 377 · 379 · 380 · 381 · 382 · 383 · 384 · 385 · 386 · 387 · 388 · 390 · 391 · 392 · 393 · 394 · 395 · 398 · 399`

Canceladas por decisión del humano: **378** y **389**.

| Release | Commit | Migraciones |
|---|---|---|
| #733 | `7f6455c7` | — |
| #735 | `1d2e6c4e` | — |
| #748 | `8a68b5db` | — |
| #752 | `7381b54c` | **3** — verificadas: 49→51, 20→21, 10→11 |
| #755 | `73f9a420` | — |
| #758 | `0c0d3312` | **1** — ⚠️ **SIN VERIFICAR** |

## ⚠️ LO PRIMERO QUE HAY QUE MIRAR

**RESUELTO.** La release #758 se habia mergeado SIN crear despliegue: se redisparo con un commit vacio en `prod` (`c359b08e`) y quedo verificada -- migracion aplicada, catalogos en 52 y 34, cero errores de runtime. Lo que sigue es el historico de como se detecto. `prod` apunta a
`0c0d3312`, pero el catálogo de producción seguía en **51 / 33** y debe quedar en
**52 / 34**. Comprobar también que no hay errores de runtime.

```sql
select t.typname, count(*) from pg_type t join pg_enum e on e.enumtypid = t.oid
where t.typname in ('historial_accion_tipo','orden_historial_origen_tipo')
group by t.typname;
```

Lleva la **398** (corregir una gestión mal declarada) y la **399** (el aviso de ubicación).

## Una corrección aplicada A MANO en producción

Orden **50337523** del cierre **1E2D7CF8**: `entregada` → `rechazada`, con autorización
del maestro, porque la funcionalidad no existía todavía. Totales verificados **después**:
general `267.575` = suma de líneas de pago · efectivo `120.945` + SINPE `146.630` = el
total · pago al mensajero `34.000` = suma por gestión. Rastro en `orden_historial_estado`.

## En curso al cerrar

- **396**, solo la **tanda del cierre de mensajero**. La de **bodega va después**: chocaría
  con la 397.
- **397**, el recorte por rol en el cierre de bodega.

Van en paralelo **a propósito y sin pisarse**: tocan archivos distintos.

## Dos decisiones del humano, pendientes

1. **Al mensajero no se le avisa** de que su pago pasó a cero tras una corrección.
2. **A la tienda no le llega el aviso** de «orden rechazada» cuando se corrige.

Las dos pedirían otro tipo de notificación y otra migración. **No son bugs.**

## Deuda técnica medida, con dueño

- **El deadlock `40P01`** que ensució gates toda la sesión es contención entre tests de
  migración que aplican DDL sin bloqueo de aviso compartido. **Se reproduce sin el archivo
  de nadie.** Arreglable, no arreglado.
- **`recuperar-contrasena-form.test.tsx` es frágil bajo carga**: cae un test distinto cada
  vez, siempre esperando el paso a la fase de contraseña, y va de 8 s a 16 s según máquina.
- **La guardia del historial mide por MÉTODO, no por escritura.** Borrar una de varias
  escrituras del mismo método la deja verde. Medido dos veces.
- El error **bajo el campo** de la validación de cliente sigue en inglés en el formulario
  de usuarios. El select de Rol pinta los valores crudos del enum.
- **En iPhone**, la ruta de Ajustes del aviso de ubicación es la de Android.
- El **navegador embebido de WhatsApp no se detecta**, y no hay forma fiable de hacerlo.
