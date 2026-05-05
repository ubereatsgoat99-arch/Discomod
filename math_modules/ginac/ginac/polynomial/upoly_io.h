/** @file upoly_io.h
 *
 *  Output operators for polynomials. */

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

#ifndef GINAC_UPOLY_IO_H
#define GINAC_UPOLY_IO_H

#include "upoly.h"

#include <ostream>

namespace GiNaC {

extern std::ostream& operator<<(std::ostream&, const upoly& );
extern std::ostream& operator<<(std::ostream&, const umodpoly& );

} // namespace GiNaC

#endif // GINAC_UPOLY_IO_H
