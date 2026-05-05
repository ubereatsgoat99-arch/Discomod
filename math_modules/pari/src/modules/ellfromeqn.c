/* Copyright (C) 2015  The PARI group.

This file is part of the PARI/GP package.

PARI/GP is free software; you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation; either version 2 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY WHATSOEVER.

Check the License for details. You should have received a copy of it, along
with the package; see the file 'COPYING'. If not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA. */

#include "pari.h"
#include "paripriv.h"

/* This file is a C version by Bill Allombert of a GP script by
   Fernando Rodriguez-Villegas */

/* ---------------  GP code  --------------------------------------- */
/* http://www.ma.utexas.edu/users/villegas/cnt/jacobians.gp */
/* */
/* Description: Compute long Weierstrass equation for genus 1 curve */
/* given by a plane curve */
/* */
/* Original Author:     Fernando Rodriguez-Villegas  */
/*                      villegas@math.utexas.edu */
/*                      University of Texas at Austin */
/* */
/* Created:             Tue Jun  7 2005 */
/* */
/*----------------------------------------------------------------- */

/* The mathematic behind this is described in
On the Jacobians of plane cubics,
Artin, Michael and Rodriguez-Villegas, Fernando and Tate, John,
Advances in Mathematics, 198, 2005, 1, 366--382
DOI: 10.1016/j.aim.2005.06.004
URL: http://dx.doi.org/10.1016/j.aim.2005.06.004
PDF: http://www.sciencedirect.com/science/article/pii/S0001870805001775

Formula for map_quart, map_biquad by Bill Allombert
*/

