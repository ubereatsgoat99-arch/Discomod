/** @file cinrem_gcd.cpp
 *
 *  Chinese remainder algorithm. */

/*
 *  GiNaC Copyright (C) 1999-2026 Johannes Gutenberg University Mainz, Germany
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#include "chinrem_gcd.h"
#include "optimal_vars_finder.h"

namespace GiNaC {

ex chinrem_gcd(const ex& A, const ex& B)
{
	const exvector vars = gcd_optimal_variables_order(A, B);
	ex g = chinrem_gcd(A, B, vars);
	return g;
}

} // namespace GiNaC
