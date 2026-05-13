/** @file Gt_helpers.h
 *
 *  Interface to helper functions for elliptic multiple polylogarithms. */

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
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#ifndef GINAC_EMPL_HELPERS_H
#define GINAC_EMPL_HELPERS_H

#include <set>
#include "ex.h"
#include "hash_map.h"

namespace GiNaC::Gt_detail {

// Recurse through an expression and apply transformation to each contained object of a given type
// Cache function calls and reuse them if possible
// This is more flexible and efficient than using collect() to avoid repeated function calls
template<typename Type>
class TransformExpressionWithCache
{
public:
	TransformExpressionWithCache(
		const std::function<ex(const ex&)>& func_obj,
		const std::function<ex(const ex&)>& func_default = [](const ex& obj) -> ex { return obj; })
		: func_obj(func_obj), func_default(func_default) {}

	// Apply to an expression
	ex operator()(const ex& input) { return impl(input); }

	// For debugging
	void print_cache() const;
	const exhashmap<ex>& get_cache() const { return cache; }
	void clear_cache() { cache.clear();}

private:
	// Check whether a given ex is of Type
	template<typename T = Type>
	static typename std::enable_if<std::is_base_of<basic, T>::value, bool>::type check_type(const ex& expr);
	// Overload for functions instead of expression types
	template<typename T = Type>
	static typename std::enable_if<!std::is_base_of<basic, T>::value, bool>::type check_type(const ex& expr);

	// Recurse through expression, find objects of Type, check or update cache, return transformed expression
	ex impl(const ex& expr);

private:
	const std::function<ex(const ex&)> func_obj;     // function to transform the desired object
	const std::function<ex(const ex&)> func_default; // function to transform any other object
	exhashmap<ex> cache; // previously encountered objects and function call results
};



// Used to deconcatenate integration paths in (elliptic) multiple polylogs
// Find all ways to distribute `n' objects into `m' buckets
// Result e.g. n=2, m=3 => [(0,1,1),(1,0,1),(1,1,0),(0,0,2),(0,2,0),(2,0,0)]
// n: number of kernels, m: number of paths
// Since the order of kernels and paths is fixed (kernels ascending, paths descending)
// this is enough information to construct all required permutations
// e.g. n=2 kernels (a1,a2) and m=3 paths (p1,p2,p3):
//      (0,1,1) => 0 kernels to last path
//                 1 kernel to middle path -> G(a1;p2)
//                 1 kernel to first path  -> G(a2;p1)    => G(a1;p2)*G(a2;p1)
//      (0,0,2) => 0 kernels to last and middle path
//                 2 kernel to first path  -> G(a1,a2;p1)
std::vector<std::vector<int>> integer_partition(const int n, const int m);

// Write an iterated integral that is integrated along a given path as a combination of iterated integrals, integrated along a straight line.
// The input is an iterated integral with kernels `args' that is integrated along the piecewise straight path given by `endpoints'.
// This function deconcatenates the path and constructs new iterated integrals containing subsets of the kernels of the original integral.
// The function `construct' should construct a new iterated integral object with the given kernels and straight path. If the transformation
// requires shifts of the kernel arguments, this function has to apply them too.
template<typename Kernel>
ex deconcatenate_path(
	const std::vector<Kernel>& args,
	const std::vector<ex>& endpoints,
	const std::function<ex(std::vector<Kernel>& new_args, const ex& start, const ex& end)>& construct
);



class pathintegral_term_list;

// Class that represents a single term of the integrand of an integral along a piecewise straight path
// Used during iterative integration of elliptic multiple polylogs
class pathintegral_term
{
public:
	pathintegral_term(ex prefactor, int power, const std::vector<ex>& polylog = {}, ex denom=0)
		: prefactor(prefactor.evalf()), power(power), polylog(polylog), denom(denom.evalf()) {}

	pathintegral_term(const pathintegral_term& a, const pathintegral_term& b, int power_offset=0); // construct as product

	// Integrate along a path and add the results to the given vector, add terms from partial integration/fractioning back to integrand
	void integrate(const ex& start, pathintegral_term_list& integrand, pathintegral_term_list& result) const;

	// Evaluate for a given upper bound
	ex evaluate(const ex& upper_bound, const std::vector<ex>& path) const;

private:
	// Evaluate the regular MPL along the given path
	// Return result in terms of held G functions. They are held, such that their numerical evaluation can be cached
	static ex G_path(const std::vector<ex>& args, const std::vector<ex>& path);
	static ex G_path(const std::vector<ex>& args, const ex& start, const ex& end);

	friend class pathintegral_term_list;
	friend std::ostream & operator<<(std::ostream & os, const pathintegral_term & term);
	friend bool operator<(const pathintegral_term & lh, const pathintegral_term & rh);

	mutable ex prefactor;     // independent of integration variable
	int power;                // power of integration variable
	std::vector<ex> polylog;  // optional: arguments of a regular MPL
	ex denom;                 // optional, only in integrand: a term 1/(integration variable-denom) (or 0 if not present)
};
std::ostream & operator<<(std::ostream & os, const pathintegral_term & term);
bool operator<(const pathintegral_term & lh, const pathintegral_term & rh);

// A sum of terms in the integrand, automatically merge/cancel terms that differ only in their prefactor
class pathintegral_term_list
{
	std::set<pathintegral_term> terms;

public:
	std::set<pathintegral_term>::const_iterator begin() const { return terms.begin(); }
	std::set<pathintegral_term>::const_iterator end()   const { return terms.end();   }

	void clear() { terms.clear(); }
	bool empty() const { return terms.empty(); }
	size_t size() const { return terms.size(); }

	// Add a single term, taking care of possible combination/cancellation of terms
	void add(pathintegral_term&& term);
	// Forward arguments to constructor of pathintegral_term
	template<typename... Args, typename = typename std::enable_if<(sizeof...(Args)>1)>::type>
	void add(Args&& ...args)
	{
		add(pathintegral_term(std::forward<Args>(args)...));
	}

	// Add multiple terms
	void add(const pathintegral_term_list& other);

	// Remove the first element from the container and return it
	pathintegral_term pop();
};

} // namespace GiNaC::Gt_detail

#endif // ndef GINAC_EMPL_HELPERS_H
