(module
  (import "env" "fail" (func $env:fail (param i32 i32 i32)))
  (import "env" "write_i32" (func $env:write_i32 (param i32)))
  (import "env" "write_char" (func $env:write_char (param i32)))
  (memory (export "memory") 1 4096)
  (global $depth (mut i32) (i32.const 0))
  (func $main (export "main")
    (local $result.7 i32) (local $tmp.9 i32)
    (local.set $tmp.9
      (block $nest.8 (result i32)
        (global.set $depth (i32.add (global.get $depth) (i32.const 1)))
        (if
          (i32.gt_s (global.get $depth) (i32.const 400))
          (then
            (call $env:fail (i32.const 2) (i32.const 0) (i32.const 0))
            (unreachable)))
        (local.set $result.7 (call $fib (i32.const 10)))
        (global.set $depth (i32.sub (global.get $depth) (i32.const 1)))
        (local.get $result.7)))
    (call $env:write_i32 (local.get $tmp.9))
    (call $env:write_char (i32.const 10)))
  (func $fib (param $n i32) (result i32)
    (local $arg.1 i32) (local $result.2 i32) (local $arg.4 i32) (local $result.5 i32)
    (if
      (i32.lt_s (local.get $n) (i32.const 2))
      (then
        (return (local.get $n))))
    (return
      (i32.add
        (block $nest.3 (result i32)
          (local.set $arg.1 (i32.sub (local.get $n) (i32.const 1)))
          (global.set $depth (i32.add (global.get $depth) (i32.const 1)))
          (if
            (i32.gt_s (global.get $depth) (i32.const 400))
            (then
              (call $env:fail (i32.const 0) (i32.const 0) (i32.const 0))
              (unreachable)))
          (local.set $result.2 (call $fib (local.get $arg.1)))
          (global.set $depth (i32.sub (global.get $depth) (i32.const 1)))
          (local.get $result.2))
        (block $nest.6 (result i32)
          (local.set $arg.4 (i32.sub (local.get $n) (i32.const 2)))
          (global.set $depth (i32.add (global.get $depth) (i32.const 1)))
          (if
            (i32.gt_s (global.get $depth) (i32.const 400))
            (then
              (call $env:fail (i32.const 1) (i32.const 0) (i32.const 0))
              (unreachable)))
          (local.set $result.5 (call $fib (local.get $arg.4)))
          (global.set $depth (i32.sub (global.get $depth) (i32.const 1)))
          (local.get $result.5))))
    (unreachable))
)