static GEN
map_quart(GEN t0, GEN s0, GEN s1, GEN s2, GEN r0, GEN r1, GEN r2, GEN r3, GEN r4, GEN P)
{
  GEN x = gel(P,1), y = gel(P,2), d = gel(P,3);
  GEN x_2 =  gsqr(x), x_3 = gmul(x, x_2), x_4 = gsqr(x_2), x_5 = gmul(x_2, x_3), x_6 = gsqr(x_3);
  GEN y_2 =  gsqr(y), y_3 = gmul(y, y_2);
  GEN r0_2 = gsqr(r0);
  GEN r1_2 = gsqr(r1), r1_3 = gmul(r1, r1_2);
  GEN r2_2 = gsqr(r2);
  GEN r3_2 = gsqr(r3), r3_3 = gmul(r3, r3_2);
  GEN r4_2 = gsqr(r4);
  GEN t0_2 = gsqr(t0), t0_3 = gmul(t0, t0_2), t0_4 = gsqr(t0_2);
  GEN s0_2 = gsqr(s0), s0_3 = gmul(s0, s0_2), s0_4 = gsqr(s0_2);
  GEN s1_2 = gsqr(s1), s1_3 = gmul(s1, s1_2), s1_4 = gsqr(s1_2);
  GEN s2_2 = gsqr(s2), s2_3 = gmul(s2, s2_2), s2_4 = gsqr(s2_2);
  GEN d_2 = gsqr(d), d_3 = gmul(d, d_2), d_4 = gsqr(d_2), d_5 = gmul(d_2, d_3), d_6 = gsqr(d_3);
  GEN p1 = cgetg(4, t_VEC);
  gel(p1, 1) = gadd(gadd(gadd(gadd(gmul(gadd(gmul(gadd(gmul(gmulsg(-3, r2), r0), r1_2), t0_2), gmul(gadd(gadd(gmul(r2, s0_2), gmul(gadd(gmul(gneg(r1), s1), gmul(r0, s2)), s0)), gmul(r0, s1_2)), t0)), x_4), gmul(gadd(gmul(gadd(gmul(gmul(gmulsg(-8, d), r3), r0), gmul(gmul(d, r2), r1)), t0_2), gmul(gadd(gsub(gmul(gmul(gmulsg(2, d), r3), s0_2), gmul(gmul(gmul(d, r1), s2), s0)), gmul(gmul(gmul(gmulsg(4, d), r0), s2), s1)), t0)), x_3)), gmul(gadd(gmul(gadd(gmul(gmul(r2, s0), t0_2), gmul(gmul(s2, s0_2), t0)), y), gadd(gmul(gadd(gmul(gmul(gmulsg(-16, d_2), r4), r0), gadd(gmul(gmul(gmulsg(-2, d_2), r3), r1), gmul(d_2, r2_2))), t0_2), gmul(gadd(gadd(gmul(gmul(gmulsg(4, d_2), r4), s0_2), gmul(gsub(gmul(gmul(d_2, r3), s1), gmul(gmul(d_2, r2), s2)), s0)), gadd(gmul(gmul(gmul(d_2, r1), s2), s1), gmul(gmul(gmulsg(4, d_2), r0), s2_2))), t0))), x_2)), gmul(gadd(gmul(gadd(gmul(gmul(gmul(d, r2), s1), t0_2), gmul(gmul(gmul(gmul(d, s2), s1), s0), t0)), y), gadd(gmul(gadd(gmul(gmul(gmulsg(-8, d_3), r4), r1), gmul(gmul(d_3, r3), r2)), t0_2), gmul(gadd(gmul(gsub(gmul(gmul(gmulsg(4, d_3), r4), s1), gmul(gmul(d_3, r3), s2)), s0), gmul(gmul(gmulsg(2, d_3), r1), s2_2)), t0))), x)), gadd(gadd(gmul(gadd(gmul(r2, t0_3), gmul(gmul(s2, s0), t0_2)), y_2), gmul(gadd(gmul(gmul(gmul(d_2, r2), s2), t0_2), gmul(gmul(gmul(d_2, s2_2), s0), t0)), y)), gadd(gmul(gadd(gmul(gmul(gmulsg(-3, d_4), r4), r2), gmul(d_4, r3_2)), t0_2), gmul(gadd(gmul(gmul(gmul(d_4, r4), s2), s0), gadd(gsub(gmul(gmul(d_4, r4), s1_2), gmul(gmul(gmul(d_4, r3), s2), s1)), gmul(gmul(d_4, r2), s2_2))), t0))));
  gel(p1, 2) = gadd(gadd(gadd(gadd(gadd(gadd(gmul(gadd(gadd(gmul(gsub(gadd(gmul(gmulsg(-8, r3), r0_2), gmul(gmul(gmulsg(4, r2), r1), r0)), r1_3), t0_3), gmul(gadd(gadd(gmul(gsub(gmul(gmulsg(4, r3), r0), gmul(r2, r1)), s0_2), gmul(gsub(gmul(gadd(gmul(gneg(r2), r0), r1_2), s1), gmul(gmul(gmulsg(2, r1), r0), s2)), s0)), gadd(gmul(gmul(gneg(r1), r0), s1_2), gmul(gmul(gmulsg(4, r0_2), s2), s1))), t0_2)), gmul(gsub(gmul(gmul(r1, s2), s0_3), gmul(gmul(gmul(gmulsg(2, r0), s2), s1), s0_2)), t0)), x_6), gmul(gadd(gadd(gmul(gsub(gadd(gmul(gmul(gmulsg(-32, d), r4), r0_2), gmul(gadd(gmul(gmul(gmulsg(-4, d), r3), r1), gmul(gmulsg(8, d), r2_2)), r0)), gmul(gmul(gmulsg(2, d), r2), r1_2)), t0_3), gmul(gadd(gadd(gmul(gadd(gmul(gmul(gmulsg(16, d), r4), r0), gsub(gmul(gmul(d, r3), r1), gmul(gmulsg(2, d), r2_2))), s0_2), gmul(gadd(gmul(gadd(gmul(gmul(gmulsg(6, d), r3), r0), gmul(gmul(d, r2), r1)), s1), gmul(gadd(gmul(gmul(gmulsg(-8, d), r2), r0), gmul(d, r1_2)), s2)), s0)), gadd(gadd(gmul(gmul(gmul(gmulsg(-3, d), r2), r0), s1_2), gmul(gmul(gmul(gmul(gmulsg(2, d), r1), r0), s2), s1)), gmul(gmul(gmulsg(8, d), r0_2), s2_2))), t0_2)), gmul(gsub(gsub(gadd(gmul(gmul(gmulsg(-2, d), r4), s0_4), gmul(gmul(gmul(gmulsg(2, d), r2), s2), s0_3)), gmul(gmul(gmul(gmulsg(2, d), r0), s2_2), s0_2)), gmul(gmul(gmul(gmul(gmulsg(2, d), r0), s2), s1_2), s0)), t0)), x_5)), gmul(gadd(gmul(gsub(gadd(gmul(gmul(gsub(gmul(gmulsg(3, r2), r0), r1_2), s1), t0_3), gmul(gsub(gadd(gadd(gmul(gmulsg(3, r3), s0_3), gmul(gadd(gmul(gmulsg(-2, r2), s1), gmul(gmulsg(3, r1), s2)), s0_2)), gmul(gsub(gmul(r1, s1_2), gmul(gmul(r0, s2), s1)), s0)), gmul(r0, s1_3)), t0_2)), gmul(gmul(gmul(s2, s1), s0_3), t0)), y), gadd(gadd(gmul(gsub(gmul(gadd(gmul(gmul(gmulsg(-40, d_2), r4), r1), gmul(gmul(gmulsg(20, d_2), r3), r2)), r0), gmul(gmul(gmulsg(5, d_2), r3), r1_2)), t0_3), gmul(gadd(gadd(gmul(gsub(gmul(gmul(gmulsg(10, d_2), r4), r1), gmul(gmul(gmulsg(5, d_2), r3), r2)), s0_2), gmul(gsub(gmul(gadd(gmul(gmul(gmulsg(28, d_2), r4), r0), gsub(gmul(gmul(gmulsg(6, d_2), r3), r1), gmul(d_2, r2_2))), s1), gmul(gmul(gmul(gmulsg(10, d_2), r3), r0), s2)), s0)), gadd(gadd(gmul(gsub(gmul(gmul(gneg(d_2), r3), r0), gmul(gmul(d_2, r2), r1)), s1_2), gmul(gmul(gadd(gmul(gmul(gmulsg(-9, d_2), r2), r0), gmul(gmulsg(2, d_2), r1_2)), s2), s1)), gmul(gmul(gmul(gmulsg(10, d_2), r1), r0), s2_2))), t0_2)), gmul(gadd(gadd(gmul(gadd(gmul(gmul(gmulsg(-7, d_2), r4), s1), gmul(gmul(gmulsg(4, d_2), r3), s2)), s0_3), gmul(gsub(gmul(gmul(gmul(gmulsg(2, d_2), r2), s2), s1), gmul(gmul(d_2, r1), s2_2)), s0_2)), gmul(gsub(gmul(gmul(gmul(gneg(d_2), r1), s2), s1_2), gmul(gmul(gmul(gmulsg(3, d_2), r0), s2_2), s1)), s0)), t0))), x_4)), gmul(gadd(gmul(gsub(gadd(gmul(gmul(gsub(gmul(gmul(gmulsg(8, d), r3), r0), gmul(gmul(d, r2), r1)), s1), t0_3), gmul(gsub(gadd(gmul(gmul(gmul(gmulsg(4, d), r3), s1), s0_2), gmul(gadd(gmul(gmul(gmulsg(-2, d), r2), s1_2), gmul(gmul(gmul(gmulsg(7, d), r1), s2), s1)), s0)), gmul(gmul(gmul(gmulsg(4, d), r0), s2), s1_2)), t0_2)), gmul(gmul(gmul(gmul(gmulsg(2, d), s2), s1_2), s0_2), t0)), y), gadd(gadd(gmul(gsub(gmul(gmul(gmulsg(20, d_3), r3_2), r0), gmul(gmul(gmulsg(20, d_3), r4), r1_2)), t0_3), gmul(gadd(gadd(gmul(gmul(gmulsg(-5, d_3), r3_2), s0_2), gmul(gmul(gsub(gmul(gmul(gmulsg(24, d_3), r4), r1), gmul(gmul(d_3, r3), r2)), s1), s0)), gadd(gadd(gmul(gadd(gmul(gmul(gmulsg(8, d_3), r4), r0), gsub(gmul(gmul(d_3, r3), r1), gmul(d_3, r2_2))), s1_2), gmul(gmul(gsub(gmul(gmul(gmulsg(-16, d_3), r3), r0), gmul(gmul(d_3, r2), r1)), s2), s1)), gmul(gmul(gmulsg(5, d_3), r1_2), s2_2))), t0_2)), gmul(gadd(gsub(gmul(gadd(gmul(gmul(gmulsg(-9, d_3), r4), s1_2), gmul(gmul(gmul(gmulsg(7, d_3), r3), s2), s1)), s0_2), gmul(gmul(gmul(gmul(gmulsg(3, d_3), r1), s2_2), s1), s0)), gmul(gmul(gmul(d_3, r0), s2_2), s1_2)), t0))), x_3)), gmul(gadd(gadd(gmul(gsub(gmul(gadd(gmul(gmulsg(6, r3), s0_2), gmul(gadd(gmul(gmulsg(-2, r2), s1), gmul(gmulsg(6, r1), s2)), s0)), t0_3), gmul(gmul(gmul(gmulsg(2, s2), s1), s0_2), t0_2)), y_2), gmul(gadd(gadd(gmul(gmul(gadd(gmul(gmul(gmulsg(16, d_2), r4), r0), gsub(gmul(gmul(gmulsg(2, d_2), r3), r1), gmul(d_2, r2_2))), s1), t0_3), gmul(gadd(gadd(gmul(gadd(gmul(gmul(gmulsg(-4, d_2), r4), s1), gmul(gmul(gmulsg(6, d_2), r3), s2)), s0_2), gmul(gadd(gsub(gmul(gmul(gmulsg(2, d_2), r3), s1_2), gmul(gmul(gmul(d_2, r2), s2), s1)), gmul(gmul(gmulsg(6, d_2), r1), s2_2)), s0)), gsub(gadd(gmul(gmul(gneg(d_2), r2), s1_3), gmul(gmul(gmul(gmulsg(2, d_2), r1), s2), s1_2)), gmul(gmul(gmul(gmulsg(4, d_2), r0), s2_2), s1))), t0_2)), gmul(gsub(gmul(gmul(gmul(gmulsg(-2, d_2), s2_2), s1), s0_2), gmul(gmul(gmul(d_2, s2), s1_3), s0)), t0)), y)), gadd(gadd(gmul(gadd(gmul(gmul(gmul(gmulsg(40, d_4), r4), r3), r0), gmul(gadd(gmul(gmul(gmulsg(-20, d_4), r4), r2), gmul(gmulsg(5, d_4), r3_2)), r1)), t0_3), gmul(gadd(gadd(gmul(gmul(gmul(gmulsg(-10, d_4), r4), r3), s0_2), gmul(gadd(gmul(gsub(gmul(gmul(gmulsg(11, d_4), r4), r2), gmul(gmulsg(3, d_4), r3_2)), s1), gmul(gmul(gmul(gmulsg(10, d_4), r4), r1), s2)), s0)), gadd(gadd(gmul(gsub(gmul(gmul(gmulsg(9, d_4), r4), r1), gmul(gmul(d_4, r3), r2)), s1_2), gmul(gmul(gadd(gmul(gmul(gmulsg(-12, d_4), r4), r0), gsub(gmul(gmul(gmulsg(-4, d_4), r3), r1), gmul(d_4, r2_2))), s2), s1)), gmul(gadd(gmul(gmul(gmulsg(-10, d_4), r3), r0), gmul(gmul(gmulsg(5, d_4), r2), r1)), s2_2))), t0_2)), gmul(gadd(gadd(gmul(gadd(gmul(gmul(gmul(gmulsg(-3, d_4), r4), s2), s1), gmul(gmul(gmulsg(4, d_4), r3), s2_2)), s0_2), gmul(gsub(gsub(gadd(gmul(gmul(gmulsg(-5, d_4), r4), s1_3), gmul(gmul(gmul(gmulsg(4, d_4), r3), s2), s1_2)), gmul(gmul(gmul(gmulsg(3, d_4), r2), s2_2), s1)), gmul(gmul(d_4, r1), s2_3)), s0)), gmul(gmul(gmul(gmulsg(3, d_4), r0), s2_3), s1)), t0))), x_2)), gmul(gadd(gadd(gmul(gsub(gmul(gadd(gmul(gmul(gmul(gmulsg(6, d), r3), s1), s0), gadd(gmul(gmul(gmulsg(-2, d), r2), s1_2), gmul(gmul(gmul(gmulsg(6, d), r1), s2), s1))), t0_3), gmul(gmul(gmul(gmul(gmulsg(2, d), s2), s1_2), s0), t0_2)), y_2), gmul(gsub(gadd(gmul(gmul(gsub(gmul(gmul(gmulsg(8, d_3), r4), r1), gmul(gmul(d_3, r3), r2)), s1), t0_3), gmul(gadd(gmul(gadd(gmul(gmul(gmulsg(-4, d_3), r4), s1_2), gmul(gmul(gmul(gmulsg(7, d_3), r3), s2), s1)), s0), gadd(gmul(gmul(gmul(gmulsg(-2, d_3), r2), s2), s1_2), gmul(gmul(gmul(gmulsg(4, d_3), r1), s2_2), s1))), t0_2)), gmul(gmul(gmul(gmul(gmulsg(2, d_3), s2_2), s1_2), s0), t0)), y)), gadd(gadd(gmul(gadd(gmul(gmul(gmulsg(32, d_5), r4_2), r0), gadd(gmul(gmul(gmul(gmulsg(4, d_5), r4), r3), r1), gadd(gmul(gmul(gmulsg(-8, d_5), r4), r2_2), gmul(gmul(gmulsg(2, d_5), r3_2), r2)))), t0_3), gmul(gadd(gadd(gmul(gmul(gmulsg(-8, d_5), r4_2), s0_2), gmul(gadd(gmul(gmul(gmul(gmulsg(-2, d_5), r4), r3), s1), gmul(gsub(gmul(gmul(gmulsg(8, d_5), r4), r2), gmul(d_5, r3_2)), s2)), s0)), gadd(gadd(gmul(gsub(gmul(gmul(gmulsg(5, d_5), r4), r2), gmul(d_5, r3_2)), s1_2), gmul(gmul(gsub(gmul(gmul(gmulsg(2, d_5), r4), r1), gmul(gmul(gmulsg(3, d_5), r3), r2)), s2), s1)), gmul(gadd(gmul(gmul(gmulsg(-16, d_5), r4), r0), gadd(gmul(gmul(gneg(d_5), r3), r1), gmul(gmulsg(2, d_5), r2_2))), s2_2))), t0_2)), gmul(gadd(gadd(gmul(gmul(gmul(gmulsg(2, d_5), r4), s2_2), s0_2), gmul(gsub(gadd(gmul(gmul(gmul(gmulsg(-4, d_5), r4), s2), s1_2), gmul(gmul(gmul(gmulsg(3, d_5), r3), s2_2), s1)), gmul(gmul(gmulsg(2, d_5), r2), s2_3)), s0)), gadd(gadd(gsub(gadd(gmul(gmul(gneg(d_5), r4), s1_4), gmul(gmul(gmul(d_5, r3), s2), s1_3)), gmul(gmul(gmul(d_5, r2), s2_2), s1_2)), gmul(gmul(gmul(d_5, r1), s2_3), s1)), gmul(gmul(gmulsg(2, d_5), r0), s2_4))), t0))), x)), gadd(gadd(gadd(gmul(gsub(gmul(gadd(gmul(gmulsg(4, r3), s0), gadd(gmul(gneg(r2), s1), gmul(gmulsg(4, r1), s2))), t0_4), gmul(gmul(gmul(s2, s1), s0), t0_3)), y_3), gmul(gsub(gmul(gadd(gmul(gmul(gmul(gmulsg(6, d_2), r3), s2), s0), gadd(gmul(gmul(gmul(gmulsg(-2, d_2), r2), s2), s1), gmul(gmul(gmulsg(6, d_2), r1), s2_2))), t0_3), gmul(gmul(gmul(gmul(gmulsg(2, d_2), s2_2), s1), s0), t0_2)), y_2)), gmul(gsub(gadd(gmul(gmul(gsub(gmul(gmul(gmulsg(3, d_4), r4), r2), gmul(d_4, r3_2)), s1), t0_3), gmul(gadd(gmul(gadd(gmul(gmul(gmul(gneg(d_4), r4), s2), s1), gmul(gmul(gmulsg(3, d_4), r3), s2_2)), s0), gadd(gsub(gadd(gmul(gmul(gneg(d_4), r4), s1_3), gmul(gmul(gmul(d_4, r3), s2), s1_2)), gmul(gmul(gmul(gmulsg(2, d_4), r2), s2_2), s1)), gmul(gmul(gmulsg(3, d_4), r1), s2_3))), t0_2)), gmul(gmul(gmul(gmul(d_4, s2_3), s1), s0), t0)), y)), gadd(gadd(gmul(gadd(gmul(gmul(gmulsg(8, d_6), r4_2), r1), gadd(gmul(gmul(gmul(gmulsg(-4, d_6), r4), r3), r2), gmul(d_6, r3_3))), t0_3), gmul(gadd(gmul(gadd(gmul(gmul(gmulsg(-4, d_6), r4_2), s1), gmul(gmul(gmul(gmulsg(2, d_6), r4), r3), s2)), s0), gadd(gadd(gmul(gmul(gmul(d_6, r4), r3), s1_2), gmul(gmul(gsub(gmul(gmul(gmulsg(3, d_6), r4), r2), gmul(gmulsg(2, d_6), r3_2)), s2), s1)), gmul(gadd(gmul(gmul(gmulsg(-4, d_6), r4), r1), gmul(gmul(d_6, r3), r2)), s2_2))), t0_2)), gmul(gadd(gsub(gadd(gmul(gmul(gmul(gneg(d_6), r4), s2), s1_3), gmul(gmul(gmul(d_6, r3), s2_2), s1_2)), gmul(gmul(gmul(d_6, r2), s2_3), s1)), gmul(gmul(d_6, r1), s2_4)), t0))));
  gel(p1, 3) = gadd(gadd(gmul(s0, x_2), gmul(gmul(d, s1), x)), gadd(gmul(gmulsg(2, t0), y), gmul(d_2, s2)));
  return p1;
}

