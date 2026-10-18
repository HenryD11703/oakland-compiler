(module
  (import "env" "fail" (func $env:fail (param i32 i32 i32)))
  (import "env" "write_string" (func $env:write_string (param i32)))
  (import "env" "write_char" (func $env:write_char (param i32)))
  (memory (export "memory") 1 4096)
  (global $depth (mut i32) (i32.const 0))
  (global $heap (mut i32) (i32.const 104))
  (table 2 funcref)
  (elem (i32.const 0) $rt:show:Dog $Dog.sound)
  (data (i32.const 8) "\03\00\00\00.\00.\00.\00")
  (data (i32.const 24) "\04\00\00\00W\00o\00o\00f\00")
  (data (i32.const 40) "\04\00\00\00n\00u\00l\00l\00")
  (data (i32.const 56) "\08\00\00\00D\00o\00g\00{\00.\00.\00.\00}\00")
  (data (i32.const 80) "\04\00\00\00D\00o\00g\00{\00")
  (data (i32.const 96) "\01\00\00\00}\00")
  (func $main (export "main")
    (local $object.3 i32) (local $arg.5 i32) (local $a.7 i32) (local $tmp.8 i32) (local $arg.9 i32) (local $arg.10 i32) (local $result.11 i32) (local $tmp.14 i32)
    (local.set $a.7
      (block $new.4 (result i32)
        (local.set $object.3 (call $rt:alloc (i32.const 8) (i32.const 1)))
        (i32.store (local.get $object.3) (i32.const 0))
        (block $nest.6
          (local.set $arg.5 (local.get $object.3))
          (global.set $depth (i32.add (global.get $depth) (i32.const 1)))
          (if
            (i32.gt_s (global.get $depth) (i32.const 400))
            (then
              (call $env:fail (i32.const 2) (i32.const 0) (i32.const 0))
              (unreachable)))
          (call $Dog.new0 (local.get $arg.5))
          (global.set $depth (i32.sub (global.get $depth) (i32.const 1))))
        (local.get $object.3)))
    (local.set $tmp.14
      (block $do.13 (result i32)
        (local.set $tmp.8 (local.get $a.7))
        (block $nest.12 (result i32)
          (local.set $arg.9 (call $rt:non_null (local.get $tmp.8) (i32.const 3)))
          (local.set $arg.10 (i32.add (i32.load (local.get $tmp.8)) (i32.const 1)))
          (global.set $depth (i32.add (global.get $depth) (i32.const 1)))
          (if
            (i32.gt_s (global.get $depth) (i32.const 400))
            (then
              (call $env:fail (i32.const 4) (i32.const 0) (i32.const 0))
              (unreachable)))
          (local.set $result.11
            (call_indirect (param i32) (result i32) (local.get $arg.9) (local.get $arg.10)))
          (global.set $depth (i32.sub (global.get $depth) (i32.const 1)))
          (local.get $result.11))))
    (call $env:write_string (local.get $tmp.14))
    (call $env:write_char (i32.const 10)))
  (func $Animal.sound (param $this i32) (result i32)
    (return (i32.const 8))
    (unreachable))
  (func $Animal.new0 (param $this i32))
  (func $Dog.sound (param $this i32) (result i32)
    (return (i32.const 24))
    (unreachable))
  (func $Dog.new0 (param $this i32)
    (local $arg.1 i32)
    (block $nest.2
      (local.set $arg.1 (local.get $this))
      (global.set $depth (i32.add (global.get $depth) (i32.const 1)))
      (if
        (i32.gt_s (global.get $depth) (i32.const 400))
        (then
          (call $env:fail (i32.const 0) (i32.const 0) (i32.const 0))
          (unreachable)))
      (call $Animal.new0 (local.get $arg.1))
      (global.set $depth (i32.sub (global.get $depth) (i32.const 1)))))
  (func $rt:alloc (param $size i32) (param $site i32) (result i32)
    (local $p i32) (local $end i32) (local $have i32)
    (if
      (i32.gt_u (local.get $size) (i32.const 268435456))
      (then
        (call $env:fail (local.get $site) (i32.const 0) (i32.const 0))
        (unreachable)))
    (local.set $p (global.get $heap))
    (local.set $end
      (i32.and (i32.add (i32.add (local.get $p) (local.get $size)) (i32.const 7)) (i32.const -8)))
    (local.set $have (i32.shl (memory.size) (i32.const 16)))
    (if
      (i32.gt_u (local.get $end) (local.get $have))
      (then
        (if
          (i32.eq
            (memory.grow
              (i32.shr_u
                (i32.add (i32.sub (local.get $end) (local.get $have)) (i32.const 65535))
                (i32.const 16)))
            (i32.const -1))
          (then
            (call $env:fail (local.get $site) (i32.const 0) (i32.const 0))
            (unreachable)))))
    (global.set $heap (local.get $end))
    (local.get $p))
  (func $rt:str_concat (param $a i32) (param $b i32) (param $site i32) (result i32)
    (local $la i32) (local $lb i32) (local $p i32)
    (if
      (i32.eqz (local.get $a))
      (then
        (local.set $a (i32.const 40))))
    (if
      (i32.eqz (local.get $b))
      (then
        (local.set $b (i32.const 40))))
    (local.set $la (i32.load (local.get $a)))
    (local.set $lb (i32.load (local.get $b)))
    (local.set $p
      (call $rt:alloc
        (i32.add (i32.const 4) (i32.shl (i32.add (local.get $la) (local.get $lb)) (i32.const 1)))
        (local.get $site)))
    (i32.store (local.get $p) (i32.add (local.get $la) (local.get $lb)))
    (memory.copy
      (i32.add (local.get $p) (i32.const 4))
      (i32.add (local.get $a) (i32.const 4))
      (i32.shl (local.get $la) (i32.const 1)))
    (memory.copy
      (i32.add (i32.add (local.get $p) (i32.const 4)) (i32.shl (local.get $la) (i32.const 1)))
      (i32.add (local.get $b) (i32.const 4))
      (i32.shl (local.get $lb) (i32.const 1)))
    (local.get $p))
  (func $rt:show:Dog (param $a i32) (param $site i32) (result i32)
    (local $s i32)
    (if
      (i32.eqz (local.get $a))
      (then
        (return (i32.const 40))))
    (if
      (i32.load offset=4 (local.get $a))
      (then
        (return (i32.const 56))))
    (i32.store offset=4 (local.get $a) (i32.const 1))
    (local.set $s (i32.const 80))
    (local.set $s (call $rt:str_concat (local.get $s) (i32.const 96) (local.get $site)))
    (i32.store offset=4 (local.get $a) (i32.const 0))
    (local.get $s))
  (func $rt:non_null (param $p i32) (param $site i32) (result i32)
    (if
      (i32.eqz (local.get $p))
      (then
        (call $env:fail (local.get $site) (i32.const 0) (i32.const 0))
        (unreachable)))
    (local.get $p))
)

