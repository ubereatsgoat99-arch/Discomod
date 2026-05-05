/** @file Gt_helpers.cpp
 *
 *  Implementation of helper functions for elliptic multiple polylogarithms. */

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

#include "add.h"
#include "mul.h"
#include "power.h"
#include "lst.h"
#include "operators.h"
#include "relational.h"
#include "inifcns.h"
#include "function.h"
#include "Gt.h"
#include "Gt_helpers.h"

using namespace GiNaC;

namespace GiNaC::Gt_detail {

////////////////////////////////
//TransformExpressionWithCache//
////////////////////////////////
template<typename Type>
template<typename T>
typename std::enable_if<std::is_base_of<basic, T>::value, bool>::type
TransformExpressionWithCache<Type>::check_type(const ex& expr)
{
	return is_exactly_a<Type>(expr);
}
template<typename Type>
template<typename T>
typename std::enable_if<!std::is_base_of<basic, T>::value, bool>::type
TransformExpressionWithCache<Type>::check_type(const ex& expr)
{
	return is_the_function<Type>(expr);
}

template<typename Type>
void TransformExpressionWithCache<Type>::print_cache() const
{
	std::cout << "Cache" << std::endl;
	for (const auto& n : cache)
		std::cout << "  " << n.first << " -> " << n.second << std::endl;
}

template<typename Type>
ex TransformExpressionWithCache<Type>::impl(const ex& expr)
{
	// If the input is of the desired type, apply the transformation, update cache
	if (check_type(expr)) {
		const auto pos = cache.find(expr);
		if (pos != cache.end())
			return pos->second;
		return cache.emplace(expr, func_obj(expr)).first->second;
	}

	// If the input is an addition, multiplication, exponentiation or list, run recurisvely over elements
	if (is_exactly_a<add>(expr) || is_exactly_a<mul>(expr)) {
		std::vector<ex> terms;
		terms.reserve(expr.nops());
		for (size_t i = 0; i < expr.nops(); i++)
			terms.emplace_back(impl(expr.op(i)));
		if (is_exactly_a<add>(expr))
			return add(terms);
		else
			return mul(terms);
	}
	if (is_exactly_a<lst>(expr)) {
		lst result;
		for (size_t i = 0; i < expr.nops(); i++)
			result.append(impl(expr.op(i)));
		return result;
	}
	if (is_exactly_a<power>(expr))
		return power(impl(expr.op(0)), expr.op(1));

	// Otherwise, use default transformation function (e.g. for number, symbols, unrelated functions)
	return func_default(expr);
}

// Instantiate template for elliptic and regular MPLs
template class TransformExpressionWithCache<Gt>;
template class TransformExpressionWithCache<G2_SERIAL>;



////////////////////////////////
// Path deconcatenation tools //
////////////////////////////////
std::vector<std::vector<int>> integer_partition(const int n, const int m)
{
	std::vector<std::vector<int>> result;
	std::vector<int> hlp(m, 0);
	int k = 1;
	hlp[1] = n;
	while (k != 0) {
		int x = hlp[k-1] + 1;
		int y = hlp[k] - 1;
		k -= 1;
		while (x <= y && k < m-1) {
			hlp[k] = x;
			y -= x;
			k += 1;
		}
		hlp[k] = x + y;

		std::vector<int> decomposition(m, 0);
		for (size_t i = 0; i < k+1; i++)
			decomposition[i] = hlp[i];
		std::sort(decomposition.begin(), decomposition.end());
		do {
			result.emplace_back(decomposition);
		} while (next_permutation(decomposition.begin(), decomposition.end()));
	}

	return result;
}

template<typename Kernel>
ex deconcatenate_path(
	const std::vector<Kernel>& args,
	const std::vector<ex>& endpoints,
	const std::function<ex(std::vector<Kernel>& new_args, const ex& start, const ex& end)>& construct
)
{
	// Assemble partition information into iterated integrals
	const size_t n_segments = endpoints.size()-1;
	const std::vector<std::vector<int>> partitions = integer_partition(args.size(), n_segments);
	std::vector<ex> terms;
	terms.reserve(partitions.size());
	for (const std::vector<int>& partition : partitions) { // loop over all partitions, each gives one term
		size_t kernel_count = 0;
		std::vector<ex> factors;
		factors.reserve(n_segments);
		for (size_t i = 0; i < n_segments; i++) { // loop over paths, each gives zero or one integral
			if (partition[i] == 0)
				continue;
			// copy partition[i] consecutive kernels
			std::vector<Kernel> new_args(args.begin()+kernel_count, args.begin()+kernel_count+partition[i]);
			kernel_count += partition[i];
			// Construct the shifted iterated integral, shift kernel arguments if necessary
			factors.emplace_back(construct(new_args, endpoints[n_segments-1-i], endpoints[n_segments-i]));
		}
		terms.emplace_back(mul(factors));
	}
	return add(terms);
}
// Instantiate for regular and elliptic MPL kernels
template ex deconcatenate_path<ex>(
	const std::vector<ex>& args,
	const std::vector<ex>& endpoints,
	const std::function<ex(std::vector<ex>& new_args, const ex& start, const ex& end)>& construct
);
template ex deconcatenate_path<Gt::kernel>(
	const std::vector<Gt::kernel>& args,
	const std::vector<ex>& endpoints,
	const std::function<ex(std::vector<Gt::kernel>& new_args, const ex& start, const ex& end)>& construct
);



////////////////////////////////
//     pathintegral_term      //
////////////////////////////////

pathintegral_term::pathintegral_term(const pathintegral_term& a, const pathintegral_term& b, int power_offset) // construct as product
	: prefactor(a.prefactor * b.prefactor),
	  power(a.power + b.power + power_offset),
	  polylog(a.polylog.empty() ? b.polylog : a.polylog),
	  denom(a.denom.is_zero() ? b.denom : a.denom)
{
	if ((!a.polylog.empty() && !b.polylog.empty()) || (!a.denom.is_zero() && !b.denom.is_zero()))
		throw std::logic_error("Gt: Cannot multiply these terms");
}

void pathintegral_term::integrate(const ex& start, pathintegral_term_list& integrand, pathintegral_term_list& result) const
{
	if (power != 0 && !denom.is_zero()) { // Power and denominator -> partial fractioning
		for (int i = std::min(0, power); i < std::max(0, power); i++)
			integrand.add((power > 0 ? 1 : -1) * prefactor * pow(denom, power-i-1), i, polylog);
		integrand.add(prefactor * pow(denom, power), 0, polylog, denom);
		return;
	}

	if (polylog.empty() && denom.is_zero()) { // only power of integration variable
		if (power == -1)
			result.add(prefactor, 0, std::vector<ex>(1,ex{0}));
		else {
			result.add( prefactor / (power + 1), power+1);
			result.add(-prefactor / (power + 1)*pow(start,power+1), 0);
		}
		return;
	}

	if (!polylog.empty() && denom.is_zero()) { // (power and) polylog
		std::vector<ex> args = polylog;
		const ex& first = polylog[0];
		if (power == -1) {
			args.insert(args.begin(), ex{0});
			result.add(prefactor, 0, args);
		}
		else {
			result.add(prefactor / (power + 1), power+1, args);
			args.erase(args.begin());
			// If first==0 the denominator 1/([int.var.] - first) turns into [int.var]^(-1)
			integrand.add(-prefactor / (power + 1), power+1 - first.is_zero(), args, first);
		}
		return;
	}

	if (polylog.empty() and power == 0) { // only denominator: 1/([int.var.] - C)
		result.add(prefactor, 0, std::vector<ex>(1, denom));
		return;
	}

	if (!polylog.empty() && power==0 && !denom.is_zero()) { // polylog and denominator
		std::vector<ex> args = polylog;
		args.insert(args.begin(), denom);
		result.add(prefactor, 0, args);
		return;
	}

	throw std::logic_error("Gt: Invalid integration");
}

ex pathintegral_term::evaluate(const ex& upper_bound, const std::vector<ex>& path) const
{
	ex result = prefactor * pow(upper_bound, power);
	if (!denom.is_zero())
		result /= denom - upper_bound;
	if (!polylog.empty())
		result *= G_path(polylog, path);
	return result;
}

ex pathintegral_term::G_path(const std::vector<ex>& args, const std::vector<ex>& path)
{
	// Multiple segments -> deconcatenate path
	if (path.size() > 2) {
		return deconcatenate_path<ex>(args, path, [](std::vector<ex>& new_args, const ex& start, const ex& end) -> ex {
			return G_path(new_args,start,end);
		});
	}
	return G_path(args, path[0], path[1]);
}
ex pathintegral_term::G_path(const std::vector<ex>& args, const ex& start, const ex& end)
{
	// Optimisation in case all arguments are the same
	bool all_args_same = args.size() >= 2;
	for (size_t i = 1; i < args.size() && all_args_same; i++)
		all_args_same = (args[i] == args[0]);
	if (all_args_same)
		return (pow(G((args[0] - start)/(end - start),1).hold(), args.size()) / factorial(args.size()));

	// Shift arguments, such that integration path is 0 -> 1
	lst new_args;
	for (const ex& arg : args)
		new_args.append((arg - start)/(end - start));
	return G(new_args,1).hold();
}

std::ostream & operator<<(std::ostream & os, const pathintegral_term & term)
{
	os << "(" << term.prefactor << ")";
	if (term.power)
		os << "*[int.var.]^" << term.power;
	if (!term.polylog.empty()) {
		os << "*G({";
		for (const ex& kern : term.polylog)
			os << kern << ",";
		os << "},[int.var.],[path])";
	}
	if (!term.denom.is_zero())
		os << "/([int.var.]-(" << term.denom << "))";
	return os;
}

// Terms are ordered such that more complicated terms (for integration) come first
bool operator<(const pathintegral_term & a, const pathintegral_term & b)
{
	// 1) Sort decending by polylog order (integration-by-parts yields shorter polylogs)
	if (a.polylog.size() > b.polylog.size()) return true;
	if (a.polylog.size() < b.polylog.size()) return false;
	// 2) Terms with denominator in beginning (partial fractioning yields terms without denominators)
	if (!a.denom.is_zero() && b.denom.is_zero()) return true;
	if (a.denom.is_zero() && !b.denom.is_zero()) return false;
	// 3) Sort ascending by powers (integration-by-parts yields terms with higher power (if polylog present))
	if (a.power < b.power) return true;
	if (a.power > b.power) return false;

	// Arbitrarily decide order based on remaining info
	// Sort by denominator
	int cmpval = a.denom.compare(b.denom);
	if (cmpval < 0) return true;
	if (cmpval > 0) return false;
	// Sort by Polylog
	for (size_t i = 0; i < a.polylog.size(); i++) {
		cmpval = a.polylog[i].compare(b.polylog[i]);
		if (cmpval < 0) return true;
		if (cmpval > 0) return false;
	}
	// Terms which differ only in their prefactor are considered identical
	// Calling find() on a container thus yields a term which is equivalent up to prefactor
	// This means we can add a term to a container by calling find() and summing the prefactor
	return false;
}

void pathintegral_term_list::add(pathintegral_term&& term)
{
	std::set<pathintegral_term>::iterator pos = terms.find(term);
	if (pos == end())
		terms.insert(std::move(term));
	else {
		pos->prefactor += term.prefactor;
		if (pos->prefactor.is_zero())
			terms.erase(pos);
	}
}

void pathintegral_term_list::add(const pathintegral_term_list& other)
{
	// Cannot use terms.insert here, as we need to properly add prefacttors
	for (const pathintegral_term& term : other)
		add(pathintegral_term(term));
}

pathintegral_term pathintegral_term_list::pop()
{
	pathintegral_term term = *begin();
	terms.erase(begin());
	return term;
}

} // namespace GiNaC::Gt_detail