static GEN
map_biquadr(GEN t0, GEN t1, GEN t2, GEN r0, GEN r1, GEN r2, GEN s0, GEN s1, GEN s2, GEN P)
{
  GEN x = gel(P,1), y = gel(P,2), d = gel(P,3);
  GEN x_2 = gsqr(x), d_2 = gsqr(d), d_3 = gmul(d, d_2);
  GEN q0 = gmul(t0, s0);
  GEN q1 = gadd(gmul(t1, s0), gmul(s1, t0));
  GEN q2 = gadd(gmul(t2, s0), gadd(gmul(s2, t0), gmul(t1, s1)));
  GEN q3 = gadd(gmul(t2, s1), gmul(s2, t1));
  GEN q4 = gmul(t2, s2);
  GEN u = gadd(gmul(t0,x_2), gadd(gmul(t1, gmul(x,d)), gmul(d_2,t2)));
  GEN Q = mkvec3(gmul(x,d), gmul(gmul(y,d), u), d_2);
  GEN M = map_quart(gen_1, r0, r1, r2, q0, q1, q2, q3, q4, Q);
  return mkvec3(gdiv(gel(M,1), d_2), gdiv(gel(M,2), d_3), gdiv(gel(M,3), d));
}

/* Input: coefficients of a cubic  */
/*t0*y^3+(s1+s0*x)*y^2 +(r2+r1*x+r0*x^2)*y+(q3+q2*x+q1*x^2+q0*x^3)=0*/

