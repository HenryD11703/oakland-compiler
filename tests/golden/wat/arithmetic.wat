(module
  (import "env" "fail" (func $env:fail (param i32 i32 i32)))
  (import "env" "write_i32" (func $env:write_i32 (param i32)))
  (import "env" "write_char" (func $env:write_char (param i32)))
  (import "env" "write_f64" (func $env:write_f64 (param f64)))
  (memory (export "memory") 1 4096)
  (func $main (export "main")
    (local $a.1 i32) (local $b.2 i32) (local $f.3 f64) (local $tmp.4 i32) (local $tmp.5 f64) (local $tmp.6 i32)
    (local.set $a.1 (i32.const 2147483647))
    (local.set $b.2 (i32.add (local.get $a.1) (i32.const 1)))
    (local.set $f.3
      (f64.add
        (f64.convert_i32_s (call $rt:div_i32 (local.get $b.2) (i32.const 4) (i32.const 0)))
        (f64.const 0.5)))
    (local.set $tmp.4 (local.get $b.2))
    (local.set $tmp.5 (local.get $f.3))
    (local.set $tmp.6 (call $rt:rem_i32 (i32.const 7) (i32.const 3) (i32.const 1)))
    (call $env:write_i32 (local.get $tmp.4))
    (call $env:write_char (i32.const 32))
    (call $env:write_f64 (local.get $tmp.5))
    (call $env:write_char (i32.const 32))
    (call $env:write_i32 (local.get $tmp.6))
    (call $env:write_char (i32.const 10)))
  (func $rt:div_i32 (param $a i32) (param $b i32) (param $site i32) (result i32)
    (if
      (i32.eqz (local.get $b))
      (then
        (call $env:fail (local.get $site) (i32.const 0) (i32.const 0))
        (unreachable)))
    (if
      (i32.eq (local.get $b) (i32.const -1))
      (then
        (return (i32.sub (i32.const 0) (local.get $a)))))
    (i32.div_s (local.get $a) (local.get $b)))
  (func $rt:rem_i32 (param $a i32) (param $b i32) (param $site i32) (result i32)
    (if
      (i32.eqz (local.get $b))
      (then
        (call $env:fail (local.get $site) (i32.const 0) (i32.const 0))
        (unreachable)))
    (i32.rem_s (local.get $a) (local.get $b)))
)

