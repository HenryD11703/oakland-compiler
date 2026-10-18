(module
  (import "env" "fail" (func $env:fail (param i32 i32 i32)))
  (import "env" "write_string" (func $env:write_string (param i32)))
  (import "env" "write_char" (func $env:write_char (param i32)))
  (import "env" "write_i32" (func $env:write_i32 (param i32)))
  (memory (export "memory") 1 4096)
  (global $heap (mut i32) (i32.const 24))
  (data (i32.const 8) "\04\00\00\00n\00u\00l\00l\00")
  (func $main (export "main")
    (local $list.1 i32) (local $a.3 i32) (local $slot.4 i32) (local $tmp.5 i32) (local $t.7 i32) (local $array.8 i32) (local $count.9 i32) (local $i.10 i32) (local $x.11 i32) (local $tmp.15 i32) (local $tmp.16 i32) (local $tmp.17 i32)
    (local.set $a.3
      (block $literal.2 (result i32)
        (local.set $list.1
          (call $rt:new_array (i32.const 3) (i32.const 2) (i32.const 0) (i32.const 0)))
        (i32.store offset=8 (local.get $list.1) (i32.const 3))
        (i32.store offset=12 (local.get $list.1) (i32.const 1))
        (i32.store offset=16 (local.get $list.1) (i32.const 2))
        (local.get $list.1)))
    (block $do.6
      (local.set $slot.4
        (call $rt:elem_addr (local.get $a.3) (i32.const 1) (i32.const 2) (i32.const 1)))
      (local.set $tmp.5
        (i32.load offset=8
          (call $rt:elem_addr (local.get $a.3) (i32.const 0) (i32.const 2) (i32.const 3))))
      (i32.store offset=8
        (local.get $slot.4)
        (i32.add (i32.load offset=8 (local.get $slot.4)) (local.get $tmp.5))))
    (local.set $t.7 (i32.const 0))
    (local.set $array.8 (call $rt:non_null (local.get $a.3) (i32.const 5)))
    (local.set $count.9 (i32.load (local.get $array.8)))
    (local.set $i.10 (i32.const 0))
    (block $break.12
      (loop $loop.13
        (br_if $break.12 (i32.ge_u (local.get $i.10) (local.get $count.9)))
        (local.set $x.11
          (i32.load offset=8
            (i32.add (local.get $array.8) (i32.shl (local.get $i.10) (i32.const 2)))))
        (block $continue.14
          (local.set $t.7 (i32.add (local.get $t.7) (local.get $x.11))))
        (local.set $i.10 (i32.add (local.get $i.10) (i32.const 1)))
        (br $loop.13)))
    (local.set $tmp.15 (local.get $a.3))
    (local.set $tmp.16 (local.get $t.7))
    (local.set $tmp.17 (call $rt:index_of_i32 (local.get $a.3) (i32.const 2) (i32.const 6)))
    (call $env:write_string (call $rt:show:int_arr (local.get $tmp.15) (i32.const 7)))
    (call $env:write_char (i32.const 32))
    (call $env:write_i32 (local.get $tmp.16))
    (call $env:write_char (i32.const 32))
    (call $env:write_i32 (local.get $tmp.17))
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
  (func $rt:new_array (param $len i32) (param $shift i32) (param $fill i32) (param $site i32) (result i32)
    (local $p i32) (local $i i32)
    (if
      (i32.gt_u (local.get $len) (i32.shr_u (i32.const 268435456) (local.get $shift)))
      (then
        (call $env:fail (local.get $site) (i32.const 0) (i32.const 0))
        (unreachable)))
    (local.set $p
      (call $rt:alloc
        (i32.add (i32.const 8) (i32.shl (local.get $len) (local.get $shift)))
        (local.get $site)))
    (i32.store (local.get $p) (local.get $len))
    (if
      (local.get $fill)
      (then
        (local.set $i (i32.const 0))
        (block $filled
          (loop $next
            (br_if $filled (i32.ge_u (local.get $i) (local.get $len)))
            (i32.store offset=8
              (i32.add (local.get $p) (i32.shl (local.get $i) (i32.const 2)))
              (local.get $fill))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $next)))))
    (local.get $p))
  (func $rt:elem_addr (param $arr i32) (param $index i32) (param $shift i32) (param $site i32) (result i32)
    (local $len i32)
    (if
      (i32.eqz (local.get $arr))
      (then
        (call $env:fail (local.get $site) (i32.const 0) (i32.const 0))
        (unreachable)))
    (local.set $len (i32.load (local.get $arr)))
    (if
      (i32.ge_u (local.get $index) (local.get $len))
      (then
        (call $env:fail
          (i32.add (local.get $site) (i32.const 1))
          (local.get $index)
          (local.get $len))
        (unreachable)))
    (i32.add (local.get $arr) (i32.shl (local.get $index) (local.get $shift))))
  (func $rt:non_null (param $p i32) (param $site i32) (result i32)
    (if
      (i32.eqz (local.get $p))
      (then
        (call $env:fail (local.get $site) (i32.const 0) (i32.const 0))
        (unreachable)))
    (local.get $p))
  (func $rt:index_of_i32 (param $arr i32) (param $x i32) (param $site i32) (result i32)
    (local $len i32) (local $i i32)
    (if
      (i32.eqz (local.get $arr))
      (then
        (call $env:fail (local.get $site) (i32.const 0) (i32.const 0))
        (unreachable)))
    (local.set $len (i32.load (local.get $arr)))
    (local.set $i (i32.const 0))
    (block $missing
      (loop $next
        (br_if $missing (i32.ge_u (local.get $i) (local.get $len)))
        (if
          (i32.eq
            (i32.load offset=8 (i32.add (local.get $arr) (i32.shl (local.get $i) (i32.const 2))))
            (local.get $x))
          (then
            (return (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    (i32.const -1))
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
  (func $rt:join_strings (param $strs i32) (param $bracketed i32) (param $site i32) (result i32)
    (local $n i32) (local $i i32) (local $s i32) (local $total i32) (local $p i32) (local $q i32) (local $len i32)
    (local.set $n (i32.load (local.get $strs)))
    (local.set $total (i32.shl (local.get $bracketed) (i32.const 1)))
    (if
      (i32.gt_s (local.get $n) (i32.const 0))
      (then
        (local.set $total
          (i32.add
            (local.get $total)
            (i32.shl (i32.sub (local.get $n) (i32.const 1)) (i32.const 1))))))
    (local.set $i (i32.const 0))
    (block $measured
      (loop $measure
        (br_if $measured (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $s
          (i32.load offset=8 (i32.add (local.get $strs) (i32.shl (local.get $i) (i32.const 2)))))
        (if
          (i32.eqz (local.get $s))
          (then
            (local.set $s (i32.const 8))))
        (local.set $total (i32.add (local.get $total) (i32.load (local.get $s))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $measure)))
    (local.set $p
      (call $rt:alloc
        (i32.add (i32.const 4) (i32.shl (local.get $total) (i32.const 1)))
        (local.get $site)))
    (i32.store (local.get $p) (local.get $total))
    (local.set $q (i32.add (local.get $p) (i32.const 4)))
    (if
      (local.get $bracketed)
      (then
        (i32.store16 (local.get $q) (i32.const 91))
        (local.set $q (i32.add (local.get $q) (i32.const 2)))))
    (local.set $i (i32.const 0))
    (block $written
      (loop $write
        (br_if $written (i32.ge_u (local.get $i) (local.get $n)))
        (if
          (local.get $i)
          (then
            (i32.store16 (local.get $q) (i32.const 44))
            (i32.store16 offset=2 (local.get $q) (i32.const 32))
            (local.set $q (i32.add (local.get $q) (i32.const 4)))))
        (local.set $s
          (i32.load offset=8 (i32.add (local.get $strs) (i32.shl (local.get $i) (i32.const 2)))))
        (if
          (i32.eqz (local.get $s))
          (then
            (local.set $s (i32.const 8))))
        (local.set $len (i32.load (local.get $s)))
        (memory.copy
          (local.get $q)
          (i32.add (local.get $s) (i32.const 4))
          (i32.shl (local.get $len) (i32.const 1)))
        (local.set $q (i32.add (local.get $q) (i32.shl (local.get $len) (i32.const 1))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $write)))
    (if
      (local.get $bracketed)
      (then
        (i32.store16 (local.get $q) (i32.const 93))))
    (local.get $p))
  (func $rt:show:int_arr (param $a i32) (param $site i32) (result i32)
    (local $n i32) (local $i i32) (local $strs i32) (local $r i32)
    (if
      (i32.eqz (local.get $a))
      (then
        (return (i32.const 8))))
    (local.set $n (i32.load (local.get $a)))
    (local.set $strs
      (call $rt:new_array (local.get $n) (i32.const 2) (i32.const 0) (local.get $site)))
    (local.set $i (i32.const 0))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (i32.store offset=8
          (i32.add (local.get $strs) (i32.shl (local.get $i) (i32.const 2)))
          (call $rt:int_to_str
            (i32.load offset=8 (i32.add (local.get $a) (i32.shl (local.get $i) (i32.const 2))))
            (local.get $site)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    (call $rt:join_strings (local.get $strs) (i32.const 1) (local.get $site)))
)