static GEN
jac_cubic(GEN t0, GEN s0, GEN s1, GEN r0, GEN r1, GEN r2, GEN q0, GEN q1, GEN q2, GEN q3)
{
  GEN t0_2 = gsqr(t0);
  GEN s0_2 = gsqr(s0), s0_3 = gmul(s0, s0_2);
  GEN s1_2 = gsqr(s1), s1_3 = gmul(s1, s1_2);
  GEN r0_2 = gsqr(r0), r0_3 = gmul(r0, r0_2);
  GEN r1_2 = gsqr(r1), r1_3 = gmul(r1, r1_2);
  GEN r2_2 = gsqr(r2), r2_3 = gmul(r2, r2_2);
  GEN q0_2 = gsqr(q0);
  GEN q1_2 = gsqr(q1), q1_3 = gmul(q1, q1_2);
  GEN q2_2 = gsqr(q2), q2_3 = gmul(q2, q2_2);
  GEN q3_2 = gsqr(q3);
  GEN p1 = cgetg(6, t_VEC);
  gel(p1, 1) = r1;
  gel(p1, 2) = gneg(gadd(gadd(gmul(s0, q2), gmul(s1, q1)), gmul(r0, r2)));
  gel(p1, 3) = gadd(gmul(gsub(gmul(gmulsg(9, t0), q0), gmul(s0, r0)), q3), gadd(gmul(gsub(gmul(gneg(t0), q1), gmul(s1, r0)), q2), gsub(gmul(gmul(gneg(s0), r2), q1), gmul(gmul(s1, r2), q0))));
  gel(p1, 4) = gadd(gmul(gadd(gmul(gadd(gmul(gmulsg(-3, t0), r0), s0_2), q1), gadd(gmul(gmul(gmulsg(-3, s1), s0), q0), gmul(s1, r0_2))), q3), gadd(gadd(gmul(gmul(t0, r0), q2_2), gmul(gadd(gmul(gmul(s1, s0), q1), gadd(gmul(gadd(gmul(gmulsg(-3, t0), r2), s1_2), q0), gmul(gmul(s0, r0), r2))), q2)), gadd(gadd(gmul(gmul(t0, r2), q1_2), gmul(gmul(gmul(s1, r0), r2), q1)), gmul(gmul(s0, r2_2), q0))));
  gel(p1, 5) = gadd(gadd(gmul(gsub(gadd(gmul(gmulsg(-27, t0_2), q0_2), gmul(gsub(gmul(gmul(gmulsg(9, t0), s0), r0), s0_3), q0)), gmul(t0, r0_3)), q3_2), gmul(gadd(gmul(gadd(gmul(gsub(gmul(gmulsg(9, t0_2), q0), gmul(gmul(t0, s0), r0)), q1), gadd(gmul(gadd(gmul(gmul(gmulsg(-3, t0), s0), r1), gadd(gmul(gmul(gmulsg(3, t0), s1), r0), gmul(gmulsg(2, s1), s0_2))), q0), gsub(gmul(gmul(t0, r0_2), r1), gmul(gmul(s1, s0), r0_2)))), q2), gadd(gadd(gadd(gmul(gneg(t0_2), q1_3), gmul(gadd(gmul(gmul(t0, s0), r1), gsub(gmul(gmul(gmulsg(2, t0), s1), r0), gmul(s1, s0_2))), q1_2)), gmul(gadd(gmul(gadd(gmul(gmul(gmulsg(3, t0), s0), r2), gadd(gmul(gmul(gmulsg(-3, t0), s1), r1), gmul(gmulsg(2, s1_2), s0))), q0), gadd(gmul(gsub(gmul(gmulsg(2, t0), r0_2), gmul(s0_2, r0)), r2), gsub(gadd(gmul(gmul(gneg(t0), r0), r1_2), gmul(gmul(gmul(s1, s0), r0), r1)), gmul(s1_2, r0_2)))), q1)), gadd(gmul(gsub(gmul(gmul(gmulsg(9, t0), s1), r2), s1_3), q0_2), gmul(gadd(gmul(gsub(gmul(gadd(gmul(gmulsg(-3, t0), r0), s0_2), r1), gmul(gmul(s1, s0), r0)), r2), gadd(gsub(gmul(t0, r1_3), gmul(gmul(s1, s0), r1_2)), gmul(gmul(s1_2, r0), r1))), q0)))), q3)), gadd(gadd(gadd(gmul(gmul(gneg(t0_2), q0), q2_3), gmul(gadd(gmul(gmul(gmul(gneg(t0), s1), r0), q1), gsub(gmul(gadd(gmul(gmul(gmulsg(2, t0), s0), r2), gsub(gmul(gmul(t0, s1), r1), gmul(s1_2, s0))), q0), gmul(gmul(t0, r0_2), r2))), q2_2)), gmul(gadd(gadd(gmul(gmul(gmul(gneg(t0), s0), r2), q1_2), gmul(gadd(gmul(gmul(gmul(gneg(t0), s1), r2), q0), gmul(gsub(gmul(gmul(t0, r0), r1), gmul(gmul(s1, s0), r0)), r2)), q1)), gmul(gadd(gmul(gsub(gmul(gmulsg(2, t0), r0), s0_2), r2_2), gmul(gsub(gadd(gmul(gneg(t0), r1_2), gmul(gmul(s1, s0), r1)), gmul(s1_2, r0)), r2)), q0)), q2)), gsub(gadd(gmul(gmul(gmul(gneg(t0), r0), r2_2), q1_2), gmul(gmul(gmul(gsub(gmul(t0, r1), gmul(s1, s0)), r2_2), q0), q1)), gmul(gmul(t0, r2_3), q0_2))));
  return p1;
}

