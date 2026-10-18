(module
  (import "env" "fail" (func $env:fail (param i32 i32 i32)))
  (import "env" "write_i32" (func $env:write_i32 (param i32)))
  (import "env" "write_char" (func $env:write_char (param i32)))
  (memory (export "memory") 1 4096)
  (func $main (export "main")
    (local $sum.1 i32) (local $i.2 i32) (local $tmp.6 i32)
    (local.set $sum.1 (i32.const 0))
    (local.set $i.2 (i32.const 0))
    (block $break.3
      (loop $loop.4
        (br_if $break.3 (i32.eqz (i32.lt_s (local.get $i.2) (i32.const 10))))
        (block $continue.5
          (if
            (i32.eq (call $rt:rem_i32 (local.get $i.2) (i32.const 2) (i32.const 0)) (i32.const 0))
            (then
              (local.set $sum.1 (i32.add (local.get $sum.1) (local.get $i.2))))))
        (local.set $i.2 (i32.add (local.get $i.2) (i32.const 1)))
        (br $loop.4)))
    (local.set $tmp.6 (local.get $sum.1))
    (call $env:write_i32 (local.get $tmp.6))
    (call $env:write_char (i32.const 10)))
  (func $rt:rem_i32 (param $a i32) (param $b i32) (param $site i32) (result i32)
    (if
      (i32.eqz (local.get $b))
      (then
        (call $env:fail (local.get $site) (i32.const 0) (i32.const 0))
        (unreachable)))
    (i32.rem_s (local.get $a) (local.get $b)))
)

