/** @file timer.cpp
 *
 *  A simple stop watch class. */

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

#include <ctime>

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif
#include "timer.h"

timer::timer() : on(false)
{
	used1 = clock();
	used2 = used1;
}

void timer::start()
{
	on = true;
	used1 = clock();
	used2 = used1;
}

void timer::stop()
{
	on = false;
	used2 = clock();
}

void timer::reset()
{
	used1 = clock();
	used2 = used1;
}

double timer::read()
{
	if (running())
		used2 = clock();
	return double(used2 - used1)/CLOCKS_PER_SEC;
}

bool timer::running()
{
	return on;
}