/* Input: coefficients of an equation */
/* t0*y^2+(s0*x^2+s1*x+s2)*y+(r0*x^4+r1*x^3+r2*x^2+r3*x+r4)=0 */

static GEN
jac_quart(GEN t0, GEN s0, GEN s1, GEN s2, GEN r0, GEN r1, GEN r2, GEN r3, GEN r4)
{
  GEN t0_2 = gsqr(t0), t0_3 = gmul(t0, t0_2);
  GEN s0_2 = gsqr(s0);
  GEN s1_2 = gsqr(s1);
  GEN s2_2 = gsqr(s2);
  GEN r1_2 = gsqr(r1);
  GEN r3_2 = gsqr(r3);
  GEN p1 = cgetg(6, t_VEC);
  gel(p1, 1) = s1;
  gel(p1, 2) = gsub(gmul(gneg(t0), r2), gmul(s0, s2));
  gel(p1, 3) = gsub(gmul(gmul(gneg(t0), s2), r1), gmul(gmul(t0, s0), r3));
  gel(p1, 4) = gadd(gadd(gadd(gmul(gneg(gsub(gmul(gmulsg(4, t0_2), r4), gmul(t0, s2_2))), r0), gmul(gmul(t0_2, r1), r3)), gmul(gmul(gmul(t0, s0), s2), r2)), gmul(gmul(t0, s0_2), r4));
  gel(p1, 5) = gsub(gsub(gsub(gmul(gneg(gadd(gsub(gadd(gmul(gneg(gsub(gmul(gmulsg(4, t0_3), r4), gmul(t0_2, s2_2))), r2), gmul(t0_3, r3_2)), gmul(gmul(gmul(t0_2, s1), s2), r3)), gmul(gmul(t0_2, s1_2), r4))), r0), gmul(gmul(t0_3, r1_2), r4)), gmul(gsub(gmul(gmul(gmul(t0_2, s0), s2), r3), gmul(gmul(gmul(t0_2, s0), s1), r4)), r1)), gmul(gmul(gmul(t0_2, s0_2), r2), r4));
  return p1;
}

