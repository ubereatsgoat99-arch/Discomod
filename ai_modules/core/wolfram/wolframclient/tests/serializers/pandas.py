from __future__ import absolute_import, print_function, unicode_literals

from wolframclient.serializers import export
from wolframclient.utils.api import pandas
from wolframclient.utils.tests import TestCase as BaseTestCase

TEST_CASES = [
    "pandas.Series([1, 2, 3])",
    "pandas.Series([1.0, 2.5, 3.7])",
    "pandas.Series(['a', 'b', 'c'])",
    "pandas.Series([True, False, True])",
    "pandas.Series([])",
    "pandas.Series([1, 2, 3], name='values')",
    "pandas.Series([1, 2, 3], index=['a', 'b', 'c'])",
    "pandas.Series([1, 2, 3], index=['a', 'b', 'c'], name='values')",
    "pandas.Series([10, 20, 30], index=[100, 200, 300])",
    "pandas.Series([1, 2, 3], index=[0.5, 1.5, 2.5])",
    "pandas.Series([1, 2, 3], index=[-1, 'a', 1])",
    "pandas.Series([1, 2, 3, 4], index=[1, 'x', 2.5, 'y'])",
    "pandas.Series([1, 2, 3], index=pandas.DatetimeIndex(['2024-01-01', '2024-01-02', '2024-01-03']))",
    "pandas.Series([1, 2, 3], index=pandas.date_range('2024-01-01', periods=3, freq='D'))",
    "pandas.Series([1, 2, 3], index=pandas.DatetimeIndex(['2024-01-01', '2024-01-02', '2024-01-03'], name='date'))",
    "pandas.DataFrame({'a': [1, 2, 3]})",
    "pandas.DataFrame({'a': [1, 2], 'b': [3, 4]})",
    "pandas.DataFrame({'col1': ['x', 'y'], 'col2': [1.5, 2.5]})",
    "pandas.DataFrame({})",
    "pandas.DataFrame({'a': [1, 2, 3]}, index=['x', 'y', 'z'])",
    "pandas.DataFrame({'a': [1, 2], 'b': [3, 4]}, index=[10, 20])",
    "pandas.DataFrame({'a': [1, 2]}, index=pandas.Index(['x', 'y'], name='idx'))",
    "pandas.DataFrame({'val': [1, 2, 3]}, index=[-1, 'a', 1])",
    "pandas.DataFrame({'val': [1, 2, 3]}, index=pandas.DatetimeIndex(['2024-01-01', '2024-01-02', '2024-01-03']))",
    "pandas.DataFrame({'a': [1, 2], 'b': [3, 4]}, index=pandas.date_range('2024-01-01', periods=2))",
    "pandas.Series([1, 2, 3, 4], index=pandas.MultiIndex.from_tuples([('a', 1), ('a', 2), ('b', 1), ('b', 2)]))",
    "pandas.Series([1, 2, 3, 4], index=pandas.MultiIndex.from_tuples([('a', 1), ('a', 2), ('b', 1), ('b', 2)], names=['letter', 'number']))",
    "pandas.Series([1, 2, 3, 4], index=pandas.MultiIndex.from_tuples([('a', 1), ('a', 'x'), (1, 2), (1, 'y')], names=['key1', 'key2']))",
    "pandas.Series([1, 2, 3, 4], index=pandas.MultiIndex.from_tuples([('a', pandas.Timestamp('2024-01-01')), ('a', pandas.Timestamp('2024-01-02')), ('b', pandas.Timestamp('2024-01-01')), ('b', pandas.Timestamp('2024-01-02'))], names=['group', 'date']))",
    "pandas.Series([1, 2, 3, 4], index=pandas.MultiIndex.from_tuples([('a', pandas.Timestamp('2024-01-01')), ('a', 'not a date'), (1, pandas.Timestamp('2024-01-02')), (1, 999)], names=['key', 'value']))",
    "pandas.DataFrame({'val': [1, 2, 3, 4]}, index=pandas.MultiIndex.from_tuples([('a', 1), ('a', 2), ('b', 1), ('b', 2)], names=['letter', 'num']))",
    "pandas.DataFrame([[1, 2], [3, 4]], columns=pandas.MultiIndex.from_tuples([('a', 'x'), ('a', 'y')]))",
    "pandas.Series([1, 2, 3], index=[0, float('nan'), 2])",
    "pandas.Series(list(range(8)), index=pandas.MultiIndex.from_product([['a', 'b'], ['x', 'y'], [1, 2]], names=['l1', 'l2', 'l3']))",
]


class TestCase(BaseTestCase):
    """Test pandas serialization works for all cases."""

    def test_serialization_works(self):
        """Test that export works for all cases."""
        for python_expr in TEST_CASES:
            with self.subTest(expr=python_expr):
                data = eval(
                    python_expr,
                    {"pandas": pandas, "float": float, "list": list, "range": range},
                )
                export(data, target_format="wl")
                export(data, target_format="wxf")

    def test_nat_encodes_as_indeterminate(self):
        import pandas as pd

        result = export(pd.NaT, target_format="wl")
        self.assertEqual(result, b"Indeterminate")

    def test_nat_wxf(self):
        import pandas as pd

        result = export(pd.NaT, target_format="wxf")
        self.assertIn(b"Indeterminate", result)
