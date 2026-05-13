/** @file cra_garner.h
 *
 *  Interface to Garner's algorithm. */

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

#ifndef CL_INTEGER_CRA
#define CL_INTEGER_CRA

#include <cln/integer.h>
#include <vector>

namespace cln {

extern cl_I integer_cra(const std::vector<cl_I>& residues,
	                const std::vector<cl_I>& moduli);

} // namespace cln

#endif // CL_INTEGER_CRA