static GEN
jac_quartp(GEN t0, GEN s0, GEN s1, GEN s2, GEN r0, GEN r1, GEN r2, GEN r3, GEN r4, GEN p)
{
  if (!p)
    return jac_quart(t0, s0, s1, s2, r0, r1, r2, r3, r4);
  else
  {
    retmkvec2(jac_quart(t0, s0, s1, s2, r0, r1, r2, r3, r4),
              map_quart(t0, s0, s1, s2, r0, r1, r2, r3, r4, p));
  }
}
/* Input: coefficients of an equation */
/* (t0*x^2+t1*x+t2)*y^2+(r0*x^2+r1*x+r2)*y+(s0*x^2+s1*x+s2)=0 */

static GEN
jac_biquadr(GEN t0, GEN t1, GEN t2, GEN r0, GEN r1, GEN r2,
                                    GEN s0, GEN s1, GEN s2)
{
  GEN t0_2 = gsqr(t0);
  GEN t1_2 = gsqr(t1);
  GEN t2_2 = gsqr(t2);
  GEN s0_2 = gsqr(s0);
  GEN s1_2 = gsqr(s1);
  GEN s2_2 = gsqr(s2);
  GEN r0_2 = gsqr(r0);
  GEN r1_2 = gsqr(r1);
  GEN r2_2 = gsqr(r2);
  GEN p1 = cgetg(6, t_VEC);
  gel(p1, 1) = r1;
  gel(p1, 2) = gneg(gadd(gadd(gadd(gmul(s2, t0), gmul(t2, s0)), gmul(t1, s1)), gmul(r2, r0)));
  gel(p1, 3) = gadd(gmul(gmul(gneg(r2), s1), t0), gadd(gmul(gmul(gneg(t1), r2), s0), gsub(gmul(gmul(gneg(t2), r0), s1), gmul(gmul(t1, r0), s2))));
  gel(p1, 4) = gadd(gmul(gadd(gmul(gadd(gmul(gmulsg(-4, t2), s2), r2_2), s0), gadd(gadd(gmul(t2, s1_2), gmul(gmul(t1, s2), s1)), gmul(gmul(r2, r0), s2))), t0), gadd(gmul(gadd(gmul(gmul(t2, t1), s1), gadd(gmul(t1_2, s2), gmul(gmul(t2, r2), r0))), s0), gadd(gmul(gmul(gmul(t1, r2), r0), s1), gmul(gmul(t2, r0_2), s2))));
  gel(p1, 5) = gadd(gadd(gmul(gsub(gmul(gsub(gmul(gmulsg(4, t2), s2_2), gmul(r2_2, s2)), s0), gmul(gmul(t2, s2), s1_2)), t0_2), gmul(gadd(gadd(gmul(gsub(gmul(gmulsg(4, t2_2), s2), gmul(t2, r2_2)), s0_2), gmul(gadd(gadd(gmul(gneg(t2_2), s1_2), gmul(gsub(gmul(gmul(t2, r2), r1), gmul(t1, r2_2)), s1)), gadd(gmul(gneg(t1_2), s2_2), gmul(gadd(gmul(gneg(t2), r1_2), gmul(gmul(t1, r2), r1)), s2))), s0)), gsub(gadd(gmul(gmul(gmul(gneg(t2), r2), r0), s1_2), gmul(gmul(gmul(gsub(gmul(t2, r1), gmul(t1, r2)), r0), s2), s1)), gmul(gmul(t2, r0_2), s2_2))), t0)), gsub(gadd(gmul(gmul(gmul(gneg(t2), t1_2), s2), s0_2), gmul(gadd(gmul(gmul(gmul(gmul(gneg(t2), t1), r2), r0), s1), gmul(gadd(gmul(gneg(t2_2), r0_2), gmul(gsub(gmul(gmul(t2, t1), r1), gmul(t1_2, r2)), r0)), s2)), s0)), gmul(gmul(gmul(gmul(t2, t1), r0_2), s2), s1)));
  return p1;
}

