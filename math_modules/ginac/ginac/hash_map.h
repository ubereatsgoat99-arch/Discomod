/** @file hash_map.h
 *
 *  Replacement for map<> using hash tables. */

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

#ifndef GINAC_HASH_MAP_H
#define GINAC_HASH_MAP_H

#include <unordered_map>

namespace GiNaC {

template <typename T,
	  class Hash = std::hash<ex>,
	  class KeyEqual = std::equal_to<ex>,
	  class Allocator = std::allocator<std::pair<const ex, T>>>
using exhashmap = std::unordered_map<ex, T, Hash, KeyEqual, Allocator>;

} // namespace GiNaC

#endif // ndef GINAC_HASH_MAP_H
