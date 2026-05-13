#line 2 "../src/kernel/loongarch64/asm0.h"
/* Copyright (C) 2013  The PARI group.

This file is part of the PARI/GP package.

PARI/GP is free software; you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation; either version 2 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY WHATSOEVER.

Check the License for details. You should have received a copy of it, along
with the package; see the file 'COPYING'. If not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA. */
/*
ASM mulll
NOASM addll bfffo divll
*/
#ifdef ASMINLINE
#define LOCAL_HIREMAINDER  ulong hiremainder
#define LOCAL_OVERFLOW     ulong overflow

#define mulll(a, b)                                         \
__extension__ ({ ulong __value, __arg1 = (a), __arg2 = (b); \
 __asm__ ("mulh.du %1,%2,%3\n\tmul.d %0,%2,%3\n"            \
   : "=&r" (__value), "=&r" (hiremainder)                   \
   : "r" (__arg1), "r" (__arg2)                             \
   : );                                                     \
 __value;                                                   \
})

#define addmul(a, b)                                                    \
__extension__ ({                                                        \
  ulong __arg1 = (a), __arg2 = (b), __value, __tmp;                     \
  __asm__ ("mulh.du %0,%3,%4\n\tmul.d %2,%3,%4\n\t"                     \
           "add.d %1,%2,%5\n\tsltu %2,%1,%5\n\tadd.d %0,%0,%2\n"        \
           : "=&r" (hiremainder), "=&r" (__value), "=&r" (__tmp)        \
           : "r" (__arg1), "r" (__arg2), "r" (hiremainder)              \
           : );                                                         \
  __value;                                                              \
})
#endif