static GEN
jac_biquadrp(GEN t0, GEN t1, GEN t2, GEN r0, GEN r1, GEN r2,
                                     GEN s0, GEN s1, GEN s2, GEN p)
{
  if (!p)
    return jac_biquadr(t0, t1, t2, r0, r1, r2, s0, s1, s2);
  else
  {
    retmkvec2( jac_biquadr(t0, t1, t2, r0, r1, r2, s0, s1, s2),
               map_biquadr(t0, t1, t2, r0, r1, r2, s0, s1, s2, p));
  }
}

INLINE long
dg(GEN P, long v)
{
  if (typ(P)!=t_POL || varn(P)!=v || !signe(P))
    return -1;
  return degpol(P);
}

INLINE GEN
co(GEN P, long i, long v)
{
  if (typ(P)!=t_POL || varn(P)!=v)
    return i==0 ? P: gen_0;
  if (i>degpol(P)) return gen_0;
  return gel(P, i+2);
}

GEN
ellfromeqn0(GEN P, GEN p)
{
  pari_sp av = avma;
  long vx, vy, dx, dy, dm;
  GEN r = gen_0, q;
  if (p)
  {
    if (!is_vec_t(typ(p))) pari_err_TYPE("ellfromeqn0",p);
    if (lg(p)==3)
      q = mkvec3(gel(p,1),gel(p,2),gen_1);
    else if (lg(p)==4)
      q = p;
    else
    {
      pari_err_TYPE("ellfromeqn",p);
      return NULL; /* LCOV_EXCL_LINE */
    }
  } else q = NULL;
  if (typ(P)!=t_POL) pari_err_TYPE("ellfromeqn",P);
  vx = varn(P); vy = gvar2(P);
  if (vy==NO_VARIABLE) pari_err_TYPE("ellfromeqn",P);
  dx = poldegree(P, vx);
  dy = poldegree(P, vy);
  dm = maxss(dx, dy);
  if (dm == 2)
  {
    GEN p_0 = co(P, 0, vx), p_1 = co(P, 1, vx), p_2 = co(P, 2, vx);
    r = jac_biquadrp(co(p_2, 2, vy), co(p_1, 2, vy), co(p_0, 2, vy),
                     co(p_2, 1, vy), co(p_1, 1, vy), co(p_0, 1, vy),
                     co(p_2, 0, vy), co(p_1, 0, vy), co(p_0, 0, vy), q);
  }
  else if (dm == 3)
  {
    GEN p_0 = co(P, 0, vx), p_1 = co(P, 1, vx),
        p_2 = co(P, 2, vx), p_3 = co(P, 3, vx);
    if (q) pari_err_IMPL("ellfromeqn cubic map");
    if (dg(p_3, vy) > 0 || dg(p_2, vy) > 1 || dg(p_1, vy) > 2)
      r = gen_0; /* genus > 1 */
    else
      r = jac_cubic( co(p_3, 0, vy),
        co(p_2, 1, vy), co(p_2, 0, vy),
        co(p_1, 2, vy), co(p_1, 1, vy), co(p_1, 0, vy),
        co(p_0, 3, vy), co(p_0, 2, vy), co(p_0, 1, vy), co(p_0, 0, vy));
  }
  else if (dm == 4 && dx == 2)
  {
    GEN p_0 = co(P, 0, vx), p_1 = co(P, 1, vx), p_2 = co(P, 2, vx);
    if (dg(p_2, vy) > 0 || dg(p_1, vy) > 2)
      r = gen_0; /* genus > 1 */
    else
      r = jac_quartp( co(p_2, 0, vy),
        co(p_1, 2, vy), co(p_1, 1, vy), co(p_1, 0, vy),
        co(p_0, 4, vy), co(p_0, 3, vy), co(p_0, 2, vy), co(p_0, 1, vy),
                                                        co(p_0, 0, vy), q);
  }
  else if (dm == 4 && dx == 4)
  {
    GEN p_0 = co(P, 0, vx), p_1 = co(P, 1, vx), p_2 = co(P, 2, vx),
        p_3 = co(P, 3, vx), p_4 = co(P, 4, vx);
    if (dg(p_4, vy) > 0 || dg(p_3, vy) > 0
     || dg(p_2, vy) > 1 || dg(p_1, vy) > 1 || dg(p_0, vy) > 2)
      r = gen_0; /* genus > 1 */
    else
      r = jac_quartp(co(p_0, 2, vy),
                    co(p_2, 1, vy), co(p_1, 1, vy), co(p_0, 1, vy),
                    co(p_4, 0, vy), co(p_3, 0, vy), co(p_2, 0, vy),
                                    co(p_1, 0, vy), co(p_0, 0, vy), q);
  }
  if (r==gen_0)
    pari_err_DOMAIN("ellfromeqn", "genus", "!=", gen_1,P);
  if (p && lg(p)==3)
  {
    GEN Q = gel(r,2), x = gel(Q,1), y = gel(Q,2), d = gel(Q,3), d_2, d_3;
    d_2 = gsqr(d); d_3 = gmul(d, d_2);
    gel(r,2) = mkvec2(gdiv(x, d_2), gdiv(y, d_3));
  }
  return gc_GEN(av, r);
}

GEN
ellfromeqn(GEN P) { return ellfromeqn0(P, NULL); }
