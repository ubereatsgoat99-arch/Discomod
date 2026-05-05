/** @file assertion.h
 *
 *  Assertion macro definition. */

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

#ifndef GINAC_ASSERTION_H
#define GINAC_ASSERTION_H

#if !defined(GINAC_ASSERT)
#if defined(DO_GINAC_ASSERT)
#include <cassert>
/** Assertion macro for checking invariances. */
#define GINAC_ASSERT(X) assert(X)
#else
/** Assertion macro for checking invariances. */
#define GINAC_ASSERT(X) ((void)0)
#endif
#endif

#endif // ndef GINAC_ASSERTION_H
