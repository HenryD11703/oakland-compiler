(module
  (import "env" "fail" (func $env:fail (param i32 i32 i32)))
  (import "env" "write_string" (func $env:write_string (param i32)))
  (import "env" "write_char" (func $env:write_char (param i32)))
  (import "env" "write_bool" (func $env:write_bool (param i32)))
  (memory (export "memory") 1 4096)
  (global $heap (mut i32) (i32.const 112))
  (data (i32.const 8) "\03\00\00\00O\00a\00k\00")
  (data (i32.const 24) "\04\00\00\00L\00a\00n\00d\00")
  (data (i32.const 40) "\04\00\00\00n\00u\00l\00l\00")
  (data (i32.const 56) "\04\00\00\00t\00r\00u\00e\00")
  (data (i32.const 72) "\05\00\00\00f\00a\00l\00s\00e\00")
  (data (i32.const 88) "\07\00\00\00O\00a\00k\00L\00a\00n\00d\00")
  (func $main (export "main")
    (local $s.1 i32) (local $n.2 i32) (local $tmp.3 i32) (local $tmp.4 i32)
    (local.set $s.1 (call $rt:str_concat (i32.const 8) (i32.const 24) (i32.const 0)))
    (local.set $n.2 (i32.const 3))
    (local.set $tmp.3
      (call $rt:str_concat
        (call $rt:str_concat
          (local.get $s.1)
          (call $rt:int_to_str (local.get $n.2) (i32.const 2))
          (i32.const 2))
        (if (result i32)
          (i32.const 1)
          (then
            (i32.const 56))
          (else
            (i32.const 72)))
        (i32.const 1)))
    (local.set $tmp.4 (call $rt:str_eq (local.get $s.1) (i32.const 88)))
    (call $env:write_string (local.get $tmp.3))
    (call $env:write_char (i32.const 32))
    (call $env:write_bool (local.get $tmp.4))
    (call $env:write_char (i32.const 10)))
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
  (func $rt:int_to_str (param $n i32) (param $site i32) (result i32)
    (local $neg i32) (local $m i32) (local $t i32) (local $count i32) (local $p i32) (local $i i32)
    (local.set $neg (i32.lt_s (local.get $n) (i32.const 0)))
    (local.set $m (select (i32.sub (i32.const 0) (local.get $n)) (local.get $n) (local.get $neg)))
    (local.set $t (local.get $m))
    (local.set $count (i32.const 1))
    (block $counted
      (loop $more
        (br_if $counted (i32.lt_u (local.get $t) (i32.const 10)))
        (local.set $t (i32.div_u (local.get $t) (i32.const 10)))
        (local.set $count (i32.add (local.get $count) (i32.const 1)))
        (br $more)))
    (local.set $count (i32.add (local.get $count) (local.get $neg)))
    (local.set $p
      (call $rt:alloc
        (i32.add (i32.const 4) (i32.shl (local.get $count) (i32.const 1)))
        (local.get $site)))
    (i32.store (local.get $p) (local.get $count))
    (local.set $i (local.get $count))
    (loop $digit
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (i32.store16 offset=4
        (i32.add (local.get $p) (i32.shl (local.get $i) (i32.const 1)))
        (i32.add (i32.const 48) (i32.rem_u (local.get $m) (i32.const 10))))
      (local.set $m (i32.div_u (local.get $m) (i32.const 10)))
      (br_if $digit (i32.gt_s (i32.sub (local.get $i) (local.get $neg)) (i32.const 0))))
    (if
      (local.get $neg)
      (then
        (i32.store16 offset=4 (local.get $p) (i32.const 45))))
    (local.get $p))
  (func $rt:str_eq (param $a i32) (param $b i32) (result i32)
    (local $n i32) (local $i i32)
    (if
      (i32.eq (local.get $a) (local.get $b))
      (then
        (return (i32.const 1))))
    (if
      (i32.or (i32.eqz (local.get $a)) (i32.eqz (local.get $b)))
      (then
        (return (i32.const 0))))
    (local.set $n (i32.load (local.get $a)))
    (if
      (i32.ne (local.get $n) (i32.load (local.get $b)))
      (then
        (return (i32.const 0))))
    (local.set $i (i32.const 0))
    (block $same
      (loop $next
        (br_if $same (i32.ge_u (local.get $i) (local.get $n)))
        (if
          (i32.ne
            (i32.load16_u offset=4
              (i32.add (local.get $a) (i32.shl (local.get $i) (i32.const 1))))
            (i32.load16_u offset=4
              (i32.add (local.get $b) (i32.shl (local.get $i) (i32.const 1)))))
          (then
            (return (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    (i32.const 1))
)

